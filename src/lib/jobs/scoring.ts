import { EXPERIENCE_LEVELS, type ExperienceLevel, type Profile } from "@/db/schema";
import { containsTerm, normalizeForKey, uniqueCaseInsensitive } from "@/lib/text";
import { EXPERIENCE_LABELS } from "./experience";
import { countryName } from "./location";
import type { NormalizedJob } from "./types";

export type MatchProfile = Pick<
  Profile,
  "skills" | "titles" | "keywords" | "searchKeywords" | "preferredLocations" | "experienceLevels" | "remotePreference" | "seniority"
>;

export type ScoredJob = Pick<
  NormalizedJob,
  "title" | "description" | "city" | "state" | "country" | "remote" | "locationRaw" | "experienceLevel"
>;

export type KeywordResult = { score: number; matched: string[]; reason: string };

// Words that say nothing about the kind of work, ignored when comparing titles.
const TITLE_NOISE = new Set([
  "senior", "sr", "junior", "jr", "staff", "principal", "lead", "i", "ii", "iii", "iv", "the", "of", "and", "a",
  "an", "for", "to", "in", "at", "new", "grad", "level", "entry", "mid", "remote", "hybrid", "us", "f", "m", "x",
]);

// Role words shared by every field: "Credit Analyst" and "Security Analyst" have nothing in common.
const GENERIC_ROLE = new Set([
  "analyst", "engineer", "manager", "specialist", "associate", "administrator", "admin", "consultant", "coordinator",
  "technician", "officer", "director", "representative", "assistant", "intern", "internship", "architect", "lead",
  "advisor", "partner", "operations", "program", "project", "head", "member", "professional", "scientist",
]);

// Compounds split so "Cybersecurity Analyst" and "Cyber Security Analyst" compare equal.
const TITLE_SYNONYMS: Record<string, string[]> = {
  cybersecurity: ["cyber", "security"],
  infosec: ["information", "security"],
  appsec: ["application", "security"],
  netsec: ["network", "security"],
  secops: ["security", "operations"],
  developer: ["engineer"],
  dev: ["engineer"],
};

function titleTokens(title: string): string[] {
  return normalizeForKey(title)
    .split(" ")
    .filter((t) => t && !TITLE_NOISE.has(t))
    .flatMap((t) => TITLE_SYNONYMS[t] ?? [t]);
}

/**
 * How much of the profile title's meaningful words appear in the job title (0-1). Generic role
 * words count half, and when the profile title has field words but none of them match, the
 * result is capped at 0.15, so "Credit Analyst" barely registers for "Security Analyst".
 */
export function titleSimilarity(profileTitle: string, jobTitle: string): number {
  const want = [...new Set(titleTokens(profileTitle))];
  if (want.length === 0) return 0;
  const have = new Set(titleTokens(jobTitle));
  const weight = (t: string) => (GENERIC_ROLE.has(t) ? 0.5 : 1);
  const total = want.reduce((sum, t) => sum + weight(t), 0);
  const matched = want.filter((t) => have.has(t));
  const sim = matched.reduce((sum, t) => sum + weight(t), 0) / total;
  const wantsField = want.some((t) => !GENERIC_ROLE.has(t));
  const fieldMatched = matched.some((t) => !GENERIC_ROLE.has(t));
  return wantsField && !fieldMatched ? Math.min(sim, 0.15) : sim;
}

/** True when the job title contains one of the user's excluded words (e.g. "credit"). */
export function isExcludedTitle(title: string, excludeKeywords: string[]): boolean {
  return excludeKeywords.some((k) => containsTerm(title, k));
}

function levelDistance(a: ExperienceLevel, b: ExperienceLevel): number {
  return Math.abs(EXPERIENCE_LEVELS.indexOf(a) - EXPERIENCE_LEVELS.indexOf(b));
}

/** True when the job is in one of the preferred locations (city, state, or country match). */
export function matchesPreferredLocation(job: ScoredJob, preferred: string[]): boolean {
  if (preferred.length === 0) return false;
  const haystack = [job.city, job.state, countryName(job.country), job.country, job.locationRaw].filter(Boolean).join(" | ");
  return preferred.some((pref) => {
    const [first, second] = pref.split(",").map((s) => s.trim());
    if (!first) return false;
    if (!containsTerm(haystack, first)) return false;
    // "Portland, OR" shouldn't match Portland, ME.
    return !second || !job.state || second.length !== 2 || job.state.toUpperCase() === second.toUpperCase();
  });
}

export function profileHasTerms(p: MatchProfile): boolean {
  return p.skills.length + p.titles.length + p.keywords.length + p.searchKeywords.length > 0;
}

/**
 * Raw points run to about 110, but titles are rarely word-for-word and nobody matches every
 * skill and keyword, so excellent fits earn around 70-75. Calibrate so the 0-100 scale reads
 * naturally (75+ strong, 50-74 medium, under 50 weak): raw 0-75 maps linearly to 0-95, and
 * anything above eases from 95 toward 100, so top matches still rank against each other.
 * Mirrored once for stored rows in drizzle/0002_rescale_keyword_scores.sql.
 */
export function calibrateKeywordScore(raw: number): number {
  const scaled = raw <= 75 ? (raw * 95) / 75 : 95 + ((raw - 75) * 5) / 35;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}

/**
 * Cheap, deterministic 0-100 relevance score used to prefilter before (optional) AI scoring:
 * title similarity (40) + skills (35) + keywords (15) + preferences (10), with penalties
 * for remote/level/location mismatches.
 */
export function keywordScore(job: ScoredJob, profile: MatchProfile): KeywordResult {
  if (!profileHasTerms(profile)) {
    return { score: 0, matched: [], reason: "Add your resume or keywords to rank this job." };
  }
  const text = `${job.title}\n${job.description}`;
  const reasons: string[] = [];
  let score = 0;

  // Title (40)
  let bestTitle = { sim: 0, title: "" };
  for (const t of profile.titles) {
    const sim = titleSimilarity(t, job.title);
    if (sim > bestTitle.sim) bestTitle = { sim, title: t };
  }
  score += bestTitle.sim * 40;
  if (bestTitle.sim >= 0.5) reasons.push(`Title matches "${bestTitle.title}"`);
  const keywordInTitle = profile.searchKeywords.find((k) => containsTerm(job.title, k));
  if (keywordInTitle) score += 10;

  // Skills (35). Matching ~8 skills counts as full marks; nobody's resume matches every skill.
  const matchedSkills = profile.skills.filter((s) => containsTerm(text, s));
  if (profile.skills.length) {
    score += Math.min(1, matchedSkills.length / Math.min(8, profile.skills.length)) * 35;
  }
  if (matchedSkills.length) reasons.push(`Skills: ${matchedSkills.slice(0, 5).join(", ")}`);

  // Keywords (15)
  const allKeywords = uniqueCaseInsensitive([...profile.searchKeywords, ...profile.keywords]);
  const matchedKeywords = allKeywords.filter((k) => containsTerm(text, k));
  if (allKeywords.length) score += Math.min(1, matchedKeywords.length / Math.min(4, allKeywords.length)) * 15;
  if (matchedKeywords.length && !matchedSkills.length) reasons.push(`Keywords: ${matchedKeywords.slice(0, 4).join(", ")}`);

  // Experience level (+5 / penalties)
  if (job.experienceLevel) {
    if (profile.experienceLevels.length) {
      if (profile.experienceLevels.includes(job.experienceLevel)) {
        score += 5;
        reasons.push(EXPERIENCE_LABELS[job.experienceLevel]);
      } else score -= 20;
    } else if (profile.seniority) {
      const d = levelDistance(job.experienceLevel, profile.seniority);
      if (d === 0) score += 5;
      else if (d >= 2) score -= 10 * (d - 1);
    }
  }

  // Remote / location (+5 / penalties)
  const locationMatch = matchesPreferredLocation(job, profile.preferredLocations);
  if (profile.remotePreference === "remote_only" && !job.remote) score -= 25;
  if (profile.remotePreference === "onsite_only" && job.remote) score -= 15;
  if (job.remote && profile.remotePreference !== "onsite_only") {
    score += 5;
    reasons.push("Remote");
  } else if (locationMatch) {
    score += 5;
    reasons.push(`In ${job.city ?? job.state ?? countryName(job.country)}`);
  } else if (profile.preferredLocations.length && !job.remote) {
    score -= 10;
  }

  const final = calibrateKeywordScore(score);
  return {
    score: final,
    matched: uniqueCaseInsensitive([...matchedSkills, ...matchedKeywords]),
    reason: reasons.length ? reasons.join(" · ") : "Weak keyword overlap with your profile",
  };
}
