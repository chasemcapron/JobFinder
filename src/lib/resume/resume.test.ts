import { readFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { analyzeResumeHeuristically } from "./analyze";
import { cleanExtractedText, detectResumeKind, extractResumeText } from "./extract-text";

const sample = readFileSync(path.join(process.cwd(), "tests/fixtures/sample-resume.txt"), "utf8");

/** Builds a minimal one-page PDF containing the given lines (Helvetica, uncompressed). */
function makePdf(lines: string[]): Buffer {
  const content = ["BT", "/F1 12 Tf", "72 720 Td", "14 TL", ...lines.map((l) => `(${l.replace(/[()\\]/g, "\\$&")}) Tj T*`), "ET"].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

/** Builds a minimal .docx with one paragraph per line. */
async function makeDocx(lines: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  const paras = lines.map((l) => `<w:p><w:r><w:t>${l}</w:t></w:r></w:p>`).join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("detectResumeKind", () => {
  it("detects by mime type or extension", () => {
    expect(detectResumeKind("cv.pdf", "")).toBe("pdf");
    expect(detectResumeKind("cv.DOCX", "application/octet-stream")).toBe("docx");
    expect(detectResumeKind("cv.txt", "text/plain")).toBe("text");
    expect(detectResumeKind("cv.doc", "application/msword")).toBeNull();
  });
});

describe("cleanExtractedText", () => {
  it("normalizes whitespace but keeps paragraphs", () => {
    expect(cleanExtractedText("a  \t b\r\n\r\n\r\n\r\nc \n d")).toBe("a b\n\nc\nd");
  });
  it("removes pdf-parse page markers", () => {
    expect(cleanExtractedText("page one\n\n-- 1 of 2 --\n\npage two\n\n-- 2 of 2 --")).toBe("page one\n\npage two");
  });
});

describe("extractResumeText", () => {
  it("extracts text from a PDF", async () => {
    const text = await extractResumeText(makePdf(["Senior Software Engineer", "TypeScript and Kubernetes"]), "pdf");
    expect(text).toContain("Senior Software Engineer");
    expect(text).toContain("TypeScript and Kubernetes");
  });

  it("extracts text from a .docx", async () => {
    const text = await extractResumeText(await makeDocx(["Data Analyst", "SQL, Tableau, Python"]), "docx");
    expect(text).toBe("Data Analyst\n\nSQL, Tableau, Python");
  });

  it("rejects an empty document", async () => {
    await expect(extractResumeText(Buffer.from("   "), "text")).rejects.toThrow(/No text/);
  });
});

describe("analyzeResumeHeuristically", () => {
  const result = analyzeResumeHeuristically(sample);

  it("finds known skills", () => {
    expect(result.skills).toEqual(
      expect.arrayContaining(["TypeScript", "Python", "Node.js", "PostgreSQL", "Kafka", "Kubernetes", "AWS", "Django"]),
    );
    expect(result.skills).not.toContain("Java");
  });

  it("finds titles without company names or dates", () => {
    expect(result.titles).toContain("Senior Software Engineer");
    expect(result.titles).toContain("Software Engineer");
    expect(result.titles.some((t) => /Example|20\d\d/.test(t))).toBe(false);
  });

  it("infers seniority from years of experience", () => {
    expect(result.seniority).toBe("senior");
  });

  it("extracts domain keywords without names, title words, or skill fragments", () => {
    expect(result.keywords).toContain("payments");
    expect(result.keywords).not.toContain("alex");
    expect(result.keywords).not.toContain("engineer");
    expect(result.keywords).not.toContain("node");
    expect(result.source).toBe("heuristic");
  });
});
