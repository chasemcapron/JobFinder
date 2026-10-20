/**
 * Best-effort removal of personal details before resume text leaves the app. Gemini's free
 * tier may use inputs to improve Google's products, so the model gets the experience and
 * skills but not who the person is or how to reach them. City/state stay: they matter for
 * location fit and identify no one on their own.
 */

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL = /\b(?:https?:\/\/|www\.)\S+|\b(?:linkedin\.com|github\.com|gitlab\.com|twitter\.com|x\.com)\/\S*/gi;
// US-style numbers: (312) 555-0100, 312.555.0100, +1 312 555 0100
const PHONE = /(?<!\d)(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;
const STREET =
  /\b\d{1,6}\s+(?:[NSEW]\.?\s+)?(?:[A-Z][a-z]+\.?\s+){1,4}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Way|Place|Pl|Terrace|Ter|Circle|Cir|Parkway|Pkwy|Highway|Hwy)\b\.?(?:,?\s*(?:Apt|Apartment|Unit|Suite|Ste|#)\.?\s*[\w-]+)?/g;
// "Chicago, IL 60601" -> "Chicago, IL"
const STATE_ZIP = /\b([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/g;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const NOT_A_NAME =
  /\b(resume|curriculum|summary|profile|objective|experience|engineer|analyst|developer|manager|specialist|consultant|intern|security|software|data)\b/i;

/** A resume's first line is usually the person's name: 2-4 capitalized words, nothing else. */
function looksLikeName(line: string): boolean {
  const words = line.trim().split(/\s+/);
  return (
    words.length >= 2 &&
    words.length <= 4 &&
    words.every((w) => /^[A-Z][a-zA-Z'.-]*$/.test(w)) &&
    !/\d/.test(line) &&
    !NOT_A_NAME.test(line)
  );
}

export function redactPersonalInfo(text: string, opts: { names?: (string | null | undefined)[] } = {}): string {
  // The name line first, before other replacements change how it looks.
  const lines = text.split("\n");
  const first = lines.findIndex((l) => l.trim());
  if (first >= 0 && looksLikeName(lines[first])) lines[first] = "[name]";

  let out = lines
    .join("\n")
    .replace(EMAIL, "[email]")
    .replace(URL, "[link]")
    .replace(PHONE, "[phone]")
    .replace(STREET, "[address]")
    .replace(STATE_ZIP, "$1");

  // Known names (e.g. the Google account name), as a full name with an optional middle initial.
  // Single words are left alone: "Ford" or "Wells" could just as well be an employer.
  for (const name of opts.names ?? []) {
    const parts = (name ?? "")
      .trim()
      .split(/\s+/)
      .filter((p) => p.length >= 2);
    if (parts.length < 2) continue;
    const [given, ...rest] = parts.map(escapeRegExp);
    out = out.replace(new RegExp(`\\b${given}\\s+(?:[A-Z]\\.?\\s+)?${rest.join("\\s+")}\\b`, "gi"), "[name]");
  }
  return out;
}
