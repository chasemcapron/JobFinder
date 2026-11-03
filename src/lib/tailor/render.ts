import type { ResumeSectionKind, ResumeStructure, TailoredResume } from "@/db/schema";

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

/**
 * A list section's lines: short items ("SQL", "Tableau") on one comma-separated line; items that
 * are sentences or labeled lines ("Technical Skills: Proficient with ..."), one per line.
 */
export function itemLines(items: string[]): string[] {
  if (items.length === 0) return [];
  return items.every((i) => i.length <= 40 && !i.includes(":")) ? [items.join(", ")] : items;
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
