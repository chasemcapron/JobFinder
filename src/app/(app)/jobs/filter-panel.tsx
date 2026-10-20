"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition, type FormEvent } from "react";
import { Button, HIDE_BELOW_SCORE, inputClass, Label, selectClass } from "@/components/ui";
import { EXPERIENCE_LEVELS } from "@/db/schema";
import { EXPERIENCE_LABELS, LEVEL_UNSTATED } from "@/lib/jobs/experience";
import type { FacetOption, JobFilters } from "@/lib/jobs/filters";

const SOURCE_OPTIONS = [
  ["greenhouse", "Greenhouse"],
  ["lever", "Lever"],
  ["ashby", "Ashby"],
  ["workday", "Workday"],
  ["adzuna", "Adzuna"],
  ["usajobs", "USAJobs"],
  ["mock", "Sample data"],
] as const;

const POSTED_OPTIONS = [
  ["any", "Any time"],
  ["1", "Past 24 hours"],
  ["3", "Past 3 days"],
  ["7", "Past week"],
  ["14", "Past 2 weeks"],
  ["30", "Past month"],
] as const;

function toQuery(form: HTMLFormElement): string {
  const params = new URLSearchParams();
  for (const [k, v] of new FormData(form)) {
    const value = String(v).trim();
    // Drop empty values and defaults so URLs stay readable.
    if (!value || (k === "remote" && value === "any") || (k === "posted" && value === "any") || (k === "applied" && value === "dim") || (k === "sort" && value === "score") || (k === "minScore" && value === String(HIDE_BELOW_SCORE))) continue;
    params.append(k, value);
  }
  return params.toString();
}

export function FilterPanel({
  filters,
  facets,
  activeCount,
}: {
  filters: JobFilters;
  facets: { countries: FacetOption[]; states: FacetOption[]; cities: FacetOption[]; sources: FacetOption[] };
  activeCount: number;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Boards with postings, plus any still selected so they can be cleared.
  const sourceOptions = SOURCE_OPTIONS.filter(([v]) => filters.sources.includes(v) || facets.sources.some((s) => s.value === v));

  useEffect(() => () => void (debounce.current && clearTimeout(debounce.current)), []);

  function apply() {
    if (!formRef.current) return;
    const query = toQuery(formRef.current);
    startTransition(() => router.push(query ? `/jobs?${query}` : "/jobs", { scroll: false }));
  }

  function onChange(e: FormEvent<HTMLFormElement>) {
    const target = e.target as HTMLInputElement;
    // A city doesn't make sense once the state changes. (Jobs are US-only, so there's no country.)
    if (target.name === "state" && formRef.current) {
      (formRef.current.elements.namedItem("city") as HTMLSelectElement).value = "";
    }
    if (target.name === "q") {
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(apply, 400);
      return;
    }
    apply();
  }

  return (
    <form
      ref={formRef}
      method="get"
      action="/jobs"
      onChange={onChange}
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
      aria-busy={pending}
      className="flex flex-col gap-4"
    >
      <div>
        <Label htmlFor="q">Search</Label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={filters.q}
          placeholder='e.g. python "data platform"'
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
        <div>
          <Label htmlFor="state">State</Label>
          <select id="state" name="state" defaultValue={filters.state ?? ""} key={`s-${filters.state}`} className={selectClass}>
            <option value="">Any</option>
            {facets.states.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label} ({o.count})
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="city">City</Label>
          <select id="city" name="city" defaultValue={filters.city ?? ""} key={`ci-${filters.state}-${filters.city}`} className={selectClass}>
            <option value="">Any</option>
            {facets.cities.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label} ({o.count})
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="remote">Remote</Label>
          <select id="remote" name="remote" defaultValue={filters.remote} key={`r-${filters.remote}`} className={selectClass}>
            <option value="any">Remote or on-site</option>
            <option value="remote">Remote only</option>
            <option value="onsite">On-site / hybrid</option>
          </select>
        </div>
        <div>
          <Label htmlFor="posted">Date posted</Label>
          <select id="posted" name="posted" defaultValue={filters.posted} key={`p-${filters.posted}`} className={selectClass}>
            {POSTED_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="minScore">Minimum score</Label>
          <select id="minScore" name="minScore" defaultValue={String(filters.minScore)} key={`m-${filters.minScore}`} className={selectClass}>
            {[0, HIDE_BELOW_SCORE, 50, 75, 90].map((n) => (
              <option key={n} value={n}>
                {n === 0
                  ? "Any (include weak)"
                  : n === HIDE_BELOW_SCORE
                    ? `${n}+ (hide weak)`
                    : n === 50
                      ? "50+ (medium)"
                      : n === 75
                        ? "75+ (strong)"
                        : `${n}+`}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset key={`l-${filters.levels.join()}`}>
        <legend className="mb-1.5 text-sm font-medium">Experience level</legend>
        <div className="grid grid-cols-2 gap-1 lg:grid-cols-1">
          {EXPERIENCE_LEVELS.map((l) => (
            <label key={l} className="flex min-h-7 cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" name="level" value={l} defaultChecked={filters.levels.includes(l)} className="size-4 accent-accent" />
              {EXPERIENCE_LABELS[l]}
            </label>
          ))}
          <label className="flex min-h-7 cursor-pointer items-center gap-2 text-sm text-muted">
            <input type="checkbox" name="level" value={LEVEL_UNSTATED} defaultChecked={filters.levels.includes(LEVEL_UNSTATED)} className="size-4 accent-accent" />
            Not stated
          </label>
        </div>
      </fieldset>

      {sourceOptions.length > 1 ? (
        <fieldset key={`src-${filters.sources.join()}`}>
          <legend className="mb-1.5 text-sm font-medium">Source</legend>
          <div className="grid grid-cols-2 gap-1 lg:grid-cols-1">
            {sourceOptions.map(([v, l]) => (
              <label key={v} className="flex min-h-7 cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" name="source" value={v} defaultChecked={filters.sources.includes(v)} className="size-4 accent-accent" />
                {l}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
        <div>
          <Label htmlFor="applied">Applied jobs</Label>
          <select id="applied" name="applied" defaultValue={filters.applied} key={`a-${filters.applied}`} className={selectClass}>
            <option value="dim">Show dimmed</option>
            <option value="hide">Hide</option>
            <option value="only">Only applied</option>
          </select>
        </div>
        <div>
          <Label htmlFor="sort">Sort by</Label>
          <select id="sort" name="sort" defaultValue={filters.sort} key={`so-${filters.sort}`} className={selectClass}>
            <option value="score">Best match</option>
            <option value="date">Newest</option>
          </select>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Without JS the form submits as a normal GET. */}
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          {pending ? "Filtering…" : "Apply"}
        </Button>
        {activeCount > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              // The search box is uncontrolled (so typing never loses focus); clear it by hand.
              const box = formRef.current?.elements.namedItem("q") as HTMLInputElement | null;
              if (box) box.value = "";
              startTransition(() => router.push("/jobs", { scroll: false }));
            }}
          >
            Clear all ({activeCount})
          </Button>
        ) : null}
      </div>
    </form>
  );
}
