import { EXPERIENCE_LEVELS, type ExperienceLevel, type Profile } from "@/db/schema";
import { containsTerm, normalizeForKey, uniqueCaseInsensitive } from "@/lib/text";
import { EXPERIENCE_LABELS } from "./experience";
import { countryName } from "./location";
import type { NormalizedJob } from "./types";

export type MatchProfile = Pick<
  Profile,
  "skills" | "titles" | "keywords" | "searchKeywords" | "preferredLocations" | "experienceLevels" | "remotePreference" | "seniority"
> &
  Partial<Pick<Profile, "hasClearance">>;

export type ScoredJob = Pick<
  NormalizedJob,
  "title" | "description" | "city" | "state" | "country" | "remote" | "locationRaw" | "experienceLevel"
> &
  Partial<Pick<NormalizedJob, "minYears" | "clearance">>;

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

// Compounds and acronyms expanded so "Cybersecurity Analyst" and "Cyber Security Analyst" compare
// equal, and "SOC Analyst" shares words with "Security Operations Center Analyst".
const TITLE_SYNONYMS: Record<string, string[]> = {
  cybersecurity: ["cyber", "security"],
  infosec: ["information", "security"],
  appsec: ["application", "security"],
  netsec: ["network", "security"],
  secops: ["security", "operations"],
  soc: ["security", "operations"],
  grc: ["governance", "risk", "compliance"],
  iam: ["identity", "access"],
  vuln: ["vulnerability"],
  pentest: ["penetration", "tester"],
  pentester: ["penetration", "tester"],
  devsecops: ["devops", "security"],
  csirt: ["incident", "response"],
  dfir: ["forensics", "incident", "response"],
  cti: ["threat", "intelligence"],
  isso: ["information", "security", "officer"],
  developer: ["engineer"],
  dev: ["engineer"],
};

/**
 * Words that all mean security work. One of them in the job title stands in, at RELATED_CREDIT,
 * for a different one in the profile title: "SOC Analyst" is close to "Cyber Defense Analyst".
 */
const SECURITY_WORDS = new Set(["security", "cyber", "threat", "incident", "vulnerability", "penetration", "forensics", "malware", "detection", "siem"]);
const RELATED_CREDIT = 0.6;

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
  const jobHasSecurityWord = [...have].some((t) => SECURITY_WORDS.has(t));
  let points = 0;
  let fieldMatched = false;
  for (const t of want) {
    if (have.has(t)) {
      points += weight(t);
      if (!GENERIC_ROLE.has(t)) fieldMatched = true;
    } else if (SECURITY_WORDS.has(t) && jobHasSecurityWord) {
      points += weight(t) * RELATED_CREDIT;
      fieldMatched = true;
    }
  }
  const sim = points / total;
  const wantsField = want.some((t) => !GENERIC_ROLE.has(t));
  return wantsField && !fieldMatched ? Math.min(sim, 0.15) : sim;
}

/** Other ways postings write a skill, so "CompTIA Security+" on a resume matches "Sec+" in a posting. */
const SKILL_ALIASES: Record<string, string[]> = {
  "security+": ["sec+"],
  "cysa+": ["cybersecurity analyst+"],
  "network+": ["net+"],
  siem: ["security information and event management"],
  soar: ["security orchestration"],
  edr: ["endpoint detection and response", "endpoint detection & response"],
  iam: ["identity and access management", "identity & access management"],
  "microsoft sentinel": ["azure sentinel"],
  "entra id": ["azure ad", "azure active directory"],
  "azure ad": ["entra id", "azure active directory"],
  "mitre att&ck": ["att&ck", "mitre attack"],
  "nist csf": ["nist cybersecurity framework"],
  "incident response": ["incident handling"],
  "vulnerability management": ["vulnerability scanning", "vulnerability assessment"],
  "penetration testing": ["pen testing", "pentesting", "penetration tests"],
  "threat intelligence": ["threat intel", "cti"],
  "digital forensics": ["forensics", "dfir"],
};
/** Certification vendors resumes put in front of the name and postings often leave out. */
const CERT_VENDOR = /^(comptia|\(isc\)²?|isc2|ec-council|giac|cisco|microsoft)\s+/i;

/** True when the text mentions the skill under its own name, an alias, or without its cert vendor. */
export function mentionsSkill(text: string, skill: string): boolean {
  if (containsTerm(text, skill)) return true;
  const bare = skill.replace(CERT_VENDOR, "");
  if (bare !== skill && containsTerm(text, bare)) return true;
  return (SKILL_ALIASES[bare.toLowerCase()] ?? []).some((alias) => containsTerm(text, alias));
}

/** True when the job title contains one of the user's excluded words (e.g. "credit"). */
export function isExcludedTitle(title: string, excludeKeywords: string[]): boolean {
  return excludeKeywords.some((k) => containsTerm(title, k));
}

/** Steps from the candidate's level to the job's: positive when the job is more senior. */
function levelGap(job: ExperienceLevel, candidate: ExperienceLevel): number {
  return EXPERIENCE_LEVELS.indexOf(job) - EXPERIENCE_LEVELS.indexOf(candidate);
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
  const matchedSkills = profile.skills.filter((s) => mentionsSkill(text, s));
  if (profile.skills.length) {
    score += Math.min(1, matchedSkills.length / Math.min(8, profile.skills.length)) * 35;
  }
  if (matchedSkills.length) reasons.push(`Skills: ${matchedSkills.slice(0, 5).join(", ")}`);

  // Keywords (15)
  const allKeywords = uniqueCaseInsensitive([...profile.searchKeywords, ...profile.keywords]);
  const matchedKeywords = allKeywords.filter((k) => mentionsSkill(text, k));
  if (allKeywords.length) score += Math.min(1, matchedKeywords.length / Math.min(4, allKeywords.length)) * 15;
  if (matchedKeywords.length && !matchedSkills.length) reasons.push(`Keywords: ${matchedKeywords.slice(0, 4).join(", ")}`);

  // Experience level (+5 / penalties). Problems go first in the reasons, so the card leads with them.
  const problems: string[] = [];
  if (job.experienceLevel) {
    const asksFor = job.minYears ? `Asks for ${job.minYears}+ years` : `${EXPERIENCE_LABELS[job.experienceLevel]} role`;
    if (profile.experienceLevels.length) {
      if (profile.experienceLevels.includes(job.experienceLevel)) {
        score += 5;
        reasons.push(EXPERIENCE_LABELS[job.experienceLevel]);
      } else {
        score -= 20;
        problems.push(asksFor);
      }
    } else if (profile.seniority) {
      // Above your level costs far more than below it: a Senior role is out of reach for an entry-level candidate.
      const gap = levelGap(job.experienceLevel, profile.seniority);
      if (gap === 0) score += 5;
      else if (gap === 1) score -= 5;
      else if (gap >= 2) {
        score -= 12 * gap;
        problems.push(asksFor);
      } else if (gap <= -2) score -= 10 * (-gap - 1);
    }
  }

  // Security clearance: a role that needs one you don't hold is out of reach, however good the fit.
  if (job.clearance === "active") {
    if (profile.hasClearance) {
      score += 5;
      reasons.push("Uses your clearance");
    } else {
      score -= 40;
      problems.push("Needs an active clearance");
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
  const all = [...problems, ...reasons];
  return {
    score: final,
    matched: uniqueCaseInsensitive([...matchedSkills, ...matchedKeywords]),
    reason: all.length ? all.join(" · ") : "Weak keyword overlap with your profile",
  };
}
