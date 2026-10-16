// Vercel rejects request bodies over 4.5 MB.
export const MAX_RESUME_BYTES = 4 * 1024 * 1024;

export type ResumeKind = "pdf" | "docx" | "text";

export function detectResumeKind(fileName: string, mimeType: string): ResumeKind | null {
  const name = fileName.toLowerCase();
  if (mimeType === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    name.endsWith(".docx")
  )
    return "docx";
  if (mimeType.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md")) return "text";
  return null;
}

/** Collapses the whitespace noise PDF/DOCX extraction produces, keeping line breaks. */
export function cleanExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    // pdf-parse page separators, e.g. "-- 1 of 2 --"
    .replace(/^\s*-- \d+ of \d+ --\s*$/gm, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * pdf.js needs DOMMatrix at load time and gets it from @napi-rs/canvas, which has
 * no build for some platforms (e.g. Windows on ARM). Text extraction doesn't render
 * anything, so a pure-JS matrix is enough there.
 */
async function ensureDomMatrix() {
  if (typeof globalThis.DOMMatrix !== "undefined") return;
  try {
    const canvas = await import("@napi-rs/canvas");
    if (canvas.DOMMatrix) {
      (globalThis as Record<string, unknown>).DOMMatrix = canvas.DOMMatrix;
      return;
    }
  } catch {
    // native binding unavailable on this platform
  }
  const { default: CSSMatrix } = await import("@thednp/dommatrix");
  (globalThis as Record<string, unknown>).DOMMatrix = CSSMatrix;
}

export async function extractResumeText(data: Buffer, kind: ResumeKind): Promise<string> {
  let text: string;
  if (kind === "pdf") {
    await ensureDomMatrix();
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(data) });
    try {
      text = (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  } else if (kind === "docx") {
    const mammoth = await import("mammoth");
    text = (await mammoth.extractRawText({ buffer: data })).value;
  } else {
    text = data.toString("utf8");
  }
  const cleaned = cleanExtractedText(text);
  if (!cleaned) {
    throw new Error(
      kind === "pdf"
        ? "No text found in that PDF. If it's a scanned image, paste the text instead."
        : "No text found in that file.",
    );
  }
  return cleaned;
}
