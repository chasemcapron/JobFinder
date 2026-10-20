"use client";

import { useState, useTransition } from "react";
import { Alert, Badge, Button, Icon } from "@/components/ui";
import type { CompanySuggestion } from "@/lib/ai/suggest-companies";
import { addSuggestedCompanies, suggestCompaniesAction } from "./actions";

/**
 * "Suggest companies": the AI proposes employers for the user's titles, the server checks each
 * job board live, and only boards that exist are listed, with their real US job counts.
 */
export function CompanySuggestions({ aiLabel }: { aiLabel: string }) {
  const [suggestions, setSuggestions] = useState<CompanySuggestion[] | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [searching, startSearch] = useTransition();
  const [adding, startAdd] = useTransition();

  const key = (s: CompanySuggestion) => `${s.ats}:${s.slug}`;

  function suggest() {
    startSearch(async () => {
      setMessage(null);
      const r = await suggestCompaniesAction();
      if (r.ok) setSuggestions(r.suggestions);
      else setMessage({ tone: "error", text: r.message });
    });
  }

  function add(items: CompanySuggestion[]) {
    startAdd(async () => {
      const r = await addSuggestedCompanies(items.map((s) => ({ ats: s.ats, slug: s.slug })));
      setMessage({ tone: r?.ok ? "success" : "error", text: r?.message ?? "" });
      if (r?.ok) setAdded((prev) => new Set([...prev, ...items.map(key)]));
    });
  }

  const withMatches = (suggestions ?? []).filter((s) => s.goodMatches > 0 && !added.has(key(s)));

  return (
    <div className="mb-4 rounded-control border border-dashed border-border-strong p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Not sure which companies to track? {aiLabel} suggests employers for your target titles, and each job board is checked live
          before it&apos;s shown.
        </p>
        <Button variant="secondary" size="sm" loading={searching} onClick={suggest}>
          {searching ? (
            "Finding companies… (up to a minute)"
          ) : (
            <>
              <Icon name="sparkles" className="size-3.5" />
              {suggestions ? "Suggest more" : "Suggest companies"}
            </>
          )}
        </Button>
      </div>

      <div aria-live="polite">
        {message ? (
          <div className="mt-3">
            <Alert tone={message.tone}>{message.text}</Alert>
          </div>
        ) : null}
      </div>

      {suggestions && suggestions.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted">
              {suggestions.length} boards found · sorted by open US roles matching your target titles
            </p>
            {withMatches.length > 1 ? (
              <Button size="sm" loading={adding} onClick={() => add(withMatches)}>
                <Icon name="plus" className="size-3.5" />
                Add all {withMatches.length} with matches
              </Button>
            ) : null}
          </div>
          <ul className="divide-y divide-border rounded-control border border-border">
            {suggestions.map((s) => {
              const isAdded = added.has(key(s));
              return (
                <li key={key(s)} className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{s.name}</span>
                      <Badge>{key(s)}</Badge>
                      <Badge tone={s.goodMatches > 0 ? "success" : "neutral"} dot>
                        {s.goodMatches} match{s.goodMatches === 1 ? "" : "es"} · {s.usJobs} US job{s.usJobs === 1 ? "" : "s"}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">{s.why}</p>
                    {s.topTitles.length ? <p className="mt-0.5 text-xs text-muted">e.g. {s.topTitles.join(" · ")}</p> : null}
                  </div>
                  <Button variant={isAdded ? "ghost" : "secondary"} size="sm" disabled={isAdded || adding} onClick={() => add([s])}>
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
        </div>
      ) : null}
    </div>
  );
}
