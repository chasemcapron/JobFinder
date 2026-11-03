"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Alert, Badge, Button, buttonClass, Card, cx, Icon, inputClass } from "@/components/ui";
import type { TailoredResume } from "@/db/schema";
import { diffTailored, type WordOp } from "@/lib/tailor/diff";
import { COVER_GREETING, COVER_LETTER_WORDS as WORDS, COVER_SIGN_OFF, fileName, renderTailored, wordCount as countWords, type Contact } from "@/lib/tailor/render";
import { containsTerm } from "@/lib/text";
import { coverLetterAction, prepareResumeAction, saveEditsAction, tailorResumeAction } from "./actions";
import type { VersionView } from "./view";

type Tab = "resume" | "letter" | "changes";

/**
 * The tailoring page: generate a version (three steps, one Server Action each), edit it, see what
 * changed from the base resume, and download the resume and cover letter as PDF or Word. Downloads
 * are built in the browser from what's on screen, unsaved edits included.
 */
export function TailorWorkspace({
  jobId,
  job,
  versions,
  current,
  contact,
  today,
  canGenerate,
}: {
  jobId: string;
  job: { title: string; company: string };
  versions: { version: number; applied: boolean; edited: boolean }[];
  current: VersionView | null;
  contact: Contact;
  today: string;
  canGenerate: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("resume");
  const [resume, setResume] = useState<TailoredResume | null>(current?.resume ?? null);
  const [paragraphs, setParagraphs] = useState<string[] | null>(current?.paragraphs?.length ? current.paragraphs : null);
  const [warnings, setWarnings] = useState<string[]>(current?.warnings ?? []);
  const [dirty, setDirty] = useState(false);

  function generate() {
    startTransition(async () => {
      setError(null);
      setNotice(null);
      setStatus("Reading your resume into sections…");
      const prep = await prepareResumeAction(jobId);
      if (!prep.ok) return fail(prep.message);
      setStatus("Tailoring your resume…");
      const made = await tailorResumeAction(jobId);
      if (!made.ok) return fail(made.message);
      setStatus("Writing your cover letter…");
      const letter = await coverLetterAction(jobId, made.data);
      if (!letter.ok) setError(`Your resume is ready, but the cover letter failed: ${letter.message} Use "Write the cover letter" to try again.`);
      setStatus(null);
      router.push(`/jobs/${jobId}/tailor?v=${made.data}`);
      router.refresh();
    });
  }

  function fail(message: string) {
    setStatus(null);
    setError(message);
  }

  function retryLetter() {
    if (!current) return;
    startTransition(async () => {
      setError(null);
      setStatus("Writing your cover letter…");
      const r = await coverLetterAction(jobId, current.version);
      setStatus(null);
      if (!r.ok) return fail(r.message);
      setParagraphs(r.data.paragraphs?.length ? r.data.paragraphs : null);
      setWarnings(r.data.warnings);
    });
  }

  function save() {
    if (!current || !resume) return;
    startTransition(async () => {
      setError(null);
      const r = await saveEditsAction(jobId, current.version, resume, paragraphs);
      if (!r.ok) return fail(r.message);
      setResume(r.data.resume);
      setParagraphs(r.data.paragraphs?.length ? r.data.paragraphs : null);
      setDirty(false);
      setNotice("Saved.");
    });
  }

  const edit = (fn: (r: TailoredResume) => TailoredResume) => {
    if (!resume) return;
    setResume(fn(structuredClone(resume)));
    setDirty(true);
    setNotice(null);
  };

  if (!current || !resume) {
    return (
      <Card className="flex flex-col items-start gap-3">
        <p className="text-sm text-muted">
          Makes a resume and a 250-350 word cover letter for this posting from your saved resume: the posting&apos;s most relevant
          experience first, its terms where your resume backs them up, nothing added. Takes about a minute.
        </p>
        <Button onClick={generate} loading={pending} disabled={!canGenerate}>
          <Icon name="sparkles" className="size-4" />
          {pending ? status ?? "Working…" : "Tailor my resume and cover letter"}
        </Button>
        {error ? <Alert tone="error">{error}</Alert> : null}
      </Card>
    );
  }

  const base = current.base;
  const letterWords = countWords((paragraphs ?? []).join(" "));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">Version</span>
        {versions.map((v) => (
          <Link
            key={v.version}
            href={`/jobs/${jobId}/tailor?v=${v.version}`}
            aria-current={v.version === current.version ? "page" : undefined}
            className={buttonClass(v.version === current.version ? "primary" : "secondary", "sm")}
          >
            {v.version}
            {v.applied ? " · sent" : ""}
          </Link>
        ))}
        <Button variant="secondary" size="sm" onClick={generate} loading={pending && Boolean(status)} disabled={!canGenerate || pending}>
          <Icon name="refresh" className="size-3.5" />
          New version
        </Button>
        {current.applied ? <Badge tone="success">Sent with your application</Badge> : null}
      </div>

      {status ? <Alert tone="info">{status}</Alert> : null}
      {!paragraphs && !status ? (
        <Alert tone="warning" title="No cover letter yet">
          Writing it failed or hasn&apos;t run yet.{" "}
          <button className="font-medium underline" onClick={retryLetter} disabled={pending || !canGenerate}>
            Write the cover letter
          </button>
        </Alert>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      {warnings.length ? (
        <Alert tone="warning" title="Kept truthful">
          <ul className="list-disc pl-4">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Tailored documents" className="flex gap-1 rounded-control border border-border p-1">
          {(["resume", "letter", "changes"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cx("rounded-control px-3 py-1.5 text-sm font-medium", tab === t ? "bg-section text-section-on" : "text-muted hover:text-foreground")}
            >
              {{ resume: "Resume", letter: "Cover letter", changes: "Changes from your resume" }[t]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {dirty ? (
            <Button size="sm" onClick={save} loading={pending && !status}>
              Save edits
            </Button>
          ) : notice ? (
            <span className="self-center text-sm text-muted">{notice}</span>
          ) : null}
          <Downloads
            onError={setError}
            build={() => ({
              resume: renderTailored(base, resume, contact),
              letter: paragraphs ? { contact, date: today, company: job.company, role: job.title, paragraphs } : null,
              name: fileName(contact.name, job.company),
            })}
          />
        </div>
      </div>

      {tab === "resume" ? (
        <ResumeEditor base={base} resume={resume} edit={edit} />
      ) : tab === "letter" ? (
        <Card className="flex flex-col gap-3">
          {paragraphs ? (
            <>
              <p className="text-sm">{COVER_GREETING}</p>
              {paragraphs.map((p, i) => (
                <textarea
                  key={i}
                  aria-label={`Paragraph ${i + 1}`}
                  className={cx(inputClass, "field-sizing-content min-h-24 py-2 leading-relaxed")}
                  value={p}
                  onChange={(e) => {
                    const next = [...paragraphs];
                    next[i] = e.target.value;
                    setParagraphs(next);
                    setDirty(true);
                    setNotice(null);
                  }}
                />
              ))}
              <p className="text-sm">
                {COVER_SIGN_OFF}
                <br />
                {contact.name ?? ""}
              </p>
              <p className={cx("text-sm", letterWords < WORDS.min || letterWords > WORDS.max ? "text-danger-fg" : "text-muted")}>
                {letterWords} words (aim for {WORDS.min}-{WORDS.max})
              </p>
            </>
          ) : (
            <div className="flex flex-col items-start gap-2">
              <p className="text-sm text-muted">This version has no cover letter yet.</p>
              <Button onClick={retryLetter} loading={pending} disabled={!canGenerate}>
                Write the cover letter
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <Changes base={base} resume={resume} />
      )}
    </div>
  );
}

function Downloads({
  build,
  onError,
}: {
  build: () => { resume: ReturnType<typeof renderTailored>; letter: import("@/lib/tailor/render").CoverLetterView | null; name: string };
  onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  async function download(kind: "resume" | "letter", format: "pdf" | "docx") {
    const key = `${kind}-${format}`;
    setBusy(key);
    try {
      const { resume, letter, name } = build();
      let blob: Blob;
      if (format === "docx") {
        const [{ Packer }, docx] = await Promise.all([import("docx"), import("@/lib/tailor/export-docx")]);
        blob = await Packer.toBlob(kind === "resume" ? docx.resumeDocx(resume) : docx.coverLetterDocx(letter!));
      } else {
        const [{ pdf }, pdfDocs] = await Promise.all([import("@react-pdf/renderer"), import("./pdf")]);
        blob = await pdf(kind === "resume" ? <pdfDocs.ResumePdf view={resume} /> : <pdfDocs.CoverLetterPdf view={letter!} />).toBlob();
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name || "Tailored"} - ${kind === "resume" ? "Resume" : "Cover letter"}.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2_000);
    } catch (err) {
      console.error(err);
      onError("Couldn't build that file. Try again.");
    } finally {
      setBusy(null);
    }
  }
  const hasLetter = Boolean(build().letter);
  const btn = (kind: "resume" | "letter", format: "pdf" | "docx", label: string) => (
    <Button variant="secondary" size="sm" onClick={() => download(kind, format)} loading={busy === `${kind}-${format}`} disabled={Boolean(busy)}>
      <Icon name="download" className="size-3.5" />
      {label}
    </Button>
  );
  return (
    <>
      {btn("resume", "pdf", "Resume PDF")}
      {btn("resume", "docx", "Resume Word")}
      {hasLetter ? btn("letter", "pdf", "Letter PDF") : null}
      {hasLetter ? btn("letter", "docx", "Letter Word") : null}
    </>
  );
}

function ResumeEditor({
  base,
  resume,
  edit,
}: {
  base: VersionView["base"];
  resume: TailoredResume;
  edit: (fn: (r: TailoredResume) => TailoredResume) => void;
}) {
  return (
    <Card className="flex flex-col gap-5">
      <section className="flex flex-col gap-1.5">
        <h2 className="text-xs font-bold tracking-wide text-muted uppercase">Summary</h2>
        <textarea
          aria-label="Summary"
          className={cx(inputClass, "field-sizing-content min-h-16 py-2")}
          value={resume.summary ?? ""}
          placeholder="No summary"
          onChange={(e) => edit((r) => ({ ...r, summary: e.target.value }))}
        />
      </section>
      {resume.sections.map((s, si) => {
        const bs = base.sections.find((x) => x.id === s.id);
        if (!bs) return null;
        // A base item counts as used when it, or a skill taken from it, is listed (as in the Changes view).
        const droppedItems = bs.items.filter((i) => !s.items.some((k) => k === i || containsTerm(i, k)));
        return (
          <section key={s.id} className="flex flex-col gap-2">
            <h2 className="border-b border-border pb-1 text-xs font-bold tracking-wide text-muted uppercase">{bs.heading}</h2>
            {bs.items.length ? (
              <div className="flex flex-wrap gap-1.5">
                {s.items.map((item) => (
                  <button
                    key={item}
                    className="rounded-pill border border-border px-2.5 py-0.5 text-sm hover:border-danger"
                    title="Leave out"
                    onClick={() => edit((r) => (r.sections[si].items = r.sections[si].items.filter((x) => x !== item), r))}
                  >
                    {item} <span aria-hidden>×</span>
                    <span className="sr-only">(leave out)</span>
                  </button>
                ))}
                {droppedItems.map((item) => (
                  <button
                    key={item}
                    className="rounded-pill border border-dashed border-border px-2.5 py-0.5 text-sm text-muted"
                    title="Add back"
                    onClick={() => edit((r) => (r.sections[si].items.push(item), r))}
                  >
                    + {item}
                  </button>
                ))}
              </div>
            ) : null}
            {s.entries.map((e, ei) => {
              const be = bs.entries.find((x) => x.id === e.id);
              if (!be) return null;
              const dropped = be.bullets.filter((b) => !e.bullets.some((x) => x.sourceId === b.id));
              return (
                <div key={e.id} className="flex flex-col gap-1.5">
                  <p className="flex flex-wrap justify-between gap-x-3 text-sm">
                    <span className="font-semibold">{[be.title, be.org].filter(Boolean).join(", ")}</span>
                    <span className="text-muted">{[be.location, be.dates].filter(Boolean).join(" · ")}</span>
                  </p>
                  {e.bullets.map((b, bi) => (
                    <div key={b.sourceId} className="flex items-start gap-2">
                      <textarea
                        aria-label="Bullet"
                        className={cx(inputClass, "field-sizing-content min-h-9 flex-1 py-1.5")}
                        value={b.text}
                        onChange={(ev) => edit((r) => ((r.sections[si].entries[ei].bullets[bi].text = ev.target.value), r))}
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Leave this bullet out"
                        onClick={() => edit((r) => (r.sections[si].entries[ei].bullets.splice(bi, 1), r))}
                      >
                        <Icon name="x" className="size-4" />
                      </Button>
                    </div>
                  ))}
                  {dropped.map((b) => (
                    <button
                      key={b.id}
                      className="rounded-control border border-dashed border-border px-2 py-1 text-left text-sm text-muted hover:text-foreground"
                      onClick={() => edit((r) => (r.sections[si].entries[ei].bullets.push({ sourceId: b.id, text: b.text }), r))}
                    >
                      + Add back: {b.text}
                    </button>
                  ))}
                </div>
              );
            })}
          </section>
        );
      })}
    </Card>
  );
}

function Ops({ ops }: { ops: WordOp[] }) {
  return (
    <>
      {ops.map((o, i) =>
        o.op === "same" ? (
          <span key={i}>{o.text} </span>
        ) : o.op === "add" ? (
          <ins key={i} className="bg-success-bg text-success-fg no-underline">
            {o.text}{" "}
          </ins>
        ) : (
          <del key={i} className="bg-danger-bg text-danger-fg">
            {o.text}{" "}
          </del>
        ),
      )}
    </>
  );
}

const STATUS_LABEL = { kept: "Kept", moved: "Moved up", rephrased: "Rephrased", dropped: "Left out" } as const;
const STATUS_TONE = { kept: "neutral", moved: "info", rephrased: "warning", dropped: "danger" } as const;

function Changes({ base, resume }: { base: VersionView["base"]; resume: TailoredResume }) {
  const changes = useMemo(() => diffTailored(base, resume), [base, resume]);
  const { counts, summary } = changes;
  return (
    <Card className="flex flex-col gap-5">
      <p className="text-sm text-muted">
        {counts.rephrased} rephrased, {counts.moved} moved, {counts.dropped} left out, {counts.kept} kept as written. Employers, titles,
        dates and schools always come from your resume.
      </p>
      <section className="flex flex-col gap-1.5">
        <h2 className="text-xs font-bold tracking-wide text-muted uppercase">Summary · {summary.status}</h2>
        {summary.ops.length ? (
          <p className="text-sm leading-relaxed">
            <Ops ops={summary.ops} />
          </p>
        ) : (
          <p className="text-sm">{summary.after ?? summary.before ?? "None"}</p>
        )}
      </section>
      {changes.sections.map((s) => (
        <section key={s.id} className="flex flex-col gap-2">
          <h2 className="border-b border-border pb-1 text-xs font-bold tracking-wide text-muted uppercase">
            {s.heading}
            {s.moved ? " · moved" : ""}
          </h2>
          {s.items.dropped.length || s.items.reordered ? (
            <p className="text-sm">
              {s.items.reordered ? "Reordered for this posting. " : ""}
              {s.items.dropped.length ? `Left out: ${s.items.dropped.join(", ")}` : ""}
            </p>
          ) : null}
          {s.entries.map((e) => (
            <div key={e.id} className="flex flex-col gap-1">
              <p className="text-sm font-semibold">{e.label}</p>
              <ul className="flex flex-col gap-1.5">
                {e.bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <Badge tone={STATUS_TONE[b.status]}>{STATUS_LABEL[b.status]}</Badge>
                    <span className={cx("leading-relaxed", b.status === "dropped" && "text-muted line-through")}>
                      {b.status === "rephrased" ? <Ops ops={b.ops} /> : b.text}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </Card>
  );
}
