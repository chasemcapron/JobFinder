import { z } from "zod";
import { claudeJson, getClaude } from "@/lib/ai/claude";
import { EXPERIENCE_LABELS } from "./experience";
import { formatLocation } from "./location";
import type { MatchProfile, ScoredJob } from "./scoring";

export type AiScore = { score: number; reason: string };

const BATCH_SIZE = 10;
const CONCURRENCY = 3;
/** Per-job description budget sent to Claude. Postings repeat boilerplate; the top carries the signal. */
const DESCRIPTION_CHARS = 2_500;

const ResultSchema = z.object({
  results: z.array(
    z.object({
      id: z.string().describe("The job id exactly as given"),
      score: z.number().describe("0-100 fit score"),
      reason: z.string().describe("One sentence, under 120 characters, on why it fits or doesn't"),
    }),
  ),
});

const SYSTEM = `You score how well job postings fit a candidate. For each job return a 0-100 score and a one-sentence reason.
Scoring guide: 90+ near-perfect fit (title, level, core skills, and location all line up); 70-89 strong fit with a minor gap; 50-69 plausible but notable gaps; 25-49 weak; under 25 wrong field or level.
Weigh role type and seniority most, then skills, then location/remote preferences. Penalize clear dealbreakers (wrong level, on-site in a city the candidate doesn't want, a different profession).
Reasons should be specific (mention the matching skills or the gap) and must not exceed 120 characters.`;

function describeProfile(p: MatchProfile): string {
  const lines = [
    p.titles.length ? `Target titles: ${p.titles.join("; ")}` : null,
    p.seniority ? `Seniority: ${EXPERIENCE_LABELS[p.seniority]}` : null,
    p.experienceLevels.length ? `Wants levels: ${p.experienceLevels.map((l) => EXPERIENCE_LABELS[l]).join(", ")}` : null,
    p.skills.length ? `Skills: ${p.skills.join(", ")}` : null,
    p.keywords.length || p.searchKeywords.length ? `Interests: ${[...p.searchKeywords, ...p.keywords].join(", ")}` : null,
    p.preferredLocations.length ? `Preferred locations: ${p.preferredLocations.join("; ")}` : null,
    `Remote preference: ${{ any: "remote or on-site", remote_only: "remote only", onsite_only: "on-site/hybrid only" }[p.remotePreference]}`,
  ];
  return lines.filter(Boolean).join("\n");
}

function describeJob(id: string, job: ScoredJob & { company: string }): string {
  const level = job.experienceLevel ? ` | level: ${EXPERIENCE_LABELS[job.experienceLevel]}` : "";
  const desc = job.description.length > DESCRIPTION_CHARS ? `${job.description.slice(0, DESCRIPTION_CHARS)}…` : job.description;
  return `<job id="${id}">\n${job.title} at ${job.company} | ${formatLocation(job, job.locationRaw)}${level}\n${desc}\n</job>`;
}

async function scoreBatch(profile: MatchProfile, batch: [string, ScoredJob & { company: string }][]): Promise<Map<string, AiScore>> {
  const result = await claudeJson({
    schema: ResultSchema,
    system: SYSTEM,
    prompt: `<candidate>\n${describeProfile(profile)}\n</candidate>\n\n${batch.map(([id, j]) => describeJob(id, j)).join("\n\n")}\n\nScore every job above.`,
    maxTokens: 4000,
  });
  const out = new Map<string, AiScore>();
  const wanted = new Set(batch.map(([id]) => id));
  for (const r of result.results) {
    if (!wanted.has(r.id)) continue;
    out.set(r.id, {
      score: Math.max(0, Math.min(100, Math.round(r.score))),
      reason: r.reason.trim().slice(0, 200),
    });
  }
  return out;
}

/**
 * Scores jobs with Claude in small batches. Returns whatever succeeded; a failed batch is
 * logged and its jobs keep their keyword score. Returns an empty map without an API key.
 */
export async function scoreWithClaude(
  profile: MatchProfile,
  jobs: Map<string, ScoredJob & { company: string }>,
): Promise<{ scores: Map<string, AiScore>; errors: string[] }> {
  const scores = new Map<string, AiScore>();
  const errors: string[] = [];
  if (!getClaude() || jobs.size === 0) return { scores, errors };
  const entries = [...jobs.entries()];
  const batches: (typeof entries)[] = [];
  for (let i = 0; i < entries.length; i += BATCH_SIZE) batches.push(entries.slice(i, i + BATCH_SIZE));

  let next = 0;
  async function worker() {
    while (next < batches.length) {
      const batch = batches[next++];
      try {
        for (const [id, s] of await scoreBatch(profile, batch)) scores.set(id, s);
      } catch (err) {
        console.error("Claude scoring batch failed", err);
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
  return { scores, errors };
}
