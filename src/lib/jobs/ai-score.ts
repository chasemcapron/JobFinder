import { z } from "zod";
import { AiUnavailableError } from "@/lib/ai/gemini";
import { aiJson, aiProvider } from "@/lib/ai/provider";
import { EXPERIENCE_LABELS } from "./experience";
import { formatLocation } from "./location";
import type { MatchProfile, ScoredJob } from "./scoring";

export type AiScore = { score: number; reason: string };

const BATCH_SIZE = 10;
/** Free-tier Gemini allows only a handful of requests per minute; two at a time stays under it. */
const CONCURRENCY = 2;
/** Per-job description budget. Postings repeat boilerplate; the top carries the signal. */
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

const SYSTEM = `You score how well US job postings fit one candidate. For each job return a 0-100 score and a one-sentence reason.
Scoring guide: 90+ near-perfect (role, level, core skills and location all line up); 75-89 strong with a minor gap; 50-74 plausible with real gaps; 25-49 weak; under 25 wrong field or wrong level.
Judge the kind of work first. A posting in a different profession scores under 15 even when it shares tools or words with the candidate's field: for a security analyst, a "Credit Risk Analyst" or "Securities Analyst" is a different profession; Python and SQL appearing in a finance role do not make it a fit.
Then seniority: an entry-level candidate should not get above 40 for roles asking for 5+ years, "Senior", "Staff", "Lead" or "Principal" titles. Then skills, then location/remote preference.
Reasons must be specific (name the matching skills or the gap), under 120 characters, and never mention the score.`;

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

async function scoreBatch(
  profile: MatchProfile,
  batch: [string, ScoredJob & { company: string }][],
  deadline: number,
): Promise<Map<string, AiScore>> {
  const { data } = await aiJson({
    schema: ResultSchema,
    system: SYSTEM,
    prompt: `<candidate>\n${describeProfile(profile)}\n</candidate>\n\n${batch.map(([id, j]) => describeJob(id, j)).join("\n\n")}\n\nScore every job above.`,
    tier: "fast",
    maxTokens: 4_000,
    hedgeAfterMs: 20_000,
    deadline,
  });
  const out = new Map<string, AiScore>();
  const wanted = new Set(batch.map(([id]) => id));
  for (const r of data.results) {
    if (!wanted.has(r.id)) continue;
    out.set(r.id, {
      score: Math.max(0, Math.min(100, Math.round(r.score))),
      reason: r.reason.trim().slice(0, 200),
    });
  }
  return out;
}

/**
 * Scores jobs with the configured AI in small batches. Returns whatever succeeded: a failed
 * batch keeps its jobs on their keyword score, and a rate limit stops the remaining batches.
 * No batch starts after `deadline`, so the caller stays inside its time limit.
 */
export async function scoreWithAi(
  profile: MatchProfile,
  jobs: Map<string, ScoredJob & { company: string }>,
  opts: { deadline?: number } = {},
): Promise<{ scores: Map<string, AiScore>; errors: string[] }> {
  const scores = new Map<string, AiScore>();
  const errors: string[] = [];
  if (!aiProvider() || jobs.size === 0) return { scores, errors };
  const deadline = opts.deadline ?? Date.now() + 30_000;
  const entries = [...jobs.entries()];
  const batches: (typeof entries)[] = [];
  for (let i = 0; i < entries.length; i += BATCH_SIZE) batches.push(entries.slice(i, i + BATCH_SIZE));

  let next = 0;
  let stopped = false;
  async function worker() {
    while (!stopped && next < batches.length && deadline - Date.now() > 3_000) {
      const batch = batches[next++];
      try {
        for (const [id, s] of await scoreBatch(profile, batch, deadline)) scores.set(id, s);
      } catch (err) {
        console.error("AI scoring batch failed", err);
        errors.push(err instanceof Error ? err.message : String(err));
        if (err instanceof AiUnavailableError && err.rateLimited) stopped = true;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
  if (!stopped && next < batches.length) {
    const left = batches.slice(next).reduce((n, b) => n + b.length, 0);
    errors.push(`ran out of time; ${left} job(s) kept their keyword score`);
  }
  return { scores, errors: [...new Set(errors)] };
}
