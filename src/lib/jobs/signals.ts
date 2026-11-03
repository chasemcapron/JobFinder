import { CLEARANCE_RE, YEARS_RE } from "./requirements";

/**
 * The parts of a posting that decide fit, within a character budget, for the AI scorer.
 *
 * Postings open with company boilerplate and close with benefits and legal text; the old blind
 * 2,500-character cut often kept the "About us" and lost the requirements. This keeps, in order:
 * fact lines (years, clearance, degree, certifications, citizenship, remote/on-site, shift, travel)
 * wherever they appear, then required qualifications, responsibilities, preferred
 * qualifications, other sections, and the opening summary. Benefits, EEO and "about the company"
 * sections are dropped. Postings with no headings (most federal ones) keep their opening text.
 */

/** Section headings by what they hold. Checked in order: "Preferred Qualifications" is preferred, not required. */
const HEADING_KINDS: [Kind, RegExp][] = [
  // "About Acme" is the company; "About the role", "About this position" and "About you" are not.
  ["boilerplate", /^about (?!(the|this) (role|job|position|opportunity)\b|you\b)/i],
  // "Who we are" is the company; "Who we are looking for" is the requirements.
  ["boilerplate", /\b(benefits?|perks|what we offer|compensation|salary|pay (range|transparency)|equal (employment )?opportunity|eeo|accommodations?|why (join|work)|who we are(?! looking)|our (mission|values|culture|story)|life at|diversity|privacy|disclaimer|how to apply|additional information|req(uisition)? id)\b/i],
  ["preferred", /\b(preferred|nice[- ]to[- ]haves?|bonus( points)?|desired|ideally|pluses|a plus|good to have)\b/i],
  ["required", /\b(requirements?|qualifications?|what you('ll)? (need|bring)|what we('re| are)? looking for|you (have|bring|might be)|who you are|about you|must[- ]haves?|minimum|basic|skills|education|what we need|ideal candidate|competenc(y|ies)|specialized experience)\b/i],
  ["duties", /\b(responsibilit(y|ies)|what you('ll| will)? (do|be doing)|duties|about (the|this) (role|job|position)|the (role|opportunity)|your role|day[- ]to[- ]day|in this role|job (description|summary)|overview|position summary|summary)\b/i],
];
type Kind = "boilerplate" | "preferred" | "required" | "duties" | "other" | "intro";
const ORDER: Kind[] = ["required", "duties", "preferred", "other", "intro"];

/** Paragraphs that are legal or HR boilerplate wherever they appear. */
const BOILERPLATE_PARAGRAPH =
  /\b(equal opportunity employer|without regard to|reasonable accommodations?|e-verify|pay transparency|drug[- ]free|fair chance|protected veteran|affirmative action|privacy (policy|notice)|applicants with arrest)\b/i;

const FACT_PATTERNS: RegExp[] = [
  new RegExp(YEARS_RE.source, "i"),
  CLEARANCE_RE,
  /\b(bachelor'?s|master'?s|associate'?s degree|degree in|ged|high school diploma)\b/i,
  /\b(certification|certified|security\+|comptia|ccna|itil|a\+)/i,
  /\b(u\.?s\.? citizens?(hip)?|citizenship|work authorization|sponsorship)\b/i,
  /\b(fully remote|remote[- ](first|eligible|position|role)|hybrid|on[- ]?site|in[- ]office|days (a|per) week|relocat\w+)\b/i,
  /\b(shifts?|weekends?|on[- ]call|overtime)\b/i,
  /\btravel\b/i,
];
const MAX_FACTS = 8;
const MAX_FACT_CHARS = 220;
/** Without headings, how much of the opening text to keep. */
const NO_HEADING_CHARS = 1_400;

export type Signals = { text: string; facts: string[]; sections: { kind: Kind; heading: string }[] };

/**
 * A short single line that names a known kind of section, ends with a colon, or is in Title Case
 * ("Your Impact"). Other short lines are content: postings made of one <p> per line ("Bachelor's
 * degree in Computer Science") would otherwise turn each requirement into an empty heading.
 */
function isHeading(block: string): boolean {
  const line = block.trim();
  if (line.includes("\n") || !line || line.length > 70 || /[.!?]$/.test(line) || /^[-•*]/.test(line)) return false;
  if (/:$/.test(line) || kindOf(line) !== "other") return true;
  const words = line.split(/\s+/);
  return words.length <= 6 && words.every((w) => w.length < 4 || /^[A-Z0-9&(]/.test(w));
}

function kindOf(heading: string): Kind {
  return HEADING_KINDS.find(([, re]) => re.test(heading))?.[0] ?? "other";
}

/**
 * Sentences or bullet lines that state a hard requirement or condition. `sources` holds the
 * full text of each one that was listed whole, so the sections can leave it out.
 */
function factLines(paragraphs: string[]): { facts: string[]; sources: string[] } {
  const facts: string[] = [];
  const sources: string[] = [];
  const seen = new Set<string>();
  for (const para of paragraphs) {
    for (const piece of para.split(/\n+|(?<=[.!?])\s+(?=[A-Z])/)) {
      const line = piece.replace(/^[-•*\s]+/, "").trim();
      if (line.length < 12 || !FACT_PATTERNS.some((re) => re.test(line))) continue;
      const short = line.length > MAX_FACT_CHARS ? `${line.slice(0, MAX_FACT_CHARS - 1)}…` : line;
      const key = short.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      facts.push(short);
      if (short === line) sources.push(line);
      if (facts.length >= MAX_FACTS) return { facts, sources };
    }
  }
  return { facts, sources };
}

/** The text with the listed fact lines and sentences taken out, and the bullets they leave empty. */
function withoutFacts(text: string, sources: string[]): string {
  let out = text;
  for (const s of sources) out = out.split(s).join("");
  return out
    .split("\n")
    .filter((l) => l.replace(/[-•*\s]/g, "").length > 0)
    .join("\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Cuts text to `max` characters at a line, bullet or sentence boundary when one is close. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const at = Math.max(head.lastIndexOf("\n"), head.lastIndexOf(". "));
  return `${at > max * 0.6 ? head.slice(0, at + 1) : head}…`;
}

export function extractSignals(description: string, opts: { budget?: number } = {}): Signals {
  const budget = opts.budget ?? 2_400;
  const blocks = description
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  // Group paragraphs under the heading before them; text before any heading is the intro.
  const sections: { kind: Kind; heading: string; paragraphs: string[] }[] = [{ kind: "intro", heading: "", paragraphs: [] }];
  for (const block of blocks) {
    if (isHeading(block)) sections.push({ kind: kindOf(block), heading: block.replace(/:$/, ""), paragraphs: [] });
    else sections[sections.length - 1].paragraphs.push(block);
  }
  // A "heading" with nothing under it was a short line of content ("Python and SQL skills"):
  // give it back to the section before, unless that's boilerplate.
  for (let i = sections.length - 1; i > 0; i--) {
    if (sections[i].paragraphs.length || sections[i].kind === "boilerplate") continue;
    const [empty] = sections.splice(i, 1);
    sections[i - 1].paragraphs.push(empty.heading);
  }
  const kept = sections
    .filter((s) => s.kind !== "boilerplate")
    .map((s) => ({ ...s, paragraphs: s.paragraphs.filter((p) => !BOILERPLATE_PARAGRAPH.test(p)) }))
    .filter((s) => s.paragraphs.length);

  const { facts, sources } = factLines(kept.flatMap((s) => s.paragraphs));
  const parts: string[] = facts.length ? [`Key facts:\n${facts.map((f) => `- ${f}`).join("\n")}`] : [];
  let left = budget - (parts[0]?.length ?? 0);

  const hasHeadings = sections.length > 1;
  const ordered = ORDER.flatMap((kind) => kept.filter((s) => s.kind === kind));
  for (const s of ordered) {
    if (left < 120) break;
    // Fact lines are already listed up front; don't spend the budget on them twice.
    const body = withoutFacts(s.paragraphs.join("\n"), sources);
    if (!body) continue;
    const cap = !hasHeadings && s.kind === "intro" ? Math.min(left, NO_HEADING_CHARS) : left;
    const block = s.heading ? `${s.heading}:\n${cut(body, cap - s.heading.length - 2)}` : cut(body, cap);
    parts.push(block);
    left -= block.length + 2;
  }
  return { text: parts.join("\n\n"), facts, sections: ordered.map(({ kind, heading }) => ({ kind, heading })) };
}
