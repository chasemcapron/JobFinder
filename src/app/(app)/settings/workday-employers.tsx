"use client";

import { useState, useTransition } from "react";
import { Alert, Button, Icon } from "@/components/ui";
import { WORKDAY_EMPLOYERS, WORKDAY_SECTORS } from "@/lib/jobs/sources/workday-employers";
import { addWorkdayEmployers } from "./actions";

/**
 * One-click adding from the checked Workday employers, grouped by sector. Workday career URLs can't
 * be guessed the way Greenhouse slugs can, so these were found and checked ahead of time.
 */
export function WorkdayEmployers({ addedSlugs, perSearch }: { addedSlugs: string[]; perSearch: number }) {
  const added = new Set(addedSlugs.map((s) => s.toLowerCase()));
  const isAdded = (slug: string) => added.has(slug.toLowerCase());
  const [pending, setPending] = useState<string[]>([]);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [, startTransition] = useTransition();
  const addedCount = WORKDAY_EMPLOYERS.filter((e) => isAdded(e.slug)).length;

  function add(slugs: string[]) {
    setPending(slugs);
    startTransition(async () => {
      const r = await addWorkdayEmployers(slugs);
      setMessage({ tone: r?.ok ? "success" : "error", text: r?.message ?? "" });
      setPending([]);
    });
  }

  return (
    <details className="mb-4 rounded-control border border-dashed border-border-strong p-3 sm:p-4">
      <summary className="cursor-pointer text-sm">
        <span className="font-medium">Workday employers</span>
        <span className="text-muted">
          {" "}
          · {WORKDAY_EMPLOYERS.length} checked US career sites in security, defense, tech, finance, health and education
          {addedCount ? ` · ${addedCount} added` : ""}
        </span>
      </summary>
      <p className="mt-2 text-xs text-muted">
        Each one is searched for your top target titles. Up to {perSearch} Workday employers are searched per run; with more,
        they take turns day by day.
      </p>
      <div aria-live="polite">
        {message ? (
          <div className="mt-3">
            <Alert tone={message.tone}>{message.text}</Alert>
          </div>
        ) : null}
      </div>
      <div className="mt-3 flex flex-col gap-4">
        {WORKDAY_SECTORS.map((sector) => {
          const rows = WORKDAY_EMPLOYERS.filter((e) => e.sector === sector);
          const notAdded = rows.filter((e) => !isAdded(e.slug));
          return (
            <section key={sector} aria-label={sector}>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[13px] font-medium">{sector}</h3>
                {notAdded.length > 1 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending.length > 0}
                    loading={pending.length > 1 && pending[0] === notAdded[0].slug}
                    onClick={() => add(notAdded.map((e) => e.slug))}
                  >
                    <Icon name="plus" className="size-3.5" />
                    Add all {notAdded.length}
                  </Button>
                ) : null}
              </div>
              <ul className="divide-y divide-border rounded-control border border-border">
                {rows.map((e) => {
                  const done = isAdded(e.slug);
                  return (
                    <li key={e.slug} className="flex items-center justify-between gap-3 px-3 py-2">
                      <p className="min-w-0 text-sm">
                        <span className="font-medium">{e.name}</span>
                        {e.note ? <span className="text-xs text-muted"> · {e.note}</span> : null}
                      </p>
                      <Button
                        variant={done ? "ghost" : "secondary"}
                        size="sm"
                        disabled={done || pending.length > 0}
                        loading={pending.length === 1 && pending[0] === e.slug}
                        onClick={() => add([e.slug])}
                      >
                        {done ? (
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
            </section>
          );
        })}
      </div>
    </details>
  );
}
