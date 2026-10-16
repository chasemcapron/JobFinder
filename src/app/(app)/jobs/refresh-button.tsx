"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, Button } from "@/components/ui";
import type { RunSummary } from "@/lib/jobs/search";

type State = { kind: "idle" } | { kind: "running" } | { kind: "done"; summary: RunSummary } | { kind: "error"; message: string };

export function RefreshButton({ label = "Refresh jobs" }: { label?: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "idle" });
  const [isRefreshing, startTransition] = useTransition();
  const busy = state.kind === "running" || isRefreshing;

  async function refresh() {
    setState({ kind: "running" });
    try {
      const res = await fetch("/api/jobs/refresh", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({ kind: "error", message: body.error ?? `Search failed (HTTP ${res.status})` });
        return;
      }
      setState({ kind: "done", summary: body as RunSummary });
      startTransition(() => router.refresh());
    } catch {
      setState({ kind: "error", message: "Network error. Check your connection and try again." });
    }
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <Button onClick={refresh} disabled={busy} aria-busy={busy}>
        {busy ? (
          <>
            <Spinner /> Searching…
          </>
        ) : (
          label
        )}
      </Button>
      {state.kind === "running" ? <p className="text-xs text-muted">Fetching every source in parallel; this can take up to a minute.</p> : null}
      {state.kind === "error" ? <Alert tone="error">{state.message}</Alert> : null}
      {state.kind === "done" ? <RunResult summary={state.summary} /> : null}
    </div>
  );
}

function RunResult({ summary }: { summary: RunSummary }) {
  const failed = summary.sources.filter((s) => !s.ok);
  return (
    <Alert tone={summary.status === "ok" ? "success" : summary.status === "partial" ? "warning" : "error"}>
      <p>
        {summary.jobsFetched.toLocaleString()} postings fetched, {summary.jobsNew.toLocaleString()} new,{" "}
        {summary.matchesScored.toLocaleString()} matches ranked
        {summary.aiScored ? ` (${summary.aiScored} scored by Claude)` : ""}.
      </p>
      {failed.length ? (
        <details className="mt-1">
          <summary className="cursor-pointer">{failed.length} source{failed.length === 1 ? "" : "s"} failed</summary>
          <ul className="mt-1 list-disc pl-5">
            {failed.map((s) => (
              <li key={s.source}>
                <span className="font-medium">{s.source}</span>: {s.error}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {summary.errors.length ? <p className="mt-1">{summary.errors[0]}</p> : null}
    </Alert>
  );
}

export function Spinner() {
  return <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}
