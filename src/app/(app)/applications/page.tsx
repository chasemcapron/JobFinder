import type { Metadata } from "next";
import Link from "next/link";
import { SyncStatus } from "@/components/sync-status";
import { buttonClass, Card, EmptyState, Icon, PageHeader } from "@/components/ui";
import { listApplications } from "@/lib/applications";
import { formatRelativeDate } from "@/lib/format";
import { formatLocation } from "@/lib/jobs/location";
import { requireUser } from "@/lib/session";
import { localDate } from "@/lib/time";
import { ApplicationRowActions } from "./row-actions";

export const metadata: Metadata = { title: "Applications · Job Finder" };
// Retry sync calls the Sheets API.
export const maxDuration = 30;

export default async function ApplicationsPage() {
  const { profile } = await requireUser();
  const rows = await listApplications(profile.userId);
  const failed = rows.filter((r) => r.app.sheetSyncStatus === "failed").length;

  return (
    <>
      <PageHeader
        title="Applications"
        description={
          rows.length
            ? `${rows.length} application${rows.length === 1 ? "" : "s"}${failed ? ` · ${failed} not yet in your sheet` : ""}`
            : undefined
        }
        action={
          profile.sheetId ? null : (
            <Link href="/settings#sheet" className={buttonClass("secondary", "sm")}>
              Connect a Google Sheet
            </Link>
          )
        }
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={<Icon name="briefcase" />}
          title="No applications yet"
          action={
            <Link href="/jobs" className={buttonClass("secondary")}>
              Browse jobs
            </Link>
          }
        >
          Click &ldquo;Mark applied&rdquo; on a job to track it here{profile.sheetId ? " and add it to your Google Sheet" : ""}.
        </EmptyState>
      ) : (
        <Card padding="none">
        <ul className="divide-y divide-border">
          {rows.map(({ app, job }) => (
            <li key={app.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
              <div className="min-w-0">
                <a
                  href={job.applyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex max-w-full items-start gap-1.5 font-semibold tracking-tight hover:text-accent-text hover:underline"
                >
                  <span className="min-w-0 text-balance">{job.title}</span>
                  <Icon name="external-link" className="mt-1 size-3.5 text-muted" />
                </a>
                <p className="text-sm text-muted">
                  {job.company} · {formatLocation(job, job.locationRaw)}
                </p>
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted" title={app.appliedAt.toISOString()}>
                  <Icon name="calendar" className="size-3.5" />
                  <span>
                    Applied {localDate(app.appliedAt)} ({formatRelativeDate(app.appliedAt)})
                  </span>
                </p>
                <div className="mt-2">
                  <SyncStatus applicationId={app.id} status={app.sheetSyncStatus} error={app.sheetSyncError} />
                </div>
              </div>
              <ApplicationRowActions applicationId={app.id} status={app.status} />
            </li>
          ))}
        </ul>
        </Card>
      )}
    </>
  );
}
