import { AlignmentType, BorderStyle, Document, Paragraph, TabStopPosition, TabStopType, TextRun } from "docx";
import { COVER_GREETING, COVER_SIGN_OFF, itemLines, type Contact, type CoverLetterView, type ResumeView } from "./render";

/**
 * Word versions of the tailored resume and cover letter, built in the browser (no server, no
 * Chromium). ATS-friendly: one column, real text, standard headings, no tables or images.
 */

const FONT = "Calibri";
const page = { margin: { top: 720, bottom: 720, left: 900, right: 900 } };
const styles = { default: { document: { run: { font: FONT, size: 21 } } } };

function contactLine(c: Contact): string {
  return [c.location, c.phone, c.email, ...c.links].filter(Boolean).join("  |  ");
}

function header(c: Contact): Paragraph[] {
  const out: Paragraph[] = [];
  if (c.name) out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: c.name, bold: true, size: 32 })] }));
  const line = contactLine(c);
  if (line) out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun(line)] }));
  return out;
}

const heading = (text: string) =>
  new Paragraph({
    spacing: { before: 200, after: 60 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 22 })],
  });

export function resumeDocx(view: ResumeView): Document {
  const children: Paragraph[] = [...header(view.contact)];
  if (view.summary) {
    children.push(heading("Summary"), new Paragraph({ children: [new TextRun(view.summary)] }));
  }
  for (const s of view.sections) {
    children.push(heading(s.heading));
    for (const line of itemLines(s.items)) children.push(new Paragraph({ children: [new TextRun(line)] }));
    for (const e of s.entries) {
      const lead = [e.title, e.org].filter(Boolean).join(", ");
      if (lead || e.dates) {
        children.push(
          new Paragraph({
            spacing: { before: 100 },
            tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
            children: [new TextRun({ text: lead, bold: true }), ...(e.dates ? [new TextRun({ text: `\t${e.dates}` })] : [])],
          }),
        );
      }
      if (e.location) children.push(new Paragraph({ children: [new TextRun({ text: e.location, italics: true })] }));
      for (const b of e.bullets) children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(b)] }));
    }
  }
  return new Document({ creator: "Job Finder", title: "Resume", styles, sections: [{ properties: { page }, children }] });
}

export function coverLetterDocx(view: CoverLetterView): Document {
  const gap = { after: 200 };
  const children: Paragraph[] = [
    ...header(view.contact),
    new Paragraph({ spacing: gap, children: [new TextRun(view.date)] }),
    new Paragraph({ spacing: gap, children: [new TextRun(`Re: ${view.role}, ${view.company}`)] }),
    new Paragraph({ spacing: gap, children: [new TextRun(COVER_GREETING)] }),
    ...view.paragraphs.map((p) => new Paragraph({ spacing: gap, children: [new TextRun(p)] })),
    new Paragraph({ children: [new TextRun(COVER_SIGN_OFF)] }),
    ...(view.contact.name ? [new Paragraph({ children: [new TextRun(view.contact.name)] })] : []),
  ];
  return new Document({ creator: "Job Finder", title: "Cover letter", styles, sections: [{ properties: { page }, children }] });
}
