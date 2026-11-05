"use client";

import { useState, useTransition } from "react";
import { Alert, Badge, Button, Icon } from "@/components/ui";
import type { CompanyRecommendation } from "@/lib/jobs/recommend-companies";
import { SOURCE_LABELS } from "@/lib/jobs/source-labels";
import { addRecommendedCompanies } from "./actions";

/**
 * "Recommended for you": employers with open US roles matching the user's titles, level and places,
 * from postings the app has already seen (no AI, so it's instant). New accounts get the top ones
 * added automatically; this lists the rest, and is where they come back after a removal.
 */
export function RecommendedCompanies({ items, pickedLabel }: { items: CompanyRecommendation[]; pickedLabel: string | null }) {
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, setPending] = useState<string[]>([]);
  const [, startTransition] = useTransition();
  const key = (r: CompanyRecommendation) => `${r.ats}:${r.slug}`;
  const open = items.filter((r) => !added.has(key(r)));

  function add(list: CompanyRecommendation[]) {
    const keys = list.map(key);
    setPending(keys);
    startTransition(async () => {
      const r = await addRecommendedCompanies(keys);
      setMessage({ tone: r?.ok ? "success" : "error", text: r?.message ?? "" });
      if (r?.ok) setAdded((prev) => new Set([...prev, ...keys]));
      setPending([]);
    });
  }

  return (
    <section aria-labelledby="recommended-heading" className="mb-4 rounded-control border border-border bg-surface-raised p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="recommended-heading" className="text-sm font-medium">
            Recommended for you
          </h3>
          <p className="mt-0.5 text-xs text-muted">
            Employers with open US roles that fit your titles, level and places right now.
            {pickedLabel ? ` The top ones were added for you on ${pickedLabel}; remove any you don't want.` : ""}
          </p>
        </div>
        {open.length > 1 ? (
          <Button size="sm" disabled={pending.length > 0} loading={pending.length > 1} onClick={() => add(open)}>
            <Icon name="plus" className="size-3.5" />
            Add all {open.length}
          </Button>
        ) : null}
      </div>

      <div aria-live="polite">
        {message ? (
          <div className="mt-3">
            <Alert tone={message.tone}>{message.text}</Alert>
          </div>
        ) : null}
      </div>

      {items.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          Nothing new to suggest: either you already track the employers hiring for your titles, or your resume has no target titles yet.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border rounded-control border border-border">
          {items.map((r) => {
            const isAdded = added.has(key(r));
            return (
              <li key={key(r)} className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.name}</span>
                    <Badge>{SOURCE_LABELS[r.ats]}</Badge>
                    <Badge tone="success" dot>
                      {r.matches} open role{r.matches === 1 ? "" : "s"} for you
                    </Badge>
                  </div>
                  {r.sampleTitles.length ? <p className="mt-0.5 text-xs text-muted">e.g. {r.sampleTitles.join(" · ")}</p> : null}
                </div>
                <Button
                  variant={isAdded ? "ghost" : "secondary"}
                  size="sm"
                  disabled={isAdded || pending.length > 0}
                  loading={pending.length === 1 && pending[0] === key(r)}
                  onClick={() => add([r])}
                >
                  {isAdded ? (
                    <>
                      <Icon name="check" className="size-3.5" />
                      Added
                    </>
                  ) : (
                    "Add"
                  )}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
