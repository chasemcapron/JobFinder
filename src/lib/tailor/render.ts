import type { ResumeSectionKind, ResumeStructure, TailoredResume } from "@/db/schema";

/** The sections whose sentences tailoring may rewrite; every other section is copied as written. */
export const EDITABLE_KINDS: ReadonlySet<ResumeSectionKind> = new Set(["experience", "projects", "skills"]);

/** Contact details read from the resume on the server; never sent to the AI. */
export type Contact = { name: string | null; email: string | null; phone: string | null; location: string | null; links: string[] };

/**
 * A tailored resume ready to show or export (page, PDF, DOCX): the tailored choices filled in with
 * the base's headings, employers, titles and dates. Single column, standard headings, plain text,
 * so applicant tracking systems read it.
 */
export type ResumeView = {
  contact: Contact;
  summary: string | null;
  sections: {
    heading: string;
    kind: ResumeSectionKind;
    items: string[];
    entries: { title?: string; org?: string; location?: string; dates?: string; bullets: string[] }[];
  }[];
};

export function renderTailored(base: ResumeStructure, doc: TailoredResume, contact: Contact): ResumeView {
  return {
    contact,
    summary: doc.summary,
    sections: doc.sections.flatMap((s) => {
      const bs = base.sections.find((x) => x.id === s.id);
      if (!bs) return [];
      return [
        {
          heading: bs.heading,
          kind: bs.kind,
          items: s.items,
          entries: s.entries.flatMap((e) => {
            const be = bs.entries.find((x) => x.id === e.id);
            return be ? [{ title: be.title, org: be.org, location: be.location, dates: be.dates, bullets: e.bullets.map((b) => b.text) }] : [];
          }),
        },
      ];
    }),
  };
}

export type EntryView = ResumeView["sections"][number]["entries"][number];
/** One header line of an entry: text on the left, text on the right (right-aligned), each in its style. */
export type HeaderLine = { left: string; right?: string; leftStyle: "bold" | "italic"; rightStyle: "bold" | "italic" | "regular" };

/**
 * An entry's header lines, in the classic layout the owner's resume uses (and the PDF, Word file
 * and page all draw):
 * - with an organization: "Org .......... Location" in bold, then "Title .......... Dates", the title in italic;
 * - without one (a project): "Name .......... Dates" in bold, then the location in italic if there is one.
 */
export function entryLines(e: Pick<EntryView, "title" | "org" | "location" | "dates">): HeaderLine[] {
  const out: HeaderLine[] = [];
  if (e.org) {
    out.push({ left: e.org, right: e.location, leftStyle: "bold", rightStyle: "bold" });
    if (e.title || e.dates) out.push({ left: e.title ?? "", right: e.dates, leftStyle: "italic", rightStyle: "regular" });
  } else {
    if (e.title || e.dates) out.push({ left: e.title ?? "", right: e.dates, leftStyle: "bold", rightStyle: "bold" });
    if (e.location) out.push({ left: e.location, leftStyle: "italic", rightStyle: "regular" });
  }
  return out;
}

/** "Technical Skills: SQL, Python" → { label: "Technical Skills:", text: "SQL, Python" }; no label → label "". */
export function splitLabel(line: string): { label: string; text: string } {
  const m = line.match(/^([^:\n]{1,40}:)\s*([\s\S]*)$/);
  return m ? { label: m[1], text: m[2] } : { label: "", text: line };
}

/**
 * A list section's lines: short items ("SQL", "Tableau") on one comma-separated line; items that
 * are sentences or labeled lines ("Technical Skills: Proficient with ..."), one per line.
 */
export function itemLines(items: string[]): string[] {
  if (items.length === 0) return [];
  return isShortList(items) ? [items.join(", ")] : items;
}

/** Items that are single skills ("SQL", "Tableau"), shown as one comma-separated list, not lines. */
export function isShortList(items: string[]): boolean {
  return items.every((i) => i.length <= 40 && !i.includes(":"));
}

/**
 * True when a tailored resume has its base's exact shape (same summary, sections, bullets and lines,
 * in order), as every version made since tailoring became rewrite-only does. Older versions could
 * reorder and leave things out: they can still be viewed and downloaded, but not edited.
 */
export function keepsShape(base: ResumeStructure, doc: TailoredResume): boolean {
  if ((doc.summary ?? null) !== (base.summary ?? null) || doc.sections.length !== base.sections.length) return false;
  return base.sections.every((bs, i) => {
    const s = doc.sections[i];
    return (
      s.id === bs.id &&
      (isShortList(bs.items) || s.items.length === bs.items.length) &&
      s.entries.length === bs.entries.length &&
      bs.entries.every((be, j) => s.entries[j].id === be.id && be.bullets.every((bb, k) => s.entries[j].bullets[k]?.sourceId === bb.id) && s.entries[j].bullets.length === be.bullets.length)
    );
  });
}

/** The cover letter's length: checked on the server, shown in the editor. */
export const COVER_LETTER_WORDS = { min: 250, max: 350 } as const;

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

export type CoverLetterView = { contact: Contact; date: string; company: string; role: string; paragraphs: string[] };

export const COVER_GREETING = "Dear Hiring Manager,";
export const COVER_SIGN_OFF = "Sincerely,";

/** "Data Analyst-tailored" style file names, safe on every OS. */
export function fileName(...parts: (string | null | undefined)[]): string {
  return parts
    .filter(Boolean)
    .join(" - ")
    .replace(/[^\w .()-]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}
