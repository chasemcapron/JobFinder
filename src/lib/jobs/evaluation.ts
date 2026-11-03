import { z } from "zod";
import {
  LOCATION_FITS,
  MATCH_VERDICTS,
  ROLE_FITS,
  SENIORITY_FITS,
  SKILL_COVERAGES,
  type FitCheckResult,
  type FitVerdict,
  type MatchEvaluation,
  type MatchVerdict,
} from "@/db/schema";

/**
 * Bumped when the evaluation prompt or shape changes; older evaluations count as stale and are
 * redone (see `isCurrentEvaluation`). 1 was the single score with a reason, before 2026-11-03;
 * 2 the structured evaluation; 3 judges "off target" against the candidate's own field.
 */
export const EVAL_VERSION = 3;

/**
 * One job's structured evaluation, as the batch scorer returns it. Separate ratings instead of
 * one number, modelled on career-ops' evaluation blocks (github.com/career-ops-hq/career-ops, MIT):
 * kind of work, level, required skills met vs missing, location, hard stops, and a verdict.
 * Lists have no maximum here: one long list must not fail a whole batch's validation, so they're
 * trimmed in code instead.
 */
export const JobEvalSchema = z.object({
  id: z.string().describe("The job id exactly as given"),
  roleFit: z
    .enum(ROLE_FITS)
    .describe("on_target: the same kind of work as the target titles; adjacent: a neighbouring role the resume shows they could do; off_target: a different profession"),
  seniorityFit: z.enum(SENIORITY_FITS).describe("From the title and stated years, against the resume"),
  skillsCoverage: z.enum(SKILL_COVERAGES).describe("How much of the REQUIRED skills the resume shows: strong most, partial some, weak few"),
  locationFit: z.enum(LOCATION_FITS).describe("Against the candidate's location and remote preferences; unknown when the posting doesn't say"),
  matchedSkills: z.array(z.string()).describe("Up to 6 skills the posting asks for that the resume shows, in the posting's words"),
  missingSkills: z.array(z.string()).describe("Up to 5 things the posting requires that the resume doesn't show, most important first"),
  blockers: z.array(z.string()).describe("Hard stops the candidate can't meet; usually empty"),
  verdict: z.enum(MATCH_VERDICTS).describe("apply, maybe or skip"),
  score: z.number().describe("Your overall 0-100 fit"),
  reason: z.string().describe("One sentence under 140 characters, main gap first if there is one"),
});
export type JobEval = z.infer<typeof JobEvalSchema>;

const ROLE: Record<JobEval["roleFit"], number> = { on_target: 1, adjacent: 0.55, off_target: 0 };
const SENIORITY: Record<JobEval["seniorityFit"], number> = { fits: 1, too_junior: 0.7, stretch: 0.5, too_senior: 0.05 };
const SKILLS: Record<JobEval["skillsCoverage"], number> = { strong: 1, partial: 0.6, weak: 0.2 };
const LOCATION: Record<JobEval["locationFit"], number> = { ok: 1, unknown: 0.7, mismatch: 0.2 };
/** How much of the model's own number is blended in, mostly to break ties between equal ratings. */
const HOLISTIC_WEIGHT = 0.15;

const clamp = (n: number) => Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));

/**
 * Keeps the verdict to the rubric, whatever the model said: off-target roles are always "skip",
 * a hard stop rules out "apply", and "skip" needs a reason the rubric allows (off target, a
 * blocker, or too senior). The eval caught "skip" for a location mismatch alone (2026-11-03),
 * and that job is hidden by default, so an unjustified skip costs the user a real option.
 */
export function consistentVerdict(e: Pick<JobEval, "verdict" | "roleFit" | "blockers" | "seniorityFit">): MatchVerdict {
  if (e.roleFit === "off_target") return "skip";
  if (e.blockers.length && e.verdict === "apply") return "maybe";
  if (e.verdict === "skip" && !e.blockers.length && e.seniorityFit !== "too_senior") return "maybe";
  return e.verdict;
}

/**
 * The single number the list sorts by, computed from the parts rather than taken from the model:
 * ratings are stable across batches and across the fallback models, a free number isn't.
 * Weighted parts (kind of work 40, level 25, required skills 25, location 10), 15% of the model's
 * own number to break ties, then bands that keep the number and the verdict telling the same story.
 */
export function overallScore(e: Pick<JobEval, "roleFit" | "seniorityFit" | "skillsCoverage" | "locationFit" | "blockers" | "score"> & { verdict: MatchVerdict }): number {
  const parts = 100 * (0.4 * ROLE[e.roleFit] + 0.25 * SENIORITY[e.seniorityFit] + 0.25 * SKILLS[e.skillsCoverage] + 0.1 * LOCATION[e.locationFit]);
  let s = (1 - HOLISTIC_WEIGHT) * parts + HOLISTIC_WEIGHT * clamp(e.score);
  if (e.verdict === "skip") s = Math.min(s, 30);
  else if (e.verdict === "maybe") s = Math.min(Math.max(s, 35), 74);
  else s = Math.max(s, 55);
  if (e.blockers.length) s = Math.min(s, 35);
  if (e.roleFit === "off_target") s = Math.min(s, 20);
  return Math.round(clamp(s));
}

/** A blocker that's really a federal pay grade ("specialized experience at the GS-13 level"). */
const GRADE_BLOCKER = /\bGS[- ]?\d|\bgrade\b|specialized experience/i;

/**
 * Federal postings state seniority as a pay grade, and the user decided a grade alone never rules
 * a job out (2026-11-03). The prompt says so, but the model still called "specialized experience
 * at GS-14" a blocker and hid roles the user labeled good, so it's enforced here: grade-based
 * blockers are dropped, and "too senior" becomes "stretch" unless the title or stated years say
 * so. The job then shows as "maybe" with the model's reason, rather than hidden.
 */
export function federalGradeGuard(e: JobEval, job: { source?: string; title: string; minYears?: number | null }, titleSaysSenior: boolean): JobEval {
  if (job.source !== "usajobs") return e;
  const blockers = e.blockers.filter((b) => !GRADE_BLOCKER.test(b));
  const statedSenior = titleSaysSenior || (job.minYears ?? 0) >= 5;
  const seniorityFit = e.seniorityFit === "too_senior" && !statedSenior ? "stretch" : e.seniorityFit;
  return { ...e, blockers, seniorityFit };
}

const tidy = (items: string[], max: number) => [...new Set(items.map((s) => s.trim()).filter(Boolean))].slice(0, max);

/** The stored evaluation and the numbers derived from it. */
export function fromAiEval(e: JobEval): { score: number; verdict: MatchVerdict; reason: string; evaluation: MatchEvaluation } {
  const blockers = tidy(e.blockers, 3);
  const verdict = consistentVerdict({ ...e, blockers });
  return {
    score: overallScore({ ...e, blockers, verdict }),
    verdict,
    reason: e.reason.trim().slice(0, 200),
    evaluation: {
      version: EVAL_VERSION,
      source: "ai",
      roleFit: e.roleFit,
      seniorityFit: e.seniorityFit,
      skillsCoverage: e.skillsCoverage,
      locationFit: e.locationFit,
      matchedSkills: tidy(e.matchedSkills, 6),
      missingSkills: tidy(e.missingSkills, 5),
      blockers,
      holistic: Math.round(clamp(e.score)),
    },
  };
}

/** A verdict made by a fixed rule (see blockers.ts), with no AI call. */
export function ruleEvaluation(blockers: string[]): MatchEvaluation {
  return { version: EVAL_VERSION, source: "rule", matchedSkills: [], missingSkills: [], blockers };
}

const FIT_TO_VERDICT: Record<FitVerdict, MatchVerdict> = { strong: "apply", good: "apply", stretch: "maybe", poor: "skip" };

/**
 * "Check my fit" reads the whole posting against the whole resume, so its verdict and score
 * replace the batch ones, except that the user's fixed rules still win (`ruleBlockers`, from
 * blockers.ts): a job they rule out stays "skip" with its score capped, whatever the check says.
 * The batch's matched and missing skills are kept when there's a current batch evaluation;
 * otherwise the fit check's requirements table supplies them. The batch's ratings and hard stops
 * are dropped, so they can't contradict the new verdict.
 */
export function evaluationFromFit(
  result: FitCheckResult,
  existing: MatchEvaluation | null,
  ruleBlockers: string[],
): { verdict: MatchVerdict; score: number; evaluation: MatchEvaluation } {
  const reqs = result.requirements ?? [];
  const batch = existing && isCurrentEvaluation(existing) && existing.source === "ai" ? existing : null;
  const evaluation: MatchEvaluation = {
    version: EVAL_VERSION,
    source: ruleBlockers.length ? "rule" : "ai",
    matchedSkills: batch?.matchedSkills ?? tidy(reqs.filter((r) => r.match === "strong").map((r) => r.requirement), 6),
    missingSkills: batch?.missingSkills ?? tidy(reqs.filter((r) => r.match === "missing").map((r) => r.requirement), 5),
    blockers: ruleBlockers,
    holistic: result.fitScore,
  };
  if (ruleBlockers.length) return { verdict: "skip", score: Math.min(result.fitScore, 30), evaluation };
  return { verdict: FIT_TO_VERDICT[result.verdict], score: result.fitScore, evaluation };
}

/** True when a stored evaluation was made by the current prompt. */
export function isCurrentEvaluation(e: MatchEvaluation | null | undefined): boolean {
  return e?.version === EVAL_VERSION;
}
