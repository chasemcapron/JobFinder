"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, Button, Icon } from "@/components/ui";
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
    <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:max-w-md sm:items-end">
      <Button onClick={refresh} loading={busy}>
        {busy ? (
          "Searching…"
        ) : (
          <>
            <Icon name="refresh" className="size-4" />
            {label}
          </>
        )}
      </Button>
      <div aria-live="polite" className="contents">
        {state.kind === "running" ? (
          <p className="text-xs text-muted sm:text-right">Fetching every source in parallel; this can take up to a minute.</p>
        ) : null}
        {state.kind === "error" ? <Alert tone="error">{state.message}</Alert> : null}
        {state.kind === "done" ? <RunResult summary={state.summary} /> : null}
      </div>
    </div>
  );
}

function RunResult({ summary }: { summary: RunSummary }) {
  const failed = summary.sources.filter((s) => !s.ok);
  if (summary.sources.length === 0) {
    return (
      <Alert tone="warning" title="Nothing to search yet">
        <p>
          Add target companies (their Greenhouse, Lever or Ashby job boards) in Settings, or a free USAJobs key, then
          refresh. Your saved jobs were re-ranked against your current profile.
        </p>
      </Alert>
    );
  }
  return (
    <Alert
      tone={summary.status === "ok" ? "success" : summary.status === "partial" ? "warning" : "error"}
      title={summary.status === "ok" ? "Search complete" : summary.status === "partial" ? "Search finished with problems" : "Search failed"}
    >
      <p>
        {summary.jobsFetched.toLocaleString()} postings fetched, {summary.jobsNew.toLocaleString()} new,{" "}
        {summary.matchesScored.toLocaleString()} matches ranked
        {summary.aiScored ? ` (the top ${summary.aiScored} scored by AI)` : ""}.
      </p>
      {failed.length ? (
        <details className="mt-1">
          <summary className="cursor-pointer">
            {failed.length} source{failed.length === 1 ? "" : "s"} failed
          </summary>
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
