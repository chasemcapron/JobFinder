import type { Metadata } from "next";
import Link from "next/link";
import { Alert, buttonClass, EmptyState, Icon, linkClass, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { activeFilterCount, filterMatches, filtersToSearchParams, locationFacets, paginate, parseFilters } from "@/lib/jobs/filters";
import { lastSearchRun, listMatches } from "@/lib/jobs/results";
import { requireUser } from "@/lib/session";
import { ApplyActions } from "./apply-actions";
import { FilterPanel } from "./filter-panel";
import { FiltersToggle } from "./filters-toggle";
import { JobCard } from "./job-card";
import { RefreshButton } from "./refresh-button";

export const metadata: Metadata = { title: "Jobs · Job Finder" };
// Server Actions on this page (mark applied) may call the Sheets API.
export const maxDuration = 30;

export default async function JobsPage({ searchParams }: PageProps<"/jobs">) {
  const { profile } = await requireUser();
  const filters = parseFilters(await searchParams);
  const [all, lastRun] = await Promise.all([listMatches(profile.userId), lastSearchRun(profile.userId)]);
  const filtered = filterMatches(all, filters);
  const { items, page, pages, total } = paginate(filtered, filters.page);
  const facets = locationFacets(all, filters);
  const activeCount = activeFilterCount(filters);
  const hasProfile = profile.skills.length + profile.titles.length + profile.searchKeywords.length > 0;
  const failedSources = lastRun?.sourceResults.filter((s) => !s.ok) ?? [];
  const pageHref = (p: number) => {
    const qs = filtersToSearchParams({ ...filters, page: p }).toString();
    return qs ? `/jobs?${qs}` : "/jobs";
  };

  return (
    <>
      <PageHeader
        title="Jobs"
        description={
          lastRun?.finishedAt
            ? `Last search ${formatDateTime(lastRun.finishedAt)} · ${all.length.toLocaleString()} matches`
            : lastRun
              ? "A search is running…"
              : "No searches yet."
        }
        action={<RefreshButton />}
      />

      {!hasProfile && all.length > 0 ? (
        <div className="mb-4">
          <Alert tone="warning">
            Jobs aren&apos;t ranked yet. <Link href="/resume" className={linkClass}>Add your resume</Link> so they can be
            scored against your skills.
          </Alert>
        </div>
      ) : null}
      {failedSources.length > 0 && lastRun?.finishedAt ? (
        <div className="mb-4">
          <Alert tone="warning">
            Last search: {failedSources.length} of {lastRun.sourceResults.length} sources failed (
            {failedSources
              .slice(0, 3)
              .map((s) => s.source)
              .join(", ")}
            {failedSources.length > 3 ? ", …" : ""}). Check <Link href="/settings" className={linkClass}>target companies</Link>.
          </Alert>
        </div>
      ) : null}

      {all.length === 0 ? (
        <EmptyState
          icon={<Icon name="briefcase" />}
          title={lastRun ? "No matches yet" : "Run your first search"}
          action={
            hasProfile ? null : (
              <Link href="/resume" className={buttonClass("secondary")}>
                Upload your resume
              </Link>
            )
          }
        >
          {hasProfile
            ? lastRun
              ? "The last search didn't find anything that matched your profile. Try adding target companies or broadening your keywords in Settings."
              : "Click Refresh jobs to search your target companies and job boards."
            : "Add your resume first so jobs can be ranked against your skills, then click Refresh jobs."}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <aside className="lg:sticky lg:top-4 lg:w-64 lg:shrink-0">
            <FiltersToggle activeCount={activeCount}>
              <FilterPanel filters={filters} facets={facets} activeCount={activeCount} />
            </FiltersToggle>
          </aside>

          <section className="min-w-0 flex-1" aria-label="Results">
            <p className="mb-3 text-sm text-muted" aria-live="polite">
              <span className="font-semibold text-foreground">{total.toLocaleString()}</span>
              {total === all.length ? " jobs" : ` of ${all.length.toLocaleString()} jobs match these filters`}
              {pages > 1 ? ` · page ${page} of ${pages}` : ""}
            </p>
            {items.length === 0 ? (
              <EmptyState
                icon={<Icon name="search" />}
                title="No jobs match these filters"
                action={
                  <Link href="/jobs" className={buttonClass("secondary")}>
                    Clear filters
                  </Link>
                }
              >
                Try removing a filter or broadening your search.
              </EmptyState>
            ) : (
              <ul className="flex flex-col gap-3">
                {items.map((m) => (
                  <JobCard key={m.job.id} match={m} actions={<ApplyActions jobId={m.job.id} application={m.application} />} />
                ))}
              </ul>
            )}
            {pages > 1 ? (
              <nav className="mt-6 flex items-center justify-between gap-2" aria-label="Pagination">
                {page > 1 ? (
                  <Link href={pageHref(page - 1)} className={buttonClass("secondary", "sm")} rel="prev">
                    <Icon name="chevron-down" className="size-4 rotate-90" />
                    Previous
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-sm text-muted">
                  Page {page} of {pages}
                </span>
                {page < pages ? (
                  <Link href={pageHref(page + 1)} className={buttonClass("secondary", "sm")} rel="next">
                    Next
                    <Icon name="chevron-right" className="size-4" />
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            ) : null}
          </section>
        </div>
      )}
    </>
  );
}
