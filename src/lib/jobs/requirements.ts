import type { ClearanceRequirement, ExperienceLevel } from "@/db/schema";

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15,
};
const NUMBER = `(\\d{1,2}|${Object.keys(WORD_NUMBERS).join("|")})`;

/**
 * "3+ years of experience", "minimum of 5 years' relevant experience", "two (2) years experience",
 * "2-4 years of hands-on experience". The number must be followed by years and then "experience"
 * within a few words, so "for over 25 years, Acme has…" doesn't count.
 */
const YEARS_RE = new RegExp(
  `\\b${NUMBER}(?:\\s*\\(\\d{1,2}\\))?\\s*(?:\\+|plus)?\\s*(?:(?:-|–|to)\\s*\\d{1,2}\\s*)?\\+?\\s*(?:years?|yrs?)['’]?[^.;:\\n]{0,40}?\\bexperience`,
  "gi",
);

/** The smallest years-of-experience figure a posting asks for (requirements usually come before "preferred"); null if none. */
export function requiredYears(description: string): number | null {
  let min: number | null = null;
  for (const m of description.matchAll(YEARS_RE)) {
    const raw = m[1].toLowerCase();
    const n = WORD_NUMBERS[raw] ?? Number(raw);
    if (Number.isFinite(n) && n <= 20 && (min === null || n < min)) min = n;
  }
  return min;
}

/** 0-2 years reads as entry level, 3-4 mid, 5-7 senior, 8+ lead. */
export function levelFromYears(years: number): ExperienceLevel {
  if (years <= 2) return "entry";
  if (years <= 4) return "mid";
  if (years <= 7) return "senior";
  return "lead";
}


// Bare "secret" only next to a clearance word, so "trade secret" or "secret management" don't count.
// A Public Trust background check isn't a clearance and is easy to get, so it isn't listed.
const CLEARANCE_RE =
  /\b(ts\s*\/\s*sci|top[\s-]secret|secret[\s-](?:level\s+)?clearance|(?:active|current|interim|final)\s+secret|clearance|polygraph|ci[\s-]poly|full[\s-]scope[\s-]poly)\b/i;
/** Phrases that mean the employer gets you the clearance after hiring. */
const OBTAINABLE_RE = /\b(ability|able|eligib\w*|willing(?:ness)?|sponsor\w*|obtain\w*|qualify)\b/i;
/** "...and eligible for polygraph", "with the ability to obtain SCI": about an add-on, not the clearance itself. */
const OBTAIN_CLAUSE_RE = /\b(?:ability|able|eligib\w*|willing\w*|capable)\s+(?:and\s+willing\s+)?(?:to\s+)?(?:obtain|get|be granted|receive|pass|for)\b[^,;]*/gi;
/** You must already hold it. */
const HELD_RE = /\b(?:active|current(?:ly)?|existing|in place)\b|\bmust\s+(?:hold|possess)\b|\bpossess(?:es|ion of)?\s+an?\b|\bmust have an?\s+(?:active|current|valid|dod|ts|top|secret)/i;
/** Required, without saying whether they'll sponsor it ("Secret clearance required"). */
const REQUIRED_RE = /\b(?:required|requires|must)\b/i;
/** GDIT and others use labelled fields: "Clearance Level Must Currently Possess:\nSecret" (or "None"). */
const HELD_FIELD_RE = /clearance level must currently possess:\s*([^\n]*)/i;
const OBTAIN_FIELD_RE = /clearance level must be able to obtain:\s*([^\n]*)/i;

/**
 * Whether a posting needs a security clearance: "active" when you must already hold one (most
 * defense-contractor roles), "obtain" when they'll sponsor it, null when it doesn't come up.
 * Checked sentence by sentence; one "active" sentence outweighs any number of "obtain" ones.
 * Tuned on live Leidos, GDIT and Booz Allen postings (2026-10-20).
 */
export function clearanceRequirement(description: string): ClearanceRequirement | null {
  const held = HELD_FIELD_RE.exec(description)?.[1].trim();
  if (held && !/^none\b/i.test(held)) return "active";
  const toObtain = OBTAIN_FIELD_RE.exec(description)?.[1].trim();
  let found: ClearanceRequirement | null = toObtain && !/^none\b/i.test(toObtain) ? "obtain" : null;

  const text = description
    .replace(new RegExp(HELD_FIELD_RE.source, "gi"), " ")
    .replace(new RegExp(OBTAIN_FIELD_RE.source, "gi"), " ")
    .replace(/\bU\.S\./g, "US"); // so "Clearance: U.S. Citizenship with an active TS/SCI" stays one sentence
  for (const sentence of text.split(/(?<=[.!?;])\s+|\n+/)) {
    if (!CLEARANCE_RE.test(sentence)) continue;
    if (/\b(no|not)\s+(?:security\s+)?clearance\b|clearance\s+(?:is\s+)?not\s+required/i.test(sentence)) continue;
    const core = sentence.replace(OBTAIN_CLAUSE_RE, " ");
    if (HELD_RE.test(core)) return "active";
    if (REQUIRED_RE.test(core) && !OBTAINABLE_RE.test(sentence)) return "active";
    found = "obtain";
  }
  return found;
}
