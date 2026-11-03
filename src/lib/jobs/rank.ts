import type { JobSource, MatchEvaluation, MatchVerdict } from "@/db/schema";
import { aiProvider } from "@/lib/ai/provider";
import { scoreWithAi, type AiJsonFn, type AiScore } from "./ai-score";
import { hardBlockers } from "./blockers";
import { ruleEvaluation } from "./evaluation";
import { isInTargetCountry } from "./location";
import { roleKey } from "./normalize";
import {
  isExcludedTitle,
  keywordScore,
  profileHasTerms,
  titleSimilarity,
  type KeywordResult,
  type MatchProfile,
  type ScoredJob,
} from "./scoring";

export type JobForScoring = ScoredJob & { company: string; source: JobSource };
export type Candidate = { id: string; job: JobForScoring; kw: KeywordResult; blockers: string[] };

/** What gets saved for one job: the AI's evaluation, a fixed rule's skip, or the keyword score. */
export type FinalMatch = {
  score: number;
  verdict: MatchVerdict | null;
  evaluation: MatchEvaluation | null;
  reasons: string;
  aiScored: boolean;
};

export type RankResult = {
  /** Jobs that stay: every one gets a match row, however weak. */
  candidates: Candidate[];
  /** Ids dropped by the profile's exclusions, the US filter or the sample-job rule. */
  excluded: string[];
  /** Fresh AI evaluations from this run, already shared across each role's copies. */
  aiScores: Map<string, AiScore>;
  errors: string[];
};

/** A rule-skipped job keeps its keyword score, capped like an AI "skip" so it never ranks high. */
const SKIP_SCORE_CAP = 30;
/** Share of the AI cap kept for roles whose title fits but whose keyword score is low. */
const TITLE_RESERVE = 0.25;
/** Title similarity that earns a reserved AI slot. */
const RESERVE_SIMILARITY = 0.5;

export function finalMatch(c: Candidate, ai: AiScore | undefined): FinalMatch {
  if (ai) return { score: ai.score, verdict: ai.verdict, evaluation: ai.evaluation, reasons: ai.reason, aiScored: true };
  if (c.blockers.length) {
    return {
      score: Math.min(c.kw.score, SKIP_SCORE_CAP),
      verdict: "skip",
      evaluation: ruleEvaluation(c.blockers),
      reasons: c.blockers.join(" · "),
      aiScored: false,
    };
  }
  return { score: c.kw.score, verdict: null, evaluation: null, reasons: c.kw.reason, aiScored: false };
}

function bestTitleSimilarity(profile: MatchProfile, title: string): number {
  let best = 0;
  for (const t of [...profile.titles, ...profile.searchKeywords]) best = Math.max(best, titleSimilarity(t, title));
  return best;
}

/**
 * Picks the roles the AI evaluates this run: never ones a fixed rule already ruled out, nor ones
 * with a fresh evaluation. 75% of the slots go by keyword score; 25% are kept for roles whose
 * title fits but whose keyword score is low (the posting barely names the user's skills, or a
 * federal pay grade made it look senior), which the eval showed the keyword score kept from the
 * AI (2 of 5 good roles reached it, 2026-11-03). Each role is scored once and shared with its copies.
 */
export function selectForAi(candidates: Candidate[], profile: MatchProfile, opts: { isFresh: (id: string) => boolean; cap: number }) {
  const groups = new Map<string, Candidate[]>();
  const open = candidates.filter((c) => !c.blockers.length && !opts.isFresh(c.id));
  for (const c of open) {
    const key = roleKey(c.job);
    const g = groups.get(key);
    if (g) g.push(c);
    else groups.set(key, [c]);
  }
  for (const g of groups.values()) g.sort((a, b) => b.kw.score - a.kw.score);
  const roles = [...groups.entries()].map(([key, members]) => ({ key, members, kw: members[0].kw.score }));

  const chosen = new Map<string, Candidate[]>();
  const byKeyword = [...roles].sort((a, b) => b.kw - a.kw);
  const reserved = Math.round(opts.cap * TITLE_RESERVE);
  for (const r of byKeyword) {
    if (chosen.size >= opts.cap - reserved) break;
    chosen.set(r.key, r.members);
  }
  const byTitle = roles
    .filter((r) => !chosen.has(r.key))
    .map((r) => ({ ...r, sim: bestTitleSimilarity(profile, r.members[0].job.title) }))
    .filter((r) => r.sim >= RESERVE_SIMILARITY)
    .sort((a, b) => b.sim - a.sim || b.kw - a.kw);
  for (const r of byTitle) {
    if (chosen.size >= opts.cap) break;
    chosen.set(r.key, r.members);
  }
  // Slots the title reserve didn't need go back to the keyword order.
  for (const r of byKeyword) {
    if (chosen.size >= opts.cap) break;
    if (!chosen.has(r.key)) chosen.set(r.key, r.members);
  }
  return chosen;
}

/**
 * The pure part of match scoring, shared by the search pipeline and the eval harness
 * (scripts/eval-matching.ts), so the harness measures exactly what production ranks:
 * 1. drops excluded titles, non-US jobs and (optionally) sample jobs;
 * 2. keyword-scores the rest and applies the fixed rules (blockers.ts);
 * 3. has the AI evaluate the roles `selectForAi` picks, sharing each role's result with its copies.
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
    /** Already redacted (see redactPersonalInfo); goes in the AI's stable prompt prefix. */
    resume?: string | null;
    /** Replaces the AI call (the eval harness caches answers on disk). */
    ai?: AiJsonFn;
    spacingMs?: number;
  },
): Promise<RankResult> {
  const excluded: string[] = [];
  const candidates: Candidate[] = [];
  for (const [id, job] of all) {
    if (isExcludedTitle(job.title, profile.excludeKeywords) || !isInTargetCountry(job) || (opts.hideMock && job.source === "mock")) {
      excluded.push(id);
      continue;
    }
    candidates.push({ id, job, kw: keywordScore(job, profile), blockers: hardBlockers(job, profile) });
  }

  const groups =
    opts.useAi && profileHasTerms(profile) && (opts.ai || aiProvider())
      ? selectForAi(candidates, profile, { isFresh: opts.isFresh, cap: opts.cap })
      : new Map<string, Candidate[]>();
  const representatives = [...groups.values()].map((g) => g[0]);
  const { scores: groupScores, errors: aiErrors } = await scoreWithAi(
    profile,
    new Map(representatives.map((c) => [c.id, c.job])),
    { deadline: opts.deadline, ai: opts.ai, resume: opts.resume, spacingMs: opts.spacingMs },
  );
  const aiScores = new Map<string, AiScore>();
  for (const group of groups.values()) {
    const score = groupScores.get(group[0].id);
    if (score) for (const c of group) aiScores.set(c.id, score);
  }
  return { candidates, excluded, aiScores, errors: aiErrors.map((e) => `AI scoring: ${e}`) };
}
