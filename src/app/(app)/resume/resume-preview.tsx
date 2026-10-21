import { buttonClass, Card, CardHeader, Icon } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { docxToHtml, type StoredResume } from "@/lib/resume/file-store";

/** Light "paper" styling for the converted .docx, so it reads like the document it came from. */
const DOCX_STYLES = `<style>
  html { background: #ffffff; }
  body { margin: 0 auto; max-width: 52rem; padding: 2.5rem 2.75rem; color: #1c1c1e;
    font: 14px/1.55 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  h1, h2, h3 { line-height: 1.25; margin: 1.2em 0 0.4em; } h1 { font-size: 1.6em; } h2 { font-size: 1.25em; }
  p { margin: 0 0 0.6em; } ul, ol { margin: 0 0 0.8em; padding-left: 1.4em; } li { margin: 0.15em 0; }
  table { border-collapse: collapse; } td, th { padding: 2px 6px; vertical-align: top; }
  a { color: #1d4ed8; } img { max-width: 100%; }
</style>`;

/** The saved resume as the user uploaded it: PDF inline, .docx converted to HTML, pasted text as text. */
export async function ResumePreview({
  file,
  resumeText,
  savedAt,
}: {
  file: StoredResume | null;
  resumeText: string;
  savedAt: Date | null;
}) {
  const docxHtml = file?.kind === "docx" ? await docxToHtml(file.data) : null;
  const subtitle = [file?.fileName ?? (resumeText ? "Pasted text" : null), savedAt ? `saved ${formatDateTime(savedAt)}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card id="saved-resume" className="scroll-mt-4">
      <CardHeader
        icon={<Icon name="file" />}
        title="Your saved resume"
        description={subtitle}
        action={
          file ? (
            <div className="flex flex-wrap gap-2">
              {file.kind === "pdf" ? (
                <a href="/api/resume/file" target="_blank" rel="noreferrer" className={buttonClass("secondary", "sm")}>
                  <Icon name="external-link" className="size-3.5" />
                  Open
                </a>
              ) : null}
              <a href="/api/resume/file?download=1" className={buttonClass("secondary", "sm")}>
                <Icon name="download" className="size-3.5" />
                Download
              </a>
            </div>
          ) : null
        }
      />
      {file?.kind === "pdf" ? (
        <object
          data="/api/resume/file"
          type="application/pdf"
          aria-label={`Preview of ${file.fileName}`}
          className="h-[75vh] min-h-96 w-full rounded-control border border-border bg-surface-subtle"
        >
          {/* Shown where the browser can't display PDFs inline (most phones). */}
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted">
            <p>Your browser can&apos;t show the PDF here.</p>
            <a href="/api/resume/file" target="_blank" rel="noreferrer" className={buttonClass("primary", "sm")}>
              Open {file.fileName}
            </a>
          </div>
        </object>
      ) : docxHtml !== null ? (
        <iframe
          title={`Preview of ${file?.fileName ?? "resume"}`}
          // Empty sandbox: no scripts, forms or navigation from the converted document.
          sandbox=""
          srcDoc={`<!doctype html><meta charset="utf-8">${DOCX_STYLES}${docxHtml}`}
          className="h-[75vh] min-h-96 w-full rounded-control border border-border bg-white"
        />
      ) : (
        <div className="max-h-[75vh] overflow-y-auto rounded-control border border-border bg-surface-subtle p-4 text-sm leading-relaxed whitespace-pre-wrap sm:p-6">
          {resumeText}
        </div>
      )}
      {!file && resumeText ? (
        <p className="mt-3 text-xs text-muted">Upload the PDF or .docx again to see it here exactly as it looks.</p>
      ) : null}
    </Card>
  );
}
