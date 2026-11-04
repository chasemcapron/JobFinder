import { EXPERIENCE_LEVELS, type ExperienceLevel, type Profile } from "@/db/schema";
import { inferExperienceLevel } from "./experience";
import { levelFromYears } from "./requirements";
import type { ScoredJob } from "./scoring";

export type BlockerProfile = Pick<Profile, "experienceLevels" | "seniority"> & Partial<Pick<Profile, "hasClearance" | "avoidMilitary">>;
export type BlockerJob = Pick<ScoredJob, "title" | "experienceLevel" | "minYears" | "clearance"> & { company: string };

/**
 * Military branches and their commands, matched on the employer name. USAJobs names the hiring
 * organization ("Commander, Navy Installations Command", "Air Force Materiel Command",
 * "Army National Guard Units"), which doesn't always say the branch, so the commands seen in
 * real postings are listed too. Civilian defense agencies (DFAS, DISA, DLA) aren't branches.
 */
const MILITARY_EMPLOYER =
  /\b(army|navy|naval|marine corps|marines|usmc|air forces?|air national guard|national guard|coast guard|space force|space operations|space systems command|fleet forces|strategic systems programs|air and space intelligence|military academy|air force academy|naval academy)\b/i;
/** Employers that only borrow a branch's name. */
const MILITARY_LOOKALIKE = /\bnavy federal\b|\bold navy\b|\bnavy pier\b|\bsalvation army\b|\barmy (?:&|and) air force exchange\b/i;

export function isMilitaryEmployer(company: string): boolean {
  return MILITARY_EMPLOYER.test(company) && !MILITARY_LOOKALIKE.test(company);
}

function gap(job: ExperienceLevel, want: ExperienceLevel) {
  return EXPERIENCE_LEVELS.indexOf(job) - EXPERIENCE_LEVELS.indexOf(want);
}

/** The most senior level the user is after: their checked levels, else their resume's seniority. */
function wantedLevel(p: BlockerProfile): ExperienceLevel | null {
  if (p.experienceLevels.length) {
    return [...p.experienceLevels].sort((a, b) => EXPERIENCE_LEVELS.indexOf(b) - EXPERIENCE_LEVELS.indexOf(a))[0];
  }
  return p.seniority;
}

/**
 * Fixed rules that rule a job out before any AI sees it (its verdict becomes "skip"):
 * - an active security clearance the user doesn't hold (federal postings sponsor theirs, so their
 *   adapter never marks them "active");
 * - an internship when the user isn't looking for one;
 * - a military branch, when the user has said they won't work for one;
 * - clearly too senior: the TITLE says so (Senior, Lead, Supervisory, Manager, Director…) or the
 *   posting states the years, two or more levels above what the user wants. A level derived only
 *   from a federal pay grade never counts: those were labeled good in the eval (2026-11-03).
 * Returns the reasons, shortest first; empty when nothing rules the job out.
 */
export function hardBlockers(job: BlockerJob, profile: BlockerProfile): string[] {
  const out: string[] = [];
  const want = wantedLevel(profile);
  const titleLevel = inferExperienceLevel(job.title);

  if (job.clearance === "active" && !profile.hasClearance) out.push("Needs an active clearance");
  const wantsInternship = profile.experienceLevels.length ? profile.experienceLevels.includes("internship") : profile.seniority === "internship";
  if (want && !wantsInternship && (titleLevel === "internship" || job.experienceLevel === "internship")) out.push("Internship");
  if (profile.avoidMilitary && isMilitaryEmployer(job.company)) out.push("Military branch");
  if (want && titleLevel && titleLevel !== "internship" && gap(titleLevel, want) >= 2) out.push("Senior-level title");
  else if (want && job.minYears && gap(levelFromYears(job.minYears), want) >= 2) out.push(`Asks for ${job.minYears}+ years`);
  return out;
}
