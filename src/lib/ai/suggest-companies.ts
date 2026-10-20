import { z } from "zod";
import { ATS_TYPES, EXPERIENCE_LEVELS, type AtsType, type ExperienceLevel, type Profile } from "@/db/schema";
import { EXPERIENCE_LABELS, inferExperienceLevel } from "@/lib/jobs/experience";
import { isInTargetCountry } from "@/lib/jobs/location";
import { isExcludedTitle, titleSimilarity } from "@/lib/jobs/scoring";
import { fetchAshby } from "@/lib/jobs/sources/ashby";
import { fetchGreenhouse } from "@/lib/jobs/sources/greenhouse";
import { fetchLever } from "@/lib/jobs/sources/lever";
import { runSourceTasks } from "@/lib/jobs/sources";
import type { NormalizedJob, SourceTask } from "@/lib/jobs/types";
import { aiJson } from "./provider";

/** A verified job board: it exists right now, with these counts. */
export type CompanySuggestion = {
  name: string;
  ats: AtsType;
  slug: string;
  why: string;
  usJobs: number;
  /** US jobs whose title matches a target title and isn't far above the profile's level. */
  goodMatches: number;
  topTitles: string[];
};

const SuggestionSchema = z.object({
  companies: z.array(
    z.object({
      name: z.string(),
      ats: z.enum(ATS_TYPES).describe("Which hosted job board the company uses"),
      slug: z.string().describe("The board's identifier in its URL"),
      why: z.string().describe("Under 90 characters: why it fits this candidate"),
    }),
  ),
});

const SYSTEM = `You know which job-board software US employers use. Suggest employers for one job seeker.
Only suggest companies whose careers pages are hosted on Greenhouse (boards.greenhouse.io/{slug} or job-boards.greenhouse.io/{slug}), Lever (jobs.lever.co/{slug}) or Ashby (jobs.ashbyhq.com/{slug}), and give that slug exactly (usually the lowercase company name without spaces, e.g. "cloudflare", "huntress").
At least half must be companies whose core business is the candidate's own field (for a security analyst: cybersecurity vendors, MDR/MSSP and SOC-as-a-service providers, security consultancies); the rest can be large employers with big teams doing that work. Favor employers that hire at the candidate's level in the US: for entry-level candidates, companies known for junior roles, apprenticeships and rotational programs. Mix well-known and mid-size companies. Never suggest staffing agencies.`;

const PROBE_TIMEOUT_MS = 10_000;

// Greenhouse can skip descriptions, which makes checking a big board several times faster.
function fetcherFor(ats: AtsType): (slug: string, signal: AbortSignal) => Promise<NormalizedJob[]> {
  if (ats === "greenhouse") return (slug, signal) => fetchGreenhouse(slug, signal, { content: false });
  return ats === "lever" ? fetchLever : fetchAshby;
}

function cleanSlug(slug: string): string {
  return slug.trim().toLowerCase().replace(/^https?:\/\/[^/]+\//, "").replace(/[^a-z0-9._-]/g, "");
}

/**
 * Asks the AI for ~25 employers that fit the profile, then checks each board live (trying the
 * other two job-board services when the suggested one has no such board) and returns only
 * boards that exist, ranked by how many US jobs match the profile.
 */
export async function suggestCompanies(input: {
  profile: Profile;
  existing: { ats: AtsType; slug: string }[];
  deadline: number;
}): Promise<CompanySuggestion[]> {
  const { profile } = input;
  // Companies already tracked are skipped on every job-board service, not just the one tracked.
  const takenSlugs = new Set(input.existing.map((t) => t.slug.toLowerCase()));
  const level = profile.seniority ? EXPERIENCE_LABELS[profile.seniority].toLowerCase() : "any";
  const { data } = await aiJson({
    schema: SuggestionSchema,
    system: SYSTEM,
    prompt: `Candidate: ${level}-level. Target titles: ${profile.titles.join("; ") || "(none)"}.
Skills: ${profile.skills.slice(0, 25).join(", ") || "(none)"}.
Interests: ${[...profile.keywords, ...profile.searchKeywords].slice(0, 15).join(", ") || "(none)"}.
Already tracking (don't repeat): ${input.existing.map((t) => t.slug).join(", ") || "none"}.
Suggest 25 employers.`,
    tier: "quality",
    maxTokens: 4_000,
    timeoutMs: 20_000,
    deadline: input.deadline - 15_000,
  });

  const wanted = new Map<string, { name: string; why: string; ats: AtsType; slug: string }>();
  for (const c of data.companies) {
    const slug = cleanSlug(c.slug);
    if (!slug || wanted.has(slug) || takenSlugs.has(slug)) continue;
    wanted.set(slug, { name: c.name.trim(), why: c.why.trim().slice(0, 140), ats: c.ats, slug });
  }

  // Each board is fetched on its own (8 at a time) so its jobs stay grouped. Round 1 tries the
  // suggested service; round 2 tries the other two for slugs that weren't found.
  const found = new Map<string, { ats: AtsType; jobs: NormalizedJob[] }>();
  const probeBoards = async (pairs: { ats: AtsType; slug: string }[]) => {
    const fresh = pairs.filter((p) => !found.has(p.slug));
    await Promise.all(
      chunked(fresh, 8).map(async (lane) => {
        for (const p of lane) {
          const left = input.deadline - Date.now();
          if (found.has(p.slug) || left < 2_000) continue;
          const task: SourceTask = { label: `${p.ats}:${p.slug}`, source: p.ats, run: ({ signal }) => fetcherFor(p.ats)(p.slug, signal) };
          const { jobs, results } = await runSourceTasks([task], profile, Math.min(PROBE_TIMEOUT_MS, left));
          if (results[0]?.ok && jobs.length > 0) found.set(p.slug, { ats: p.ats, jobs });
        }
      }),
    );
  };
  await probeBoards([...wanted.values()].map((w) => ({ ats: w.ats, slug: w.slug })));
  const missing = [...wanted.values()].filter((w) => !found.has(w.slug));
  await probeBoards(missing.flatMap((w) => ATS_TYPES.filter((a) => a !== w.ats).map((ats) => ({ ats, slug: w.slug }))));

  const out: CompanySuggestion[] = [];
  for (const [slug, { ats, jobs }] of found) {
    const meta = wanted.get(slug)!;
    const us = jobs.filter((j) => isInTargetCountry(j) && !isExcludedTitle(j.title, profile.excludeKeywords));
    // Titles only (Greenhouse boards are fetched without descriptions): a role counts when its
    // title closely matches a target title (0.75+, so sharing one word like "Information" isn't
    // enough) and isn't two or more levels above the profile (no "Senior" roles for entry level).
    const scored = us
      .filter((j) => !tooSenior(j.experienceLevel ?? inferExperienceLevel(j.title), profile.seniority))
      .map((j) => ({ title: j.title, sim: Math.max(0, ...profile.titles.map((t) => titleSimilarity(t, j.title))) }))
      .sort((a, b) => b.sim - a.sim);
    const good = scored.filter((s) => s.sim >= 0.75);
    out.push({
      name: meta.name,
      ats,
      slug,
      why: meta.why,
      usJobs: us.length,
      goodMatches: good.length,
      topTitles: [...new Set(good.slice(0, 3).map((s) => s.title))],
    });
  }
  return out.filter((s) => s.usJobs > 0).sort((a, b) => b.goodMatches - a.goodMatches || b.usJobs - a.usJobs);
}

function tooSenior(job: ExperienceLevel | null, want: ExperienceLevel | null): boolean {
  if (!job || !want) return false;
  return EXPERIENCE_LEVELS.indexOf(job) - EXPERIENCE_LEVELS.indexOf(want) >= 2;
}

function chunked<T>(items: T[], parts: number): T[][] {
  const out: T[][] = Array.from({ length: Math.min(parts, items.length) }, () => []);
  items.forEach((item, i) => out[i % out.length].push(item));
  return out;
}
