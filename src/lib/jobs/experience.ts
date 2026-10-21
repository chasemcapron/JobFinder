import { EXPERIENCE_LEVELS, type ExperienceLevel } from "@/db/schema";

export const EXPERIENCE_LABELS: Record<ExperienceLevel, string> = {
  internship: "Internship",
  entry: "Entry level",
  mid: "Mid level",
  senior: "Senior",
  lead: "Lead / Staff / Principal",
  executive: "Director / Executive",
};

/** A level filter value: a level, or "unstated" for postings whose title and description give none (about 30%). */
export const LEVEL_UNSTATED = "unstated";
export type LevelFilter = ExperienceLevel | typeof LEVEL_UNSTATED;

// Checked in order; first match wins, so more specific patterns come first.
const TITLE_RULES: [ExperienceLevel, RegExp][] = [
  // "Student Trainee" is the federal Pathways internship title.
  ["internship", /\b(interns?|internships?|co-?ops?|apprentices?|apprenticeships?|summer (analyst|associate)s?|student trainees?)\b/i],
  ["executive", /\b(chief|cto|ceo|cfo|coo|cio|ciso|vp|vice president|svp|evp|head of|director)\b/i],
  // Unambiguous junior words outrank "manager", "lead" and "architect": "Early Career, Associate Product Manager".
  ["entry", /\b(junior|jr\.?|entry[- ]level|new grad|early career|associate (product|project|program) manager)\b/i],
  ["lead", /\b(staff|principal|distinguished|lead|architect|manager|supervisory|supervisor|sme|subject matter expert)\b/i],
  // SOC tiers: Tier 1 triages alerts (entry), Tier 2 investigates, Tier 3 hunts.
  ["senior", /\b(senior|sr\.?|iii|iv|(tier|level)[\s-]?(3|iii)|l3)\b/i],
  [
    "entry",
    /\b(junior|jr\.?|entry[- ]level|graduate|new grad|associate|assistant|trainee|early career|university|rotational|development program|(tier|level)[\s-]?(1|i)|l1)\b|\b(analyst|engineer|specialist|technician|administrator)\s+(i|1)\b|\b(i)\s*$/i,
  ],
  ["mid", /\b(mid[- ]level|intermediate|journeyman|ii|(tier|level)[\s-]?(2|ii)|l2)\b|,\s*mid\b|\bmid\s*$/i],
];

/** Infers an experience level from a job title. Returns null when the title gives no signal. */
export function inferExperienceLevel(title: string): ExperienceLevel | null {
  for (const [level, re] of TITLE_RULES) {
    if (re.test(title)) return level;
  }
  return null;
}

/** True when a job is two or more levels above the one wanted (e.g. a "Senior" role for an entry-level profile). */
export function isTooSenior(job: ExperienceLevel | null, want: ExperienceLevel | null): boolean {
  if (!job || !want) return false;
  return EXPERIENCE_LEVELS.indexOf(job) - EXPERIENCE_LEVELS.indexOf(want) >= 2;
}

export function isExperienceLevel(value: unknown): value is ExperienceLevel {
  return typeof value === "string" && (EXPERIENCE_LEVELS as readonly string[]).includes(value);
}

/** Maps free-form seniority words (e.g. from the AI or a source API) to our levels. */
export function coerceExperienceLevel(value: string | null | undefined): ExperienceLevel | null {
  if (!value) return null;
  const v = value.toLowerCase().trim();
  if (isExperienceLevel(v)) return v;
  if (/intern/.test(v)) return "internship";
  if (/entry|junior|graduate|associate/.test(v)) return "entry";
  if (/mid|intermediate/.test(v)) return "mid";
  if (/senior/.test(v)) return "senior";
  if (/staff|principal|lead/.test(v)) return "lead";
  if (/exec|director|vp|chief|head/.test(v)) return "executive";
  return inferExperienceLevel(v);
}
