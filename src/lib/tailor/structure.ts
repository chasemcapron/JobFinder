import { createHash } from "node:crypto";
import { z } from "zod";
import { RESUME_SECTION_KINDS, type ResumeSection, type ResumeStructure } from "@/db/schema";
import type { AiJsonFn } from "@/lib/jobs/ai-score";

/**
 * Splits a resume into sections, entries and bullets, so tailoring can point at the resume's own
 * content by id instead of writing it out again. The AI only reads the (redacted) text and copies
 * from it; code then confirms every piece against the text and leaves out anything that isn't
 * there, so the base the tailoring works from is the resume itself.
 */

export function resumeHash(resumeText: string): string {
  return createHash("sha256").update(resumeText).digest("hex");
}

const ParsedSchema = z.object({
  summary: z.string().nullable().describe("The resume's own summary or objective paragraph, copied exactly; null if it has none"),
  sections: z.array(
    z.object({
      heading: z.string().describe("The section heading as written, e.g. Experience, Education, Skills, Projects"),
      kind: z.enum(RESUME_SECTION_KINDS),
      entries: z
        .array(
          z.object({
            title: z.string().nullable().describe("Job title, degree or project name, copied exactly"),
            org: z.string().nullable().describe("Employer, school or organization, copied exactly"),
            location: z.string().nullable(),
            dates: z.string().nullable().describe("Dates as written, e.g. 'May 2024 - Present'"),
            bullets: z.array(z.string()).describe("Each bullet or line under the entry, copied exactly, without the bullet symbol"),
          }),
        )
        .describe("Jobs, schools, projects or certifications; empty for a plain list section"),
      items: z.array(z.string()).describe("For a skills (or similar list) section: each item, copied exactly; otherwise empty"),
    }),
  ),
});

/** The parse step's answer, before it's confirmed against the resume text. */
export type ParsedResume = z.infer<typeof ParsedSchema>;

const SYSTEM = `You split a resume into its parts. Copy text exactly as written: never rephrase, summarize, correct, merge or add anything. Keep the resume's order. A line that belongs to no entry goes in its section's items. Personal details are already replaced by placeholders like [name] and [email]; leave contact lines out.`;

/** Lowercase, one space, no bullet symbols or curly quotes: how pieces are compared to the text. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[•▪●◦·*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const words = (s: string) => new Set(normalize(s).split(" ").filter((w) => w.length > 2));

/**
 * The resume's own words for a piece: itself when the text contains it; otherwise the resume line
 * it overlaps most (80%+ of its words), e.g. when the model joined a wrapped line slightly
 * differently; otherwise nothing.
 */
function confirm(piece: string | null | undefined, text: string, lines: string[]): string | null {
  const p = piece?.trim();
  if (!p) return null;
  if (normalize(text).includes(normalize(p))) return p;
  const want = words(p);
  if (want.size < 3) return null;
  let best: { line: string; score: number } | null = null;
  for (const line of lines) {
    const have = words(line);
    let shared = 0;
    for (const w of want) if (have.has(w)) shared++;
    const score = shared / Math.max(want.size, have.size);
    if (!best || score > best.score) best = { line, score };
  }
  return best && best.score >= 0.8 ? best.line.replace(/^\s*[-•▪●◦*]\s*/, "").trim() : null;
}

/** Builds the structure from the model's answer, keeping only what the resume text contains. */
export function confirmStructure(parsed: ParsedResume, text: string): ResumeStructure {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const warnings: string[] = [];
  const field = (value: string | null, what: string) => {
    if (!value?.trim()) return undefined;
    const ok = normalize(text).includes(normalize(value));
    if (!ok) warnings.push(`Left out ${what} "${value}": it isn't in your resume text.`);
    return ok ? value.trim() : undefined;
  };

  const summary = parsed.summary ? confirm(parsed.summary, text, lines) : null;
  if (parsed.summary && !summary) warnings.push("Left out the summary: it didn't match your resume text.");

  const sections: ResumeSection[] = parsed.sections.map((s, i) => {
    const sid = `s${i + 1}`;
    const items = s.items.filter((item) => {
      const ok = item.trim() && normalize(text).includes(normalize(item));
      if (item.trim() && !ok) warnings.push(`Left out "${item}" from ${s.heading}: it isn't in your resume text.`);
      return ok;
    });
    return {
      id: sid,
      heading: s.heading.trim() || s.kind,
      kind: s.kind,
      items: items.map((x) => x.trim()),
      entries: s.entries.map((e, j) => {
        const eid = `${sid}.e${j + 1}`;
        const bullets: string[] = [];
        for (const b of e.bullets) {
          const line = confirm(b, text, lines);
          if (line) bullets.push(line);
          else if (b.trim()) warnings.push(`Left out a line that isn't in your resume text: "${b.slice(0, 80)}"`);
        }
        return {
          id: eid,
          title: field(e.title, "the title"),
          org: field(e.org, "the organization"),
          location: field(e.location, "the location"),
          dates: field(e.dates, "the dates"),
          bullets: bullets.map((t, k) => ({ id: `${eid}.b${k + 1}`, text: t })),
        };
      }),
    };
  });
  return { summary, sections, warnings, source: text };
}

/** Parses the (redacted) resume text. Throws AiUnavailableError when the AI is busy. */
export async function parseResumeStructure(redactedText: string, opts: { ai: AiJsonFn; deadline: number }): Promise<{ structure: ResumeStructure; model: string }> {
  const { data, model } = await opts.ai({
    schema: ParsedSchema,
    system: SYSTEM,
    prompt: `<resume>\n${redactedText}\n</resume>`,
    tier: "fast",
    maxTokens: 8_000,
    deadline: opts.deadline,
  });
  return { structure: confirmStructure(data, redactedText), model };
}
