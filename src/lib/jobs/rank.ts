import type { JobSource } from "@/db/schema";
import { aiProvider } from "@/lib/ai/provider";
import { scoreWithAi, type AiJsonFn, type AiScore } from "./ai-score";
import { isInTargetCountry } from "./location";
import { roleKey } from "./normalize";
import { isExcludedTitle, keywordScore, profileHasTerms, type KeywordResult, type MatchProfile, type ScoredJob } from "./scoring";

export type JobForScoring = ScoredJob & { company: string; source: JobSource };
export type Candidate = { id: string; job: JobForScoring; kw: KeywordResult };

export type RankResult = {
  /** Jobs that stay: every one gets a match row, however weak. */
  candidates: Candidate[];
  /** Ids dropped by the profile's exclusions, the US filter or the sample-job rule. */
  excluded: string[];
  /** Fresh AI scores from this run, already shared across each role's copies. */
  aiScores: Map<string, AiScore>;
  errors: string[];
};

/**
 * The pure part of match scoring, shared by the search pipeline and the eval harness
 * (scripts/eval-matching.ts), so the harness measures exactly what production ranks:
 * 1. drops excluded titles, non-US jobs and (optionally) sample jobs;
 * 2. keyword-scores the rest;
 * 3. AI-scores the best `cap` roles that lack a fresh AI score, and shares each role's
 *    result with its copies.
 */
export async function rankCandidates(
  profile: MatchProfile & { excludeKeywords: string[] },
  all: Map<string, JobForScoring>,
  opts: {
    isFresh: (id: string) => boolean;
    cap: number;
    useAi: boolean;
    hideMock?: boolean;
    deadline?: number;
    /** Replaces the AI call (the eval harness caches answers on disk). */
    ai?: AiJsonFn;
  },
): Promise<RankResult> {
  const excluded: string[] = [];
  const candidates: Candidate[] = [];
  for (const [id, job] of all) {
    if (isExcludedTitle(job.title, profile.excludeKeywords) || !isInTargetCountry(job) || (opts.hideMock && job.source === "mock")) {
      excluded.push(id);
      continue;
    }
    candidates.push({ id, job, kw: keywordScore(job, profile) });
  }

  // AI scores only the best candidates that don't already have a fresh AI score. Companies
  // often post one role once per city ("Solutions Engineer" x 11 states), so each company +
  // title is scored once and the result is shared with its copies, saving free-tier quota.
  const groups = new Map<string, Candidate[]>();
  if (opts.useAi && profileHasTerms(profile) && (opts.ai || aiProvider())) {
    for (const c of candidates.filter((c) => !opts.isFresh(c.id)).sort((a, b) => b.kw.score - a.kw.score)) {
      const key = roleKey(c.job);
      const group = groups.get(key);
      if (group) group.push(c);
      else if (groups.size < opts.cap) groups.set(key, [c]);
    }
  }
  const representatives = [...groups.values()].map((g) => g[0]);
  const { scores: groupScores, errors: aiErrors } = await scoreWithAi(
    profile,
    new Map(representatives.map((c) => [c.id, c.job])),
    { deadline: opts.deadline, ai: opts.ai },
  );
  const aiScores = new Map<string, AiScore>();
  for (const group of groups.values()) {
    const score = groupScores.get(group[0].id);
    if (score) for (const c of group) aiScores.set(c.id, score);
  }
  return { candidates, excluded, aiScores, errors: aiErrors.map((e) => `AI scoring: ${e}`) };
}
