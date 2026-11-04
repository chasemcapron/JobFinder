import type { ResumeStructure, TailoredResume } from "@/db/schema";
import { mentionsSkill } from "@/lib/jobs/scoring";
import { KNOWN_SKILLS } from "@/lib/resume/skills-dictionary";
import { containsTerm, uniqueCaseInsensitive } from "@/lib/text";
import { EDITABLE_KINDS, isShortList, splitLabel } from "./render";
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
// A degree named in full ("Master of Science", "B.S. in"), not words that only look like one ("Scrum Master", "MS Excel", "Boston, MA").
const DEGREE_NAME =
  /\b(?:bachelor(?:'s)?\b|master(?:'s)? (?:of|in|degree)\b|associate(?:'s)? (?:of|in|degree)\b|doctor(?:ate|al)? (?:of|in|degree)\b|doctorate\b|ph\.?\s?d\b|m\.?b\.?a\b|b\.?b\.?a\b|[bm]\.[as]\.? (?:in|of)\b|[bm][as] (?:in|of)\b)/i;
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
  // A word starts at a word boundary: the "M+" of "$1M+" is part of a number, not a name.
  for (const m of text.matchAll(/(?<![A-Za-z0-9])[A-Za-z][A-Za-z0-9&'+#./-]*/g)) {
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
    // "degree" on its own refers to one the resume names ("pursuing this degree" for "Master of Science").
    const namesADegree = /^degree$/i.test(m[0]) && DEGREE_NAME.test(source);
    if (!containsTerm(source, m[0]) && !namesADegree) add({ kind: "credential", term: m[0] });
  }
  return out;
}

export function describeViolations(v: Violation[]): string {
  return v.map((x) => `"${x.term}"`).join(", ");
}

export type GateResult<T> = { value: T; warnings: string[]; violations: Violation[]; notes?: Record<string, string> };

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
 * Characters on one bullet line of the resume layout (10.5pt Times across 6.5 in less the 18pt
 * indent holds ~98; measured on the owner's PDF: 100). A little under, so a rewrite never wraps
 * where the original didn't.
 */
export const LINE_CHARS = 95;

/** A rewrite that wraps to more lines than its original would push the rest of the page down. */
export function tooLong(rewrite: string, original: string): boolean {
  const lines = (s: string) => Math.max(1, Math.ceil(s.length / LINE_CHARS));
  return lines(rewrite) > lines(original);
}

/**
 * Rebuilds a tailored resume from its base, so it has the base's exact shape (every section,
 * entry, bullet and skills line, in the base's order: the user's layout stays as it was) and takes
 * from the AI only new wording for the bullets and skills lines of Experience, Projects and Skills:
 * - a rewrite that claims something its own original (and entry header) doesn't say goes back to
 *   the original wording, as does a bullet rewrite that drops one of its numbers (its results) or
 *   wraps onto more lines than the original;
 * - a skills line may reorder, emphasize or drop the skills it lists, never add one, and keeps its
 *   "Label:"; a list of single skills ("SQL", "Tableau") may be reordered or trimmed as a whole;
 * - the summary, Education and every other section stay exactly as in the resume.
 * `trusted` (the user's own edits): wording is taken as given, only the shape is enforced.
 */
export function gateTailoredResume(
  base: ResumeStructure,
  doc: TailoredResume,
  opts: { terms?: string[]; trusted?: boolean } = {},
): GateResult<TailoredResume> {
  const violations: Violation[] = [];
  // Why a piece kept its original wording, by piece key (see `pieces`).
  const notes: Record<string, string> = {};
  // Returns the rewrite when it may replace the original, else the original (with the reason noted).
  const accept = (key: string, rewrite: string | undefined, original: string, sources: (string | undefined)[], where: string, bullet: boolean): string => {
    const text = rewrite?.trim();
    if (!text || text === original) return original;
    if (opts.trusted) return text;
    const v = findUnsupported(text, sources, opts);
    if (v.length) {
      violations.push(...v);
      notes[key] = `Kept your original wording for ${where}: the rewrite added ${describeViolations(v)}.`;
      return original;
    }
    if (bullet && text.length < original.length * 0.6) {
      // Rewording, not cutting: a rewrite this much shorter has left out what the bullet said.
      notes[key] = `Kept your original wording for ${where}: the rewrite cut too much of it.`;
      return original;
    }
    if (bullet) {
      // Rewording keeps the results: a bullet that drops one of its numbers loses what it achieved.
      const kept = numbersIn(text);
      const lost = [...numbersIn(original)].filter((n) => !kept.has(n));
      if (lost.length) {
        notes[key] = `Kept your original wording for ${where}: the rewrite left out ${lost.map((n) => `"${n}"`).join(", ")}.`;
        return original;
      }
    }
    if (tooLong(text, original)) {
      notes[key] = `Kept your original wording for ${where}: the rewrite was long enough to push your layout.`;
      return original;
    }
    return text;
  };

  const sections = base.sections.map((bs) => {
    const s = EDITABLE_KINDS.has(bs.kind) ? doc.sections.find((x) => x.id === bs.id) : undefined;
    let items: string[];
    if (isShortList(bs.items) && opts.trusted) {
      // The user's own list, as they left it (any order or length; it prints as one line).
      const own = (s?.items ?? bs.items).map((i) => i.trim()).filter(Boolean);
      items = own.length ? own : [...bs.items];
    } else if (bs.items.length === 0) {
      // A section without lines (experience, projects): whatever came back as lines is ignored.
      items = [];
    } else if (isShortList(bs.items)) {
      // One list of single skills: any order, any subset, nothing new (layout: one comma-separated line).
      const picked = uniqueCaseInsensitive((s?.items ?? []).map((i) => i.trim()).filter(Boolean));
      const known = picked.map((i) => bs.items.find((b) => b.toLowerCase() === i.toLowerCase())).filter((i): i is string => Boolean(i));
      const added = picked.filter((i) => !bs.items.some((b) => b.toLowerCase() === i.toLowerCase()));
      if (added.length) notes[`${bs.id}#list`] = `Left out ${added.map((a) => `"${a}"`).join(", ")} from ${bs.heading}: not in your resume.`;
      items = known.length ? known : [...bs.items];
    } else {
      items = bs.items.map((line, k) => {
        const key = `${bs.id}#${k}`;
        let rewrite = s?.items[k]?.trim();
        const label = splitLabel(line).label;
        if (!opts.trusted && label && rewrite && !rewrite.toLowerCase().startsWith(label.toLowerCase())) {
          // Models often return just the list: the line's own label goes back in front. A different label is rejected.
          if (splitLabel(rewrite).label) {
            notes[key] = `Kept your original wording for a ${bs.heading} line: the rewrite changed its label "${label}".`;
            return line;
          }
          rewrite = `${label} ${rewrite}`;
        }
        return accept(key, rewrite, line, [line], `a ${bs.heading} line`, false);
      });
    }
    const entries = bs.entries.map((be) => {
      const te = s?.entries.find((x) => x.id === be.id);
      return {
        id: be.id,
        bullets: be.bullets.map((bb) => ({
          sourceId: bb.id,
          text: accept(bb.id, te?.bullets.find((x) => x.sourceId === bb.id)?.text, bb.text, [bb.text, be.title, be.org], `a ${be.org ?? be.title ?? bs.heading} bullet`, true),
        })),
      };
    });
    return { id: bs.id, entries, items };
  });
  return { value: { summary: base.summary, sections }, warnings: Object.values(notes), violations, notes };
}

/**
 * The rewritable pieces of a gated resume next to their originals: every bullet and skills line of
 * Experience, Projects and Skills (a list of single skills counts as one piece). Gated resumes share
 * the base's shape, so pieces line up by position.
 */
export function pieces(base: ResumeStructure, doc: TailoredResume): { key: string; original: string; text: string }[] {
  return base.sections.flatMap((bs, i) => {
    if (!EDITABLE_KINDS.has(bs.kind)) return [];
    const s = doc.sections[i];
    const lines = isShortList(bs.items)
      ? bs.items.length
        ? [{ key: `${bs.id}#list`, original: bs.items.join(", "), text: s.items.join(", ") }]
        : []
      : bs.items.map((line, k) => ({ key: `${bs.id}#${k}`, original: line, text: s.items[k] }));
    const bullets = bs.entries.flatMap((be, j) => be.bullets.map((bb, k) => ({ key: bb.id, original: bb.text, text: s.entries[j].bullets[k].text })));
    return [...bullets, ...lines];
  });
}

/** How many of the rewritable pieces a gated resume rewrote, out of how many. */
export function rewriteCount(base: ResumeStructure, doc: TailoredResume): { rewritten: number; total: number } {
  const all = pieces(base, doc);
  return { rewritten: all.filter((p) => p.text !== p.original).length, total: all.length };
}

/**
 * Two gated answers to the same request, merged piece by piece: each bullet and skills line takes
 * the second answer's rewrite, else the first's, else stays as written; a "kept your original
 * wording" note is kept only for pieces that did stay as written. Both answers already passed the
 * gate, so whatever is picked is truthful.
 */
export function mergeGated(base: ResumeStructure, first: GateResult<TailoredResume>, second: GateResult<TailoredResume>): GateResult<TailoredResume> {
  const notes: Record<string, string> = {};
  const pick = <T,>(key: string, unchanged: (v: T) => boolean, a: T, b: T): T => {
    const value = !unchanged(b) ? b : a;
    if (unchanged(value)) {
      const note = second.notes?.[key] ?? first.notes?.[key];
      if (note) notes[key] = note;
    }
    return value;
  };
  const sections = base.sections.map((bs, i) => {
    const [fa, fb] = [first.value.sections[i], second.value.sections[i]];
    const items = isShortList(bs.items)
      ? pick(`${bs.id}#list`, (v: string[]) => v.join("\n") === bs.items.join("\n"), fa.items, fb.items)
      : bs.items.map((line, k) => pick(`${bs.id}#${k}`, (v: string) => v === line, fa.items[k], fb.items[k]));
    return {
      id: bs.id,
      items,
      entries: bs.entries.map((be, j) => ({
        id: be.id,
        bullets: be.bullets.map((bb, k) => ({
          sourceId: bb.id,
          text: pick(bb.id, (v: string) => v === bb.text, fa.entries[j].bullets[k].text, fb.entries[j].bullets[k].text),
        })),
      })),
    };
  });
  return { value: { summary: base.summary, sections }, warnings: Object.values(notes), violations: [...first.violations, ...second.violations], notes };
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
