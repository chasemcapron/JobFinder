import { AlignmentType, BorderStyle, Document, LevelFormat, Paragraph, TabStopType, TextRun } from "docx";
import { COVER_GREETING, COVER_SIGN_OFF, entryLines, itemLines, splitLabel, type Contact, type CoverLetterView, type HeaderLine, type ResumeView } from "./render";

/**
 * Word versions of the tailored resume and cover letter, built in the browser (no server, no
 * Chromium). Same layout as the PDF, copied from the owner's resume: Letter, 1-inch sides, Times New
 * Roman, a 22pt centered name, 11pt bold capital headings over a rule, two-line entry headers with
 * a right tab for places and dates, 10.5pt bullets with an 18pt hanging indent. One column, real
 * text, no tables or images: ATS-friendly.
 */

const FONT = "Times New Roman";
/** Twips: 1 inch = 1440. */
const page = { margin: { top: 720, bottom: 1080, left: 1440, right: 1440 } };
/** The text width between the 1-inch margins of a Letter page: the right tab stop. */
const RIGHT_TAB = 12_240 - 2 * 1440;
/** Half-points. */
const SIZE = { name: 44, header: 22, body: 21 } as const;
const styles = { default: { document: { run: { font: FONT, size: SIZE.body } } } };
const lineSpacing = { line: 268, lineRule: "exact" as const };
const BULLETS = "resume-bullets";
/** A "•" list at the left margin with the text 18pt in (360 twips), as on the owner's resume. */
const numbering = {
  config: [
    {
      reference: BULLETS,
      levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 360 } } } }],
    },
  ],
};

function contactLine(c: Contact): string {
  return [c.location, c.phone, c.email, ...c.links].filter(Boolean).join(" | ");
}

function header(c: Contact): Paragraph[] {
  const out: Paragraph[] = [];
  if (c.name) out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: c.name, bold: true, size: SIZE.name })] }));
  const line = contactLine(c);
  if (line) out.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: line, size: SIZE.header })] }));
  return out;
}

const heading = (text: string) =>
  new Paragraph({
    spacing: { before: 160, after: 40 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: "000000", space: 1 } },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size: SIZE.header })],
  });

const run = (text: string, style: HeaderLine["leftStyle"] | HeaderLine["rightStyle"]) =>
  new TextRun({ text, size: SIZE.header, bold: style === "bold", italics: style === "italic" });

const entryLine = (line: HeaderLine, first: boolean) =>
  new Paragraph({
    spacing: { before: first ? 60 : 0 },
    tabStops: [{ type: TabStopType.RIGHT, position: RIGHT_TAB }],
    children: [run(line.left, line.leftStyle), ...(line.right ? [run(`\t${line.right}`, line.rightStyle)] : [])],
  });

export function resumeDocx(view: ResumeView): Document {
  const children: Paragraph[] = [...header(view.contact)];
  if (view.summary) children.push(heading("Summary"), new Paragraph({ children: [new TextRun(view.summary)] }));
  for (const s of view.sections) {
    children.push(heading(s.heading));
    for (const item of itemLines(s.items)) {
      const { label, text } = splitLabel(item);
      children.push(new Paragraph({ children: [...(label ? [new TextRun({ text: `${label} `, bold: true, size: SIZE.header })] : []), new TextRun(text)] }));
    }
    for (const e of s.entries) {
      entryLines(e).forEach((line, i) => children.push(entryLine(line, i === 0)));
      for (const b of e.bullets) {
        // A real Word list item (ATS parsers and Word see a list), with the resume's 18pt hanging indent.
        children.push(new Paragraph({ spacing: lineSpacing, numbering: { reference: BULLETS, level: 0 }, children: [new TextRun(b)] }));
      }
    }
  }
  return new Document({ creator: "Job Finder", title: "Resume", styles, numbering, sections: [{ properties: { page }, children }] });
}

export function coverLetterDocx(view: CoverLetterView): Document {
  const gap = { after: 220 };
  const body = (text: string) => new Paragraph({ spacing: gap, children: [new TextRun({ text, size: 23 })] });
  const children: Paragraph[] = [
    ...header(view.contact),
    new Paragraph({ spacing: { after: 220 } }),
    body(view.date),
    body(`Re: ${view.role}, ${view.company}`),
    body(COVER_GREETING),
    ...view.paragraphs.map(body),
    new Paragraph({ children: [new TextRun({ text: COVER_SIGN_OFF, size: 23 })] }),
    ...(view.contact.name ? [new Paragraph({ children: [new TextRun({ text: view.contact.name, size: 23 })] })] : []),
  ];
  return new Document({ creator: "Job Finder", title: "Cover letter", styles, sections: [{ properties: { page }, children }] });
}
