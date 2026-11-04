"use client";

import { createContext, useContext, useRef, useState, useTransition, type ReactNode } from "react";
import { Alert, Button, Card, Icon } from "@/components/ui";
import { DISMISS_REASONS, type DismissReason } from "@/db/schema";
import { DISMISS_LABELS, type HiddenState } from "@/lib/jobs/hidden";
import { dismissJobAction, restoreJobAction, type DismissResult } from "./dismiss-actions";

/** A server error (a dropped connection) shows on the card instead of replacing the page. */
async function attempt(fn: () => Promise<DismissResult>): Promise<DismissResult> {
  try {
    return await fn();
  } catch {
    return { ok: false, message: "Couldn't save that. Try again in a moment." };
  }
}

type Choice = DismissReason | "company";
const CHOICES: Choice[] = [...DISMISS_REASONS, "company"];

type DismissContext = {
  hidden: HiddenState | null;
  pending: boolean;
  dismiss: (reason: Choice) => void;
  restore: () => void;
};
const Ctx = createContext<DismissContext | null>(null);

/**
 * Holds one card's "Not interested" state. Dismissing collapses the card in place to "Hidden ·
 * Undo" (the list isn't reloaded, so the undo stays where the user clicked); the job is gone from
 * the list on the next load.
 */
export function DismissibleJob({
  jobId,
  title,
  company,
  initial,
  children,
}: {
  jobId: string;
  title: string;
  company: string;
  initial: HiddenState | null;
  children: ReactNode;
}) {
  const [hidden, setHidden] = useState(initial);
  // Collapsed only when dismissed here; in the "hidden" view the full card shows with "Show again".
  const [collapsed, setCollapsed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dismiss = (reason: Choice) =>
    startTransition(async () => {
      setError(null);
      const r = await attempt(() => dismissJobAction(jobId, reason));
      if (!r.ok) return setError(r.message);
      setHidden(reason === "company" ? { by: "company" } : { by: "role", reason });
      setCollapsed(true);
    });
  const restore = () =>
    startTransition(async () => {
      if (!hidden) return;
      setError(null);
      const r = await attempt(() => restoreJobAction(jobId));
      if (!r.ok) return setError(r.message);
      setHidden(null);
      setCollapsed(false);
    });

  if (collapsed && hidden) {
    return (
      <Card padding="sm" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted" aria-live="polite">
        <Icon name="eye-off" className="size-4 shrink-0" />
        <span className="min-w-0 flex-1">
          {hidden.by === "company" ? (
            <>
              Hidden every job at <span className="font-medium text-foreground">{company}</span>.
            </>
          ) : (
            <>
              Hidden <span className="font-medium text-foreground">{title}</span> ({DISMISS_LABELS[hidden.reason].toLowerCase()}).
            </>
          )}
        </span>
        <Button variant="ghost" size="sm" loading={pending} onClick={restore}>
          {pending ? "Undoing…" : "Undo"}
        </Button>
        {error ? (
          <Alert tone="error" className="basis-full">
            {error}
          </Alert>
        ) : null}
      </Card>
    );
  }
  return (
    <Ctx.Provider value={{ hidden, pending, dismiss, restore }}>
      {children}
      {error ? (
        <Alert tone="error" className="mt-2">
          {error}
        </Alert>
      ) : null}
    </Ctx.Provider>
  );
}

/** The card's "Not interested" button: opens a row of reasons. In the hidden view, "Show again". */
export function DismissMenu({ jobId }: { jobId: string }) {
  const ctx = useContext(Ctx);
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  if (!ctx) return null;

  if (ctx.hidden) {
    return (
      <Button variant="ghost" size="sm" loading={ctx.pending} onClick={ctx.restore}>
        <Icon name="eye-off" className="size-3.5" />
        {ctx.hidden.by === "company" ? "Show this company again" : "Show again"}
      </Button>
    );
  }
  const close = () => {
    setOpen(false);
    toggle.current?.focus();
  };
  return (
    <>
      <Button
        ref={toggle}
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={`dismiss-${jobId}`}
        onClick={() => setOpen(!open)}
      >
        <Icon name="eye-off" className="size-3.5" />
        Not interested
      </Button>
      {open ? (
        <div
          id={`dismiss-${jobId}`}
          role="group"
          aria-label="Why not?"
          className="flex basis-full flex-wrap items-center gap-1.5"
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
          }}
        >
          <span className="mr-1 text-[13px] text-muted">Why not?</span>
          {CHOICES.map((c) => (
            <Button key={c} variant="secondary" size="sm" disabled={ctx.pending} onClick={() => ctx.dismiss(c)}>
              {DISMISS_LABELS[c]}
            </Button>
          ))}
          <Button variant="ghost" size="icon-sm" onClick={close} aria-label="Cancel">
            <Icon name="x" className="size-3.5" />
          </Button>
        </div>
      ) : null}
    </>
  );
}
