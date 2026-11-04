"use client";

import { useState, useTransition } from "react";
import { unhideCompanyAction } from "@/app/(app)/jobs/dismiss-actions";
import { Alert, Button } from "@/components/ui";

/** Settings → Target companies: companies marked "Not interested", each with "Show again". */
export function HiddenCompanies({ companies }: { companies: string[] }) {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (companies.length === 0) return null;
  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold">Hidden companies</h3>
      <p className="mt-0.5 text-[13px] text-muted">Their jobs are left out of your list and the morning email.</p>
      <ul className="mt-2 divide-y divide-border rounded-control border border-border">
        {companies.map((c) => (
          <li key={c} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span className="min-w-0 truncate">{c}</span>
            <Button
              variant="ghost"
              size="sm"
              loading={pending && busy === c}
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setBusy(c);
                  setError(null);
                  const r = await unhideCompanyAction(c);
                  if (!r.ok) setError(r.message);
                  setBusy(null);
                })
              }
            >
              Show again
            </Button>
          </li>
        ))}
      </ul>
      {error ? (
        <Alert tone="error" className="mt-2">
          {error}
        </Alert>
      ) : null}
    </div>
  );
}
