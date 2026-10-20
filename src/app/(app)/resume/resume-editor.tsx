"use client";

import { useActionState, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Alert, Badge, Card, CardHeader, cx, EmptyState, FieldHint, Icon, inputClass, Label, selectClass } from "@/components/ui";
import { EXPERIENCE_LEVELS, type ExperienceLevel } from "@/db/schema";
import { EXPERIENCE_LABELS } from "@/lib/jobs/experience";
import { analyzeResumeAction, saveResumeProfile, type AnalyzeState } from "./actions";

type Draft = {
  resumeText: string;
  fileName: string | null;
  skills: string[];
  titles: string[];
  keywords: string[];
  excludeKeywords: string[];
  seniority: ExperienceLevel | null;
};

/** `aiLabel` names the AI that reads the resume ("Gemini"), or null when only the built-in extractor is available. */
export function ResumeEditor({ saved, aiLabel }: { saved: Draft & { updatedAt: string | null }; aiLabel: string | null }) {
  const [analyzeState, analyzeAction] = useActionState<AnalyzeState, FormData>(analyzeResumeAction, null);
  const [mode, setMode] = useState<"file" | "text">("file");

  // A fresh analysis replaces the editor's defaults; otherwise show what's saved.
  const draft: Draft =
    analyzeState?.ok === true
      ? {
          resumeText: analyzeState.text,
          fileName: analyzeState.fileName,
          ...analyzeState.analysis,
          // Keep exclusions the user added earlier; the AI's suggestions are added to them.
          excludeKeywords: [
            ...new Map(
              [...saved.excludeKeywords, ...analyzeState.analysis.excludeKeywords].map((k) => [k.toLowerCase(), k] as const),
            ).values(),
          ],
        }
      : saved;
  const draftKey = analyzeState?.ok === true ? `a-${analyzeState.text.length}-${analyzeState.analysis.skills.join()}` : "saved";
  const hasDraft = analyzeState?.ok === true || Boolean(saved.resumeText) || saved.skills.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          icon={<Icon name="upload" />}
          title="1. Upload"
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
                "rounded-md px-3 py-1 font-medium transition-colors",
                mode === m ? "bg-surface text-foreground shadow-xs" : "text-muted hover:text-foreground",
              )}
            >
              {m === "file" ? "Upload file" : "Paste text"}
            </button>
          ))}
        </div>
        <form action={analyzeAction} className="flex flex-col gap-4">
          {mode === "file" ? (
            <div>
              <Label htmlFor="file">Resume file</Label>
              <input
                id="file"
                name="file"
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className={cx(inputClass, "cursor-pointer")}
              />
              <FieldHint>PDF or .docx, up to 4 MB.</FieldHint>
            </div>
          ) : (
            <div>
              <Label htmlFor="text">Resume text</Label>
              <textarea id="text" name="text" rows={10} className={inputClass} placeholder="Paste your resume here…" />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton label="Extract" icon={<Icon name="search" />} pendingLabel={aiLabel ? `Reading with ${aiLabel}…` : "Extracting…"} />
            {analyzeState?.ok === false ? <Alert tone="error">{analyzeState.message}</Alert> : null}
            {analyzeState?.ok === true ? (
              <Alert tone="success">
                Extracted{analyzeState.fileName ? ` from ${analyzeState.fileName}` : ""}. Review below, then save.
              </Alert>
            ) : null}
            {analyzeState?.ok === true && analyzeState.analysis.notice ? <Alert tone="warning">{analyzeState.analysis.notice}</Alert> : null}
          </div>
        </form>
      </Card>

      {hasDraft ? (
        <Card>
          <CardHeader
            icon={<Icon name="file" />}
            title="2. Review and save"
            description="Edit anything that's off. These drive job search queries and match scoring."
            action={
              analyzeState?.ok === true ? (
                <Badge tone={analyzeState.analysis.source === "heuristic" ? "neutral" : "accent"} dot>
                  {analyzeState.analysis.source === "heuristic"
                    ? "Keyword extractor"
                    : `Extracted by ${analyzeState.analysis.source === "gemini" ? "Gemini" : "Claude"}`}
                </Badge>
              ) : saved.updatedAt ? (
                <Badge tone="success" dot>Saved</Badge>
              ) : null
            }
          />
          <ActionForm key={draftKey} action={saveResumeProfile} submitLabel="Save profile">
            <input type="hidden" name="fileName" value={draft.fileName ?? ""} />
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="titles" hint="(one per line, best fit first)">
                  Target titles
                </Label>
                <textarea id="titles" name="titles" rows={5} className={inputClass} defaultValue={draft.titles.join("\n")} />
              </div>
              <div>
                <Label htmlFor="seniority">Seniority</Label>
                <select id="seniority" name="seniority" defaultValue={draft.seniority ?? ""} className={selectClass}>
                  <option value="">Not sure</option>
                  {EXPERIENCE_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {EXPERIENCE_LABELS[l]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <Label htmlFor="skills" hint="(comma separated)">
                Skills
              </Label>
              <textarea id="skills" name="skills" rows={4} className={inputClass} defaultValue={draft.skills.join(", ")} />
            </div>
            <div>
              <Label htmlFor="keywords" hint="(comma separated)">
                Keywords
              </Label>
              <textarea id="keywords" name="keywords" rows={2} className={inputClass} defaultValue={draft.keywords.join(", ")} />
            </div>
            <div>
              <Label htmlFor="excludeKeywords" hint="(comma separated)">
                Skip job titles containing
              </Label>
              <textarea
                id="excludeKeywords"
                name="excludeKeywords"
                rows={2}
                className={inputClass}
                defaultValue={draft.excludeKeywords.join(", ")}
                placeholder="e.g. credit, securities, sales"
              />
              <FieldHint>Jobs with any of these words in the title are hidden, even when they share tools with your field.</FieldHint>
            </div>
            <details className="group">
              <summary className="cursor-pointer rounded-control text-sm font-medium text-accent-text">Resume text ({draft.resumeText.length.toLocaleString()} characters)</summary>
              <textarea
                name="resumeText"
                rows={14}
                className={`${inputClass} mt-2 font-mono text-xs`}
                defaultValue={draft.resumeText}
              />
            </details>
          </ActionForm>
        </Card>
      ) : (
        <EmptyState icon={<Icon name="file" />} title="No profile yet">
          Upload a resume or paste its text above. You can review and edit the extracted skills and titles before anything is saved.
        </EmptyState>
      )}
    </div>
  );
}
