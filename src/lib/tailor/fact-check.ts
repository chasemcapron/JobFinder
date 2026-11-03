import type { ResumeStructure, TailoredResume } from "@/db/schema";
import { mentionsSkill } from "@/lib/jobs/scoring";
import { KNOWN_SKILLS } from "@/lib/resume/skills-dictionary";
import { containsTerm } from "@/lib/text";
export { wordCount } from "./render";

/**
 * The truthfulness gate for tailored resumes and cover letters. Tailoring may only reorder,
 * emphasize, rephrase or leave out what the resume already says, so any generated text is checked
 * against its source, and anything it can't back up is reverted (a bullet goes back to the base
 * wording, a summary to the base summary) or dropped (a cover-letter sentence):
 * - numbers (metrics, years, counts, dates) must appear in the source;
 * - skills and tools (the skills dictionary, plus the posting's terms the resume lacks) must be in it;
 * - names (capitalized words past a sentence's start, acronyms): employers, schools, products,
 *   certifications;
 * - degrees, certifications, licences and clearances must be named in it.
 * Employers, titles, dates and schools in the tailored resume are copied from the base by code and
 * never generated, so they can't be invented; this catches them inside generated sentences.
 * "Reformulate, never fabricate" follows career-ops' tailoring rules (github.com/career-ops-hq/career-ops, MIT).
 */

export type Violation = { kind: "number" | "skill" | "name" | "credential"; term: string };

const NUMBER = /\$?\d[\d,]*(?:\.\d+)?%?/g;
const CREDENTIAL = /\b(?:certifi\w*|licen[sc]\w*|clearance|bachelor\w*|master'?s|ph\.?\s?d\.?|doctorate|associate'?s degree|mba|degree)\b/gi;
// Words a letter or resume uses capitalized for their own sake, not as names.
const PLAIN_CAPITALIZED = new Set([
  "i", "i'm", "i've", "i'd", "i'll", "dear", "hiring", "manager", "team", "sincerely", "regards", "best", "thank",
  "thanks", "warm", "respectfully", "yours", "hello", "mr", "ms", "mrs", "dr",
]);

const normalizeNumber = (n: string) => n.replace(/[$,]/g, "").replace(/\.0+$/, "");

function numbersIn(text: string): Set<string> {
  return new Set([...text.matchAll(NUMBER)].map((m) => normalizeNumber(m[0])));
}

/** Words that start a sentence, a bullet or a line: capitalized for grammar, not because they're names. */
function sentenceStarts(text: string): Set<number> {
  const starts = new Set<number>();
  const re = /(?:^|[.!?:;]\s+|\n\s*(?:[-•*]\s*)?|^\s*[-•*]\s*)(["“(]?)([A-Za-z])/g;
  for (const m of text.matchAll(re)) starts.add(m.index + m[0].length - 1);
  return starts;
}

/** Capitalized words past a sentence's start, and acronyms anywhere. */
function namesIn(text: string): string[] {
  const starts = sentenceStarts(text);
  const out: string[] = [];
  for (const m of text.matchAll(/[A-Za-z][A-Za-z0-9&'+#./-]*/g)) {
    const word = m[0].replace(/[.'-]+$/, "");
    const acronym = /^[A-Z0-9&+#./-]{2,}$/.test(word) && /[A-Z]/.test(word);
    const capitalized = /^[A-Z]/.test(word) && !starts.has(m.index);
    if ((acronym || capitalized) && !PLAIN_CAPITALIZED.has(word.toLowerCase())) out.push(word);
  }
  return out;
}

/**
 * What `text` claims that `sources` don't back up. `terms` adds skill-like terms to check (the
 * posting's requirements, so a tool only the posting names can't slip in); `allowedNames` are
 * names the text may use without the source having them (the employer, in a cover letter).
 */
export function findUnsupported(
  text: string,
  sources: (string | null | undefined)[],
  opts: { terms?: string[]; allowedNames?: string[] } = {},
): Violation[] {
  const source = sources.filter(Boolean).join("\n");
  const out: Violation[] = [];
  const seen = new Set<string>();
  const add = (v: Violation) => {
    const key = `${v.kind}:${v.term.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(v);
    }
  };

  const sourceNumbers = numbersIn(source);
  for (const n of numbersIn(text)) if (!sourceNumbers.has(n)) add({ kind: "number", term: n });

  for (const skill of [...KNOWN_SKILLS, ...(opts.terms ?? [])]) {
    if (skill.trim().length < 2) continue;
    if (mentionsSkill(text, skill) && !mentionsSkill(source, skill)) add({ kind: "skill", term: skill });
  }

  const allowed = (opts.allowedNames ?? []).join("\n");
  for (const name of namesIn(text)) {
    if (!containsTerm(source, name) && !containsTerm(allowed, name)) add({ kind: "name", term: name });
  }

  for (const m of text.matchAll(CREDENTIAL)) {
    if (!containsTerm(source, m[0])) add({ kind: "credential", term: m[0] });
  }
  return out;
}

export function describeViolations(v: Violation[]): string {
  return v.map((x) => `"${x.term}"`).join(", ");
}

export type GateResult<T> = { value: T; warnings: string[]; violations: Violation[] };

/**
 * Everything the resume says, for the summary's and cover letter's source: the (redacted) resume
 * text itself, which also holds lines the parse didn't place, plus the parsed pieces.
 */
export function resumeFacts(base: ResumeStructure): string {
  const lines: string[] = [];
  if (base.source) lines.push(base.source);
  if (base.summary) lines.push(base.summary);
  for (const s of base.sections) {
    lines.push(s.heading, ...s.items);
    for (const e of s.entries) lines.push(...[e.title, e.org, e.location, e.dates].filter((x): x is string => Boolean(x)), ...e.bullets.map((b) => b.text));
  }
  return lines.join("\n");
}

/**
 * Checks a tailored resume against its base and returns a truthful, complete one:
 * - only sections, entries and bullets the base has (by id), each once. Sections and bullets take
 *   the AI's order; entries (jobs, schools) keep the base's, so dates stay in order. Every base
 *   section and entry is kept (a section the AI skipped comes back as in the base, an entry left
 *   with no bullets gets its first one back): leaving out a whole job would hide a date gap;
 * - skills only from the base section's own list (all of them if the AI listed none);
 * - a bullet whose new wording claims something its base bullet (and entry header) doesn't say
 *   goes back to the base wording; a summary that claims something the resume doesn't, to the base
 *   summary (or none).
 */
export function gateTailoredResume(base: ResumeStructure, doc: TailoredResume, opts: { terms?: string[] } = {}): GateResult<TailoredResume> {
  const warnings: string[] = [];
  const violations: Violation[] = [];
  const facts = resumeFacts(base);

  let summary = doc.summary?.trim() || null;
  if (summary) {
    const v = findUnsupported(summary, [facts], opts);
    if (v.length) {
      violations.push(...v);
      warnings.push(`Summary kept as in your resume: the rewrite added ${describeViolations(v)}.`);
      summary = base.summary;
    }
  }

  const sections: TailoredResume["sections"] = [];
  const usedSections = new Set<string>();
  for (const s of doc.sections) {
    const bs = base.sections.find((x) => x.id === s.id);
    if (!bs || usedSections.has(s.id)) continue;
    usedSections.add(s.id);
    // An item is the base's when it's one of its items or part of one: resumes often list skills
    // in a sentence ("Proficient with SQL, AWS and C#"), which the model splits into "SQL", "AWS".
    const baseItems = bs.items.join("\n");
    const items: string[] = [];
    for (const raw of s.items) {
      const item = raw.trim().replace(/[.;,]+$/, "");
      if (!item) continue;
      const known = bs.items.find((i) => i.toLowerCase() === item.toLowerCase()) ?? (containsTerm(baseItems, item) ? item : null);
      if (known && !items.some((i) => i.toLowerCase() === known.toLowerCase())) items.push(known);
      else if (!known) warnings.push(`Left out "${item}": it isn't in your resume's ${bs.heading}.`);
    }
    const entries: TailoredResume["sections"][number]["entries"] = [];
    for (const be of bs.entries) {
      const e = s.entries.find((x) => x.id === be.id) ?? { id: be.id, bullets: be.bullets.map((b) => ({ sourceId: b.id, text: b.text })) };
      const bullets: TailoredResume["sections"][number]["entries"][number]["bullets"] = [];
      const usedBullets = new Set<string>();
      for (const b of e.bullets) {
        const bb = be.bullets.find((x) => x.id === b.sourceId);
        if (!bb || usedBullets.has(b.sourceId)) continue;
        usedBullets.add(b.sourceId);
        const text = b.text.trim();
        const v = text ? findUnsupported(text, [bb.text, be.title, be.org], opts) : [];
        if (!text || v.length) {
          if (v.length) {
            violations.push(...v);
            warnings.push(`Kept your original wording for a ${be.org ?? be.title ?? bs.heading} bullet: the rewrite added ${describeViolations(v)}.`);
          }
          bullets.push({ sourceId: bb.id, text: bb.text });
        } else {
          bullets.push({ sourceId: bb.id, text });
        }
      }
      if (bullets.length === 0 && be.bullets.length) bullets.push({ sourceId: be.bullets[0].id, text: be.bullets[0].text });
      entries.push({ id: be.id, bullets });
    }
    sections.push({ id: bs.id, entries, items: items.length ? items : [...bs.items] });
  }
  for (const bs of base.sections) {
    if (usedSections.has(bs.id)) continue;
    sections.push({
      id: bs.id,
      items: [...bs.items],
      entries: bs.entries.map((be) => ({ id: be.id, bullets: be.bullets.map((b) => ({ sourceId: b.id, text: b.text })) })),
    });
  }
  return { value: { summary, sections }, warnings, violations };
}

/** Splits a paragraph into sentences (keeping their punctuation). */
export function sentences(paragraph: string): string[] {
  return paragraph.split(/(?<=[.!?])\s+(?=["“(]?[A-Z0-9])/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Checks a cover letter against the resume: a sentence that claims something the resume doesn't
 * back up is dropped. `allowedNames` holds the employer, the job title and names from the posting,
 * which a letter may mention; claims (numbers, skills, credentials) still have to be the resume's.
 */
export function gateCoverLetter(
  paragraphs: string[],
  base: ResumeStructure,
  opts: { terms?: string[]; allowedNames?: string[] } = {},
): GateResult<string[]> {
  const facts = resumeFacts(base);
  const warnings: string[] = [];
  const violations: Violation[] = [];
  const out: string[] = [];
  for (const p of paragraphs) {
    const kept: string[] = [];
    for (const s of sentences(p)) {
      const v = findUnsupported(s, [facts], opts);
      if (v.length) {
        violations.push(...v);
        warnings.push(`Dropped a sentence that added ${describeViolations(v)}: "${s.length > 90 ? `${s.slice(0, 89)}…` : s}"`);
      } else kept.push(s);
    }
    if (kept.length) out.push(kept.join(" "));
  }
  return { value: out, warnings, violations };
}
