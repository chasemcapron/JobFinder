import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader, buttonClass } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { lastSearchRun, listMatches } from "@/lib/jobs/results";
import { requireUser } from "@/lib/session";
import { JobCard } from "./job-card";
import { RefreshButton } from "./refresh-button";

export const metadata: Metadata = { title: "Jobs · Job Finder" };

export default async function JobsPage() {
  const { profile } = await requireUser();
  const [matches, lastRun] = await Promise.all([listMatches(profile.userId), lastSearchRun(profile.userId)]);
  const hasProfile = profile.skills.length + profile.titles.length + profile.searchKeywords.length > 0;

  return (
    <>
      <PageHeader
        title="Jobs"
        description={
          lastRun?.finishedAt
            ? `Last search ${formatDateTime(lastRun.finishedAt)} · ${matches.length.toLocaleString()} matches`
            : "No searches yet."
        }
        action={<RefreshButton />}
      />
      {matches.length === 0 ? (
        <EmptyState
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
            ? "Click Refresh jobs to search your target companies and job boards."
            : "Add your resume first so jobs can be ranked against your skills, then click Refresh jobs."}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {matches.slice(0, 100).map((m) => (
            <JobCard key={m.job.id} match={m} />
          ))}
        </ul>
      )}
    </>
  );
}
