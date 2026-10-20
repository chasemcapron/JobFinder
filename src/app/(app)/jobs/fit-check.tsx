"use client";

import { useState, useTransition } from "react";
import { Alert, Badge, Button, Icon, matchTone, ScoreBadge, type IconName } from "@/components/ui";
import type { FitVerdict } from "@/db/schema";
import { formatDateTime } from "@/lib/format";
import type { FitCheckView } from "@/lib/jobs/fit-checks";
import { checkFitAction } from "./fit-actions";

const VERDICT_LABELS: Record<FitVerdict, string> = {
  strong: "Strong fit",
  good: "Worth applying",
  stretch: "A stretch",
  poor: "Poor fit",
};

/**
 * "Check my fit" on a job card: an AI comparison of the saved resume with this posting.
 * The result opens in a panel under the card; earlier checks load collapsed.
 */
export function FitCheck({ jobId, initial }: { jobId: string; initial: FitCheckView | null }) {
  const [view, setView] = useState(initial);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(force: boolean) {
    startTransition(async () => {
      setError(null);
      const r = await checkFitAction(jobId, force);
      if (r.ok) {
        setView(r.view);
        setOpen(true);
      } else setError(r.message);
    });
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        loading={pending && !view}
        aria-expanded={view ? open : undefined}
        aria-controls={view ? `fit-${jobId}` : undefined}
        onClick={() => (view ? setOpen(!open) : run(false))}
      >
        {pending && !view ? (
          "Checking your fit…"
        ) : (
          <>
            <Icon name="sparkles" className="size-3.5" />
            {view ? (open ? "Hide fit check" : `Fit check · ${view.result.fitScore}`) : "Check my fit"}
          </>
        )}
      </Button>
      {error ? (
        <Alert tone="error" className="basis-full">
          {error}
        </Alert>
      ) : null}
      {view && open ? <FitPanel id={`fit-${jobId}`} view={view} pending={pending} onRecheck={() => run(true)} /> : null}
    </>
  );
}

function FitPanel({ id, view, pending, onRecheck }: { id: string; view: FitCheckView; pending: boolean; onRecheck: () => void }) {
  const { result } = view;
  return (
    <section id={id} aria-label="Fit check" className="flex basis-full flex-col gap-4 rounded-control border border-border bg-surface-subtle p-3 sm:p-4">
      <div className="flex items-start gap-3">
        <ScoreBadge score={result.fitScore} title="Fit check score" />
        <div className="min-w-0">
          <Badge tone={matchTone(result.fitScore)} dot>
            {VERDICT_LABELS[result.verdict]}
          </Badge>
          <p className="mt-1.5 text-sm leading-relaxed">{result.summary}</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FitList title="What lines up" icon="check-circle" iconClass="text-success-fg" items={result.strengths} />
        <FitList title="Gaps" icon="alert-triangle" iconClass="text-warning-fg" items={result.gaps} empty="No real gaps found." />
      </div>

      {result.missingKeywords.length ? (
        <div>
          <h4 className="text-sm font-semibold">Keywords from the posting your resume doesn&apos;t use</h4>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {result.missingKeywords.map((k) => (
              <Badge key={k}>{k}</Badge>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted">Applicant tracking systems look for these. Add the ones that are true for you.</p>
        </div>
      ) : null}

      {result.resumeTips.length ? (
        <div>
          <h4 className="text-sm font-semibold">Tailor your resume for this one</h4>
          <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-sm text-muted marker:text-foreground">
            {result.resumeTips.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted">
        <span>
          {view.stale ? "Your resume changed since this check. " : null}
          Checked {formatDateTime(new Date(view.checkedAt))} · {view.model}
        </span>
        <Button variant="ghost" size="sm" loading={pending} onClick={onRecheck}>
          <Icon name="refresh" className="size-3.5" />
          Re-check
        </Button>
      </div>
    </section>
  );
}

function FitList({ title, icon, iconClass, items, empty }: { title: string; icon: IconName; iconClass: string; items: string[]; empty?: string }) {
  return (
    <div>
      <h4 className="text-sm font-semibold">{title}</h4>
      {items.length ? (
        <ul className="mt-1.5 space-y-1.5 text-sm">
          {items.map((item) => (
            <li key={item} className="flex gap-2">
              <Icon name={icon} className={`mt-0.5 size-4 shrink-0 ${iconClass}`} />
              <span className="text-muted">{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-sm text-muted">{empty}</p>
      )}
    </div>
  );
}
