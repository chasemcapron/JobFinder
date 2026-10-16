"use client";

import { useTransition } from "react";
import { Badge, Button } from "@/components/ui";
import { removeTargetCompany, setTargetCompanyEnabled } from "./actions";

const BOARD_URLS: Record<string, (slug: string) => string> = {
  greenhouse: (s) => `https://job-boards.greenhouse.io/${s}`,
  lever: (s) => `https://jobs.lever.co/${s}`,
  ashby: (s) => `https://jobs.ashbyhq.com/${s}`,
};

export function TargetCompanyRow({
  id,
  ats,
  slug,
  enabled,
  lastResult,
}: {
  id: string;
  ats: string;
  slug: string;
  enabled: boolean;
  /** From the most recent search run, if this company was in it. */
  lastResult?: { ok: boolean; count: number; error?: string };
}) {
  const [pending, startTransition] = useTransition();
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2" aria-busy={pending}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone="blue">{ats}</Badge>
        <a href={BOARD_URLS[ats]?.(slug)} target="_blank" rel="noreferrer" className={enabled ? "hover:underline" : "text-muted line-through"}>
          {slug}
        </a>
        {enabled && lastResult ? (
          lastResult.ok ? (
            <span className="text-xs text-muted">{lastResult.count.toLocaleString()} postings last search</span>
          ) : (
            <Badge tone="red">{lastResult.error ?? "Failed"}</Badge>
          )
        ) : null}
      </div>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => startTransition(() => setTargetCompanyEnabled(id, !enabled))}
        >
          {enabled ? "Disable" : "Enable"}
        </Button>
        <Button variant="danger" size="sm" disabled={pending} onClick={() => startTransition(() => removeTargetCompany(id))}>
          Remove
        </Button>
      </div>
    </li>
  );
}
