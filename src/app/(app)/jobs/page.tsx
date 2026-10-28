import type { Metadata } from "next";
import Link from "next/link";
import { Alert, buttonClass, EmptyState, HIDE_BELOW_SCORE, Icon, linkClass, PageHeader, SCORE_THRESHOLDS, StatTile } from "@/components/ui";
import { applicationStats } from "@/lib/applications";
import { aiProvider } from "@/lib/ai/provider";
import { formatDateTime } from "@/lib/format";
import { activeFilterCount, filterMatches, filtersToSearchParams, groupByRole, locationFacets, paginate, parseFilters, sourceFacets, summarizeMatches } from "@/lib/jobs/filters";
import { listFitChecks } from "@/lib/jobs/fit-checks";
import { lastSearchRun, listMatches } from "@/lib/jobs/results";
import { requireUser } from "@/lib/session";
import { ApplyActions } from "./apply-actions";
import { FilterPanel } from "./filter-panel";
import { FiltersToggle } from "./filters-toggle";
import { FitCheck } from "./fit-check";
import { JobCard } from "./job-card";
import { RefreshButton } from "./refresh-button";

export const metadata: Metadata = { title: "Jobs · Job Finder" };
// Server Actions on this page call the Sheets API (mark applied) and the AI (fit checks).
export const maxDuration = 60;

export default async function JobsPage({ searchParams }: PageProps<"/jobs">) {
  const { profile } = await requireUser();
  const filters = parseFilters(await searchParams);
  const [all, lastRun, stats] = await Promise.all([listMatches(profile.userId), lastSearchRun(profile.userId), applicationStats(profile.userId)]);
  const hasProfile = profile.skills.length + profile.titles.length + profile.searchKeywords.length > 0;
  // Before a resume exists every score is 0, so the "hide weak matches" default would hide everything.
  const filtered = groupByRole(filterMatches(all, hasProfile ? filters : { ...filters, minScore: 0 }));
  const { items, page, pages, total } = paginate(filtered, filters.page);
  const facets = { ...locationFacets(all, filters), sources: sourceFacets(all) };
  const activeCount = activeFilterCount(filters);
  const weakHidden =
    hasProfile && filters.minScore === HIDE_BELOW_SCORE ? groupByRole(filterMatches(all, { ...filters, minScore: 0 })).length - filtered.length : 0;
  const { newToday, strong } = summarizeMatches(all, { ranked: hasProfile, strongAt: SCORE_THRESHOLDS.high });
  const showWeakHref = `/jobs?${filtersToSearchParams({ ...filters, minScore: 0, page: 1 }).toString()}`;
  // "Check my fit" needs the AI and a saved resume; earlier checks for this page's jobs load with it.
  const canCheckFit = Boolean(aiProvider() && profile.resumeText?.trim());
  const fitChecks = canCheckFit
    ? await listFitChecks(profile.userId, items.map((m) => m.job.id), profile.matchingUpdatedAt)
    : new Map();
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

      {all.length > 0 ? (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile hue="blue" label="New today" value={newToday} hint="First seen in the last 24 hours" href="/jobs?sort=date" />
          <StatTile hue="green" label="Strong matches" value={strong} hint={`Scoring ${SCORE_THRESHOLDS.high}+, not applied yet`} href={`/jobs?minScore=${SCORE_THRESHOLDS.high}`} />
          <StatTile hue="orange" label="Applied this week" value={stats.thisWeek} hint={`${stats.total} application${stats.total === 1 ? "" : "s"} in all`} href="/applications" />
          <StatTile
            hue="pink"
            label="Interviewing"
            value={stats.interviewing}
            hint={stats.offers ? `Plus ${stats.offers} offer${stats.offers === 1 ? "" : "s"}` : "Update statuses as you hear back"}
            href="/applications"
          />
        </div>
      ) : null}

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
          {/* Taller than most screens, so it scrolls on its own while it sticks below the header. */}
          <aside className="lg:sticky lg:top-[calc(var(--header-h)+1rem)] lg:max-h-[calc(100dvh-var(--header-h)-2rem)] lg:w-64 lg:shrink-0 lg:overflow-y-auto lg:overscroll-contain lg:rounded-card lg:[scrollbar-width:thin]">
            <FiltersToggle activeCount={activeCount}>
              <FilterPanel filters={filters} facets={facets} activeCount={activeCount} />
            </FiltersToggle>
          </aside>

          <section className="min-w-0 flex-1" aria-label="Results">
            <p className="mb-3 text-sm text-muted" aria-live="polite">
              <span className="font-semibold text-foreground">{total.toLocaleString()}</span>
              {activeCount === 0 ? ` role${total === 1 ? "" : "s"} worth a look` : ` role${total === 1 ? "" : "s"} match these filters`}
              {pages > 1 ? ` · page ${page} of ${pages}` : ""}
              {weakHidden > 0 ? (
                <>
                  {" · "}
                  {weakHidden.toLocaleString()} weak match{weakHidden === 1 ? "" : "es"} (under {HIDE_BELOW_SCORE}) hidden.{" "}
                  <Link href={showWeakHref} className={linkClass}>
                    Show
                  </Link>
                </>
              ) : null}
            </p>
            {items.length === 0 ? (
              <EmptyState
                icon={<Icon name="search" />}
                title={weakHidden > 0 && activeCount === 0 ? "No good matches yet" : "No jobs match these filters"}
                action={
                  weakHidden > 0 && activeCount === 0 ? (
                    <Link href={showWeakHref} className={buttonClass("secondary")}>
                      Show {weakHidden.toLocaleString()} weak match{weakHidden === 1 ? "" : "es"}
                    </Link>
                  ) : (
                    <Link href="/jobs" className={buttonClass("secondary")}>
                      Clear filters
                    </Link>
                  )
                }
              >
                {weakHidden > 0 && activeCount === 0
                  ? "Everything found so far scores under " +
                    HIDE_BELOW_SCORE +
                    ". Add target companies that hire for your role in Settings, then refresh."
                  : "Try removing a filter or broadening your search."}
              </EmptyState>
            ) : (
              <ul className="flex flex-col gap-3">
                {items.map((m, i) => (
                  <JobCard
                    key={m.job.id}
                    match={m}
                    index={i}
                    ranked={hasProfile}
                    hasClearance={profile.hasClearance}
                    actions={<ApplyActions jobId={m.job.id} application={m.application} />}
                    fit={canCheckFit ? <FitCheck jobId={m.job.id} initial={fitChecks.get(m.job.id) ?? null} /> : null}
                  />
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
