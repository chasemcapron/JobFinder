"use client";

import { useActionState, useEffect, useState } from "react";
import { SubmitButton } from "@/components/action-form";
import { Alert, Badge, Button, Card, CardHeader, cx, EmptyState, FieldHint, Icon, inputClass, Kicker, Label, selectClass } from "@/components/ui";
import { EXPERIENCE_LEVELS, type ExperienceLevel } from "@/db/schema";
import { EXPERIENCE_LABELS } from "@/lib/jobs/experience";
import { parseList } from "@/lib/parse-input";
import type { ResumeAnalysis } from "@/lib/resume/analyze";
import { analyzeResumeAction, saveResumeProfile, type AnalyzeState, type SaveState } from "./actions";
import { ChipField } from "./chip-field";
import { LIST_LIMITS } from "./limits";

type Draft = {
  resumeText: string;
  fileName: string | null;
  skills: string[];
  titles: string[];
  keywords: string[];
  excludeKeywords: string[];
  seniority: ExperienceLevel | null;
};

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** A fresh analysis, trimmed to what saving keeps so an unedited draft compares equal once saved. */
function draftFromAnalysis(state: Extract<AnalyzeState, { ok: true }>, saved: Draft): Draft {
  const { analysis } = state;
  const list = (items: string[], max: number) => parseList(items.join("\n"), max);
  return {
    resumeText: state.text,
    fileName: state.fileName,
    titles: list(analysis.titles, LIST_LIMITS.titles),
    skills: list(analysis.skills, LIST_LIMITS.skills),
    keywords: list(analysis.keywords, LIST_LIMITS.keywords),
    // Keep exclusions the user added earlier; the AI's suggestions are added to them.
    excludeKeywords: list([...saved.excludeKeywords, ...analysis.excludeKeywords], LIST_LIMITS.excludeKeywords),
    seniority: analysis.seniority,
  };
}

/** Form posts send a textarea's line breaks as CRLF, so the saved text can differ from the draft in those alone. */
const normalizeText = (text: string) => text.replace(/\r\n?/g, "\n").trim();

/** True when saving `draft` would change the saved profile. Empty resume text keeps the saved text (see saveResumeProfile). */
function hasChanges(draft: Draft, saved: Draft): boolean {
  const differs = (a: string[], b: string[]) => a.length !== b.length || a.some((v, i) => v !== b[i]);
  const text = normalizeText(draft.resumeText);
  return (
    differs(draft.titles, saved.titles) ||
    differs(draft.skills, saved.skills) ||
    differs(draft.keywords, saved.keywords) ||
    differs(draft.excludeKeywords, saved.excludeKeywords) ||
    draft.seniority !== saved.seniority ||
    (Boolean(text) && (text !== normalizeText(saved.resumeText) || draft.fileName !== saved.fileName))
  );
}

function sourceLabel(source: ResumeAnalysis["source"]): string {
  return source === "heuristic" ? "Keyword extractor" : `Extracted by ${source === "gemini" ? "Gemini" : "Claude"}`;
}

/** The step number in a CardHeader's colour tile. */
function StepNumber({ n }: { n: number }) {
  return <span className="font-label text-base leading-none font-bold">{n}</span>;
}

type StepState = "todo" | "current" | "done" | "unsaved";

const stepBar: Record<StepState, string> = {
  todo: "bg-surface-raised",
  current: "bg-section/50",
  done: "bg-section",
  unsaved: "bg-orange",
};
const stepText: Record<StepState, string> = {
  todo: "text-muted",
  current: "text-section-fg",
  done: "text-foreground",
  unsaved: "text-warning-fg",
};
const stepSr: Record<StepState, string> = { todo: "to do", current: "current step", done: "done", unsaved: "unsaved changes" };

/** Upload → Review → Save as three flat bars, like the header stripe. */
function Steps({ steps }: { steps: { label: string; detail: string; state: StepState }[] }) {
  return (
    <ol aria-label="Steps" className="mb-6 grid grid-cols-3 gap-2 sm:gap-3">
      {steps.map((step, i) => (
        <li key={step.label} aria-current={step.state === "current" ? "step" : undefined} className="min-w-0">
          <span aria-hidden className={cx("block h-1.5 rounded-pill transition-colors duration-300", stepBar[step.state])} />
          <span className={cx("mt-2 flex items-center gap-1", stepText[step.state])}>
            <Kicker>
              {i + 1} · {step.label}
            </Kicker>
            {step.state === "done" ? <Icon name="check" className="size-3.5 text-section-fg" /> : null}
            {step.state === "unsaved" ? <span aria-hidden className="size-1.5 rounded-full bg-orange" /> : null}
            <span className="sr-only">({stepSr[step.state]})</span>
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted">{step.detail}</span>
        </li>
      ))}
    </ol>
  );
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The file input as a drop zone: the input covers the box, so a dropped file lands on it. */
function FileDrop() {
  const [picked, setPicked] = useState<{ name: string; size: number } | null>(null);
  const tooBig = picked !== null && picked.size > MAX_UPLOAD_BYTES;
  return (
    <div>
      <label
        className={cx(
          "relative flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed px-4 py-6 text-center transition-colors",
          "focus-within:border-section focus-within:ring-3 focus-within:ring-section/25 hover:border-section",
          picked ? "border-section/60 bg-section-bg" : "border-border-strong bg-surface-subtle/60",
        )}
      >
        <input
          id="file"
          name="file"
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(e) => {
            const file = e.target.files?.[0];
            setPicked(file ? { name: file.name, size: file.size } : null);
          }}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
        <span aria-hidden className="grid size-10 place-items-center rounded-control bg-section text-section-on shadow-xs [&_svg]:size-5">
          <Icon name={picked ? "file" : "upload"} />
        </span>
        {picked ? (
          <>
            <span className="max-w-full truncate text-sm font-semibold">{picked.name}</span>
            <span className={cx("text-xs", tooBig ? "font-medium text-danger-fg" : "text-muted")}>
              {formatBytes(picked.size)} · {tooBig ? "over the 4 MB limit" : "click or drop to change"}
            </span>
          </>
        ) : (
          <>
            <span className="text-sm font-medium">
              Drop your resume here or <span className="text-section-fg underline underline-offset-2">browse</span>
            </span>
            <span className="text-xs text-muted">PDF or .docx, up to 4 MB</span>
          </>
        )}
      </label>
    </div>
  );
}

/** `aiLabel` names the AI that reads the resume ("Gemini"), or null when only the built-in extractor is available. */
export function ResumeEditor({ saved, aiLabel }: { saved: Draft & { savedAt: string | null }; aiLabel: string | null }) {
  const [analyzeState, analyzeAction] = useActionState<AnalyzeState, FormData>(analyzeResumeAction, null);
  const [saveState, saveAction] = useActionState<SaveState, FormData>(saveResumeProfile, null);
  const [mode, setMode] = useState<"file" | "text">("file");
  const { savedAt, ...savedDraft } = saved;

  // The fields start from the saved profile; each fresh analysis replaces them.
  const [draft, setDraft] = useState<Draft>(savedDraft);
  const [source, setSource] = useState<ResumeAnalysis["source"] | null>(null);
  const [seenAnalysis, setSeenAnalysis] = useState<AnalyzeState>(null);
  if (analyzeState !== seenAnalysis) {
    setSeenAnalysis(analyzeState);
    if (analyzeState?.ok) {
      setDraft(draftFromAnalysis(analyzeState, savedDraft));
      setSource(analyzeState.analysis.source);
    }
  }
  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const hasDraft = analyzeState?.ok === true || Boolean(saved.resumeText) || saved.skills.length > 0 || saved.titles.length > 0;
  const dirty = hasDraft && hasChanges(draft, savedDraft);

  // Closing or reloading the tab with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const steps: { label: string; detail: string; state: StepState }[] = [
    {
      label: "Upload",
      detail: hasDraft ? (draft.fileName ?? (draft.resumeText ? "Pasted text" : "From your profile")) : "PDF, .docx or text",
      state: hasDraft ? "done" : "current",
    },
    {
      label: "Review",
      detail: hasDraft
        ? `${draft.titles.length} title${draft.titles.length === 1 ? "" : "s"} · ${draft.skills.length} skill${draft.skills.length === 1 ? "" : "s"}`
        : "Titles, skills, level",
      state: !hasDraft ? "todo" : dirty ? "current" : "done",
    },
    {
      label: "Save",
      detail: !hasDraft ? "Re-ranks your jobs" : dirty ? "Unsaved changes" : "Saved",
      state: !hasDraft ? "todo" : dirty ? "unsaved" : "done",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Steps steps={steps} />

      <Card id="upload" className="scroll-mt-32 sm:scroll-mt-20">
        <CardHeader
          icon={<StepNumber n={1} />}
          title={saved.resumeText ? "Upload a new version" : "Upload"}
          description={
            aiLabel
              ? `${aiLabel} reads your resume and suggests job titles, skills, and titles to skip. Your name, email, phone, street address and links are removed before it's sent.`
              : "No AI key is set, so a built-in keyword extractor reads your resume."
          }
        />
        <div role="tablist" aria-label="Resume input" className="mb-4 inline-flex rounded-control border border-border bg-surface-subtle p-0.5 text-sm">
          {(["file", "text"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={cx(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1 font-medium transition-colors",
                mode === m ? "bg-section text-section-on shadow-xs" : "text-muted hover:text-foreground",
              )}
            >
              <Icon name={m === "file" ? "upload" : "file"} className="size-3.5" />
              {m === "file" ? "Upload file" : "Paste text"}
            </button>
          ))}
        </div>
        {/* Keep the chosen file or pasted text after an action, so a failed read can be retried as is. */}
        <form action={analyzeAction} onReset={(e) => e.preventDefault()} className="flex flex-col gap-4">
          {mode === "file" ? (
            <FileDrop />
          ) : (
            <div>
              <Label htmlFor="text">Resume text</Label>
              <textarea id="text" name="text" rows={10} className={inputClass} placeholder="Paste your resume here…" />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <SubmitButton label="Extract" icon={<Icon name="sparkles" />} pendingLabel={aiLabel ? `Reading with ${aiLabel}…` : "Extracting…"} />
            <span className="text-xs text-muted">Nothing is saved until step 3.</span>
          </div>
          {analyzeState?.ok === false ? <Alert tone="error">{analyzeState.message}</Alert> : null}
          {analyzeState?.ok === true ? (
            <Alert tone="success">
              Extracted{analyzeState.fileName ? ` from ${analyzeState.fileName}` : ""}.{" "}
              {dirty ? "Review below, then save." : "It matches your saved profile."}
            </Alert>
          ) : null}
          {analyzeState?.ok === true && analyzeState.analysis.notice ? <Alert tone="warning">{analyzeState.analysis.notice}</Alert> : null}
        </form>
      </Card>

      {hasDraft ? (
        <Card id="review" className="scroll-mt-32 sm:scroll-mt-20">
          <CardHeader
            icon={<StepNumber n={2} />}
            title="Review and edit"
            description="These drive job searches and match scores. Click an item to change it, × to remove it, or type to add."
            action={
              !dirty && savedAt ? (
                <Badge tone="success" dot>
                  Saved
                </Badge>
              ) : source ? (
                <Badge tone={source === "heuristic" ? "neutral" : "accent"} dot>
                  {sourceLabel(source)}
                </Badge>
              ) : null
            }
          />
          {/* React resets uncontrolled forms after an action; these fields are controlled, so opt out. */}
          <form action={saveAction} onReset={(e) => e.preventDefault()} className="flex flex-col gap-7">
            <input type="hidden" name="fileName" value={draft.fileName ?? ""} />
            <div className="grid gap-x-6 gap-y-7 md:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-5">
                <ChipField
                  id="titles"
                  name="titles"
                  label="Target titles"
                  hue="blue"
                  ranked
                  values={draft.titles}
                  onChange={(titles) => update({ titles })}
                  max={LIST_LIMITS.titles}
                  placeholder="Add a title, e.g. SOC Analyst"
                  emptyText="No titles yet. Add the roles you want, best fit first."
                  hint="Best fit first. Employer career sites are searched for the top three; every title counts in ranking."
                />
                <div id="level" className="scroll-mt-32 sm:scroll-mt-20">
                  <label htmlFor="seniority" className="mb-1.5 block text-muted">
                    <Kicker>Level you&apos;re aiming for</Kicker>
                  </label>
                  <select
                    id="seniority"
                    name="seniority"
                    value={draft.seniority ?? ""}
                    onChange={(e) => update({ seniority: (e.target.value || null) as ExperienceLevel | null })}
                    className={selectClass}
                  >
                    <option value="">Not sure</option>
                    {EXPERIENCE_LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {EXPERIENCE_LABELS[l]}
                      </option>
                    ))}
                  </select>
                  <FieldHint>Jobs above this level score lower, and much lower two or more levels up.</FieldHint>
                </div>
              </div>
              <ChipField
                id="skills"
                name="skills"
                label="Skills"
                hue="green"
                values={draft.skills}
                onChange={(skills) => update({ skills })}
                max={LIST_LIMITS.skills}
                placeholder="Add a skill, e.g. Splunk"
                hint="Tools, certifications and methods, matched against every posting."
              />
              <ChipField
                id="keywords"
                name="keywords"
                label="Keywords"
                hue="orange"
                values={draft.keywords}
                onChange={(keywords) => update({ keywords })}
                max={LIST_LIMITS.keywords}
                placeholder="Add a keyword, e.g. incident response"
                hint="Field terms that help match postings, beyond the tools you list."
              />
              <ChipField
                id="skip"
                name="excludeKeywords"
                label="Skip titles with"
                hue="pink"
                values={draft.excludeKeywords}
                onChange={(excludeKeywords) => update({ excludeKeywords })}
                max={LIST_LIMITS.excludeKeywords}
                placeholder="e.g. credit, securities, sales"
                emptyText="Nothing skipped."
                hint="Jobs with any of these words in the title are hidden, even when they share tools with your field."
              />
            </div>

            <details className="group rounded-control border border-border bg-surface-subtle/40">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-control px-3 py-2.5 select-none [&::-webkit-details-marker]:hidden">
                <span className="flex min-w-0 items-center gap-2">
                  <Kicker className="shrink-0 whitespace-nowrap">Resume text</Kicker>
                  <span className="truncate text-xs text-muted">{draft.resumeText.length.toLocaleString()} characters · what matching reads</span>
                </span>
                <Icon name="chevron-down" className="size-4 text-muted transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-3 pb-3">
                <textarea
                  name="resumeText"
                  aria-label="Resume text"
                  rows={14}
                  className={cx(inputClass, "font-mono text-xs")}
                  value={draft.resumeText}
                  onChange={(e) => update({ resumeText: e.target.value })}
                />
              </div>
            </details>

            {/* Step 3. Sticks to the bottom of the screen while there's something to save. */}
            <div
              className={cx(
                "flex flex-wrap items-center gap-x-3 gap-y-2.5 rounded-card border p-3 transition-colors",
                dirty ? "sticky bottom-3 z-10 border-warning-border bg-surface-raised shadow-raised" : "border-border bg-surface-subtle/60",
              )}
            >
              <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-control bg-section text-section-on">
                <StepNumber n={3} />
              </span>
              {/* The basis makes the buttons wrap to their own row on phones instead of squeezing this text. */}
              <div className="min-w-0 flex-1 basis-52" aria-live="polite">
                {dirty ? (
                  <>
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-warning-fg">
                      <span aria-hidden className="size-2 shrink-0 rounded-full bg-orange" />
                      Unsaved changes
                    </p>
                    <p className="text-xs text-muted">Save to re-rank your jobs with them.</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold">{savedAt ? "All changes saved" : "No changes"}</p>
                    <p className="truncate text-xs text-muted">{savedAt ? `Saved ${savedAt}` : "Nothing to save yet."}</p>
                  </>
                )}
              </div>
              <div className="ml-auto flex items-center gap-2">
                {dirty ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setDraft(savedDraft);
                      setSource(null);
                    }}
                  >
                    Discard
                  </Button>
                ) : null}
                <SubmitButton label="Save profile" variant={dirty ? "primary" : "secondary"} icon={<Icon name="check" />} />
              </div>
            </div>
            {saveState && !(saveState.ok && dirty) ? (
              <Alert tone={saveState.ok ? "success" : "error"} className="-mt-4">
                {saveState.message}
              </Alert>
            ) : null}
          </form>
        </Card>
      ) : (
        <EmptyState icon={<Icon name="file" />} title="No profile yet">
          Upload a resume or paste its text above. You can review and edit the extracted titles, skills and level before anything is
          saved.
        </EmptyState>
      )}
    </div>
  );
}
