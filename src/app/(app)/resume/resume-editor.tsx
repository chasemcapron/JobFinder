"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/action-form";
import { Alert, Badge, Card, CardHeader, inputClass, Label } from "@/components/ui";
import { EXPERIENCE_LEVELS, type ExperienceLevel } from "@/db/schema";
import { EXPERIENCE_LABELS } from "@/lib/jobs/experience";
import { analyzeResumeAction, saveResumeProfile, type AnalyzeState } from "./actions";

type Draft = {
  resumeText: string;
  fileName: string | null;
  skills: string[];
  titles: string[];
  keywords: string[];
  seniority: ExperienceLevel | null;
};

export function ResumeEditor({ saved, aiEnabled }: { saved: Draft & { updatedAt: string | null }; aiEnabled: boolean }) {
  const [analyzeState, analyzeAction] = useActionState<AnalyzeState, FormData>(analyzeResumeAction, null);
  const [saveState, saveAction] = useActionState(saveResumeProfile, null);
  const [mode, setMode] = useState<"file" | "text">("file");

  // A fresh analysis replaces the editor's defaults; otherwise show what's saved.
  const draft: Draft =
    analyzeState?.ok === true
      ? { resumeText: analyzeState.text, fileName: analyzeState.fileName, ...analyzeState.analysis }
      : saved;
  const draftKey = analyzeState?.ok === true ? `a-${analyzeState.text.length}-${analyzeState.analysis.skills.join()}` : "saved";
  const hasDraft = analyzeState?.ok === true || Boolean(saved.resumeText) || saved.skills.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          title="1. Upload"
          description={
            aiEnabled
              ? "Your resume is sent to Claude to extract structured data."
              : "ANTHROPIC_API_KEY isn't set, so a built-in keyword extractor is used instead of Claude."
          }
        />
        <div role="tablist" className="mb-4 inline-flex rounded-md border border-border p-0.5 text-sm">
          {(["file", "text"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`rounded px-3 py-1 ${mode === m ? "bg-accent text-accent-foreground" : "text-muted"}`}
            >
              {m === "file" ? "Upload file" : "Paste text"}
            </button>
          ))}
        </div>
        <form action={analyzeAction} className="flex flex-col gap-4">
          {mode === "file" ? (
            <div>
              <Label htmlFor="file" hint="(PDF or .docx, up to 4 MB)">
                Resume file
              </Label>
              <input
                id="file"
                name="file"
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-2 file:text-accent-foreground"
              />
            </div>
          ) : (
            <div>
              <Label htmlFor="text">Resume text</Label>
              <textarea id="text" name="text" rows={10} className={inputClass} placeholder="Paste your resume here…" />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton label="Extract" pendingLabel={aiEnabled ? "Analyzing with Claude…" : "Extracting…"} />
            {analyzeState?.ok === false ? <Alert tone="error">{analyzeState.message}</Alert> : null}
            {analyzeState?.ok === true ? (
              <Alert tone="info">
                Extracted{analyzeState.fileName ? ` from ${analyzeState.fileName}` : ""}. Review below, then save.
              </Alert>
            ) : null}
          </div>
        </form>
      </Card>

      {hasDraft ? (
        <Card>
          <CardHeader
            title="2. Review and save"
            description="Edit anything that's off. These drive job search queries and match scoring."
            action={
              analyzeState?.ok === true ? (
                <Badge tone={analyzeState.analysis.source === "claude" ? "blue" : "amber"}>
                  {analyzeState.analysis.source === "claude" ? "Extracted by Claude" : "Keyword extractor"}
                </Badge>
              ) : saved.updatedAt ? (
                <Badge>Saved</Badge>
              ) : null
            }
          />
          <form key={draftKey} action={saveAction} className="flex flex-col gap-4" onReset={(e) => e.preventDefault()}>
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
                <select id="seniority" name="seniority" defaultValue={draft.seniority ?? ""} className={inputClass}>
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
            <details>
              <summary className="cursor-pointer text-sm font-medium">Resume text ({draft.resumeText.length.toLocaleString()} characters)</summary>
              <textarea
                name="resumeText"
                rows={14}
                className={`${inputClass} mt-2 font-mono text-xs`}
                defaultValue={draft.resumeText}
              />
            </details>
            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton label="Save profile" />
              {saveState ? <Alert tone={saveState.ok ? "success" : "error"}>{saveState.message}</Alert> : null}
            </div>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
