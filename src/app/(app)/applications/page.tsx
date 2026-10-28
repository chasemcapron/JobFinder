import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties } from "react";
import { SyncStatus } from "@/components/sync-status";
import { Badge, BarHeading, buttonClass, cx, EmptyState, Icon, PageHeader, StatTile, type Hue } from "@/components/ui";
import type { ApplicationStatus } from "@/db/schema";
import { daysWithoutReply, listApplications, summarizeApplications } from "@/lib/applications";
import { formatRelativeDate } from "@/lib/format";
import { formatLocation } from "@/lib/jobs/location";
import { requireUser } from "@/lib/session";
import { ApplicationRowActions } from "./row-actions";

export const metadata: Metadata = { title: "Applications · Job Finder" };
// Retry sync calls the Sheets API.
export const maxDuration = 30;

/** The pipeline, left to right. Rejected and withdrawn share the last column. */
const COLUMNS: { title: string; hue: Hue; statuses: ApplicationStatus[]; empty: string }[] = [
  { title: "Applied", hue: "orange", statuses: ["applied"], empty: "Mark jobs applied from the Jobs page." },
  { title: "Interviewing", hue: "pink", statuses: ["interviewing"], empty: "Move an application here when you hear back." },
  { title: "Offer", hue: "green", statuses: ["offer"], empty: "Offers land here." },
  { title: "Closed", hue: "blue", statuses: ["rejected", "withdrawn"], empty: "Rejected and withdrawn applications." },
];

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });

type Row = Awaited<ReturnType<typeof listApplications>>[number];

function ApplicationCard({ row: { app, job }, index }: { row: Row; index: number }) {
  const waiting = daysWithoutReply(app);
  const closed = app.status === "rejected" || app.status === "withdrawn";
  return (
    <li className="rise-in" style={{ "--i": index } as CSSProperties}>
      <article
        className={cx(
          "flex flex-col gap-2 rounded-control border border-border bg-surface p-3 shadow-card transition-colors hover:border-border-strong",
          closed && "opacity-75",
        )}
      >
        <div>
          <a
            href={job.applyUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-full items-start gap-1 text-sm leading-snug font-semibold tracking-tight hover:text-section-fg hover:underline"
          >
            <span className="min-w-0">{job.title}</span>
            <Icon name="external-link" className="mt-0.5 size-3 text-muted" />
          </a>
          <p className="mt-0.5 text-[13px] leading-5 text-muted">
            <span className="font-medium text-foreground">{job.company}</span> · {formatLocation(job, job.locationRaw)}
          </p>
          <p className="mt-0.5 text-xs text-muted" title={app.appliedAt.toISOString()}>
            Applied {dateFormat.format(app.appliedAt)} · {formatRelativeDate(app.appliedAt)}
          </p>
        </div>
        {waiting || app.sheetSyncStatus !== "not_configured" ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {waiting ? (
              <Badge tone="warning" title="Still marked Applied a week on: a short follow-up email often gets a reply">
                No reply in {waiting} days
              </Badge>
            ) : null}
            {app.sheetSyncStatus !== "not_configured" ? (
              <SyncStatus applicationId={app.id} status={app.sheetSyncStatus} error={app.sheetSyncError} />
            ) : null}
          </div>
        ) : null}
        <ApplicationRowActions applicationId={app.id} status={app.status} compact />
      </article>
    </li>
  );
}

export default async function ApplicationsPage() {
  const { profile } = await requireUser();
  const rows = await listApplications(profile.userId);
  const failed = rows.filter((r) => r.app.sheetSyncStatus === "failed").length;
  const stats = summarizeApplications(rows.map((r) => r.app));
  const rate = stats.responseRate === null ? "–" : `${Math.round(stats.responseRate * 100)}%`;

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
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile hue="orange" label="Applications" value={stats.total} hint={`${stats.thisWeek} this week`} />
            <StatTile hue="pink" label="Interviewing" value={stats.interviewing} hint={stats.interviewing ? "In conversation now" : "Change a card's status when they reply"} />
            <StatTile hue="green" label="Offers" value={stats.offers} hint={stats.offers ? "Nice work" : "Keep going"} />
            <StatTile hue="blue" label="Response rate" value={rate} hint={`${stats.answered} of ${stats.considered} heard back`} />
          </div>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {COLUMNS.map((col) => {
              const items = rows.filter((r) => col.statuses.includes(r.app.status));
              return (
                <section key={col.title} aria-label={col.title} className="flex min-w-0 flex-col gap-3">
                  <BarHeading hue={col.hue} count={items.length}>
                    {col.title}
                  </BarHeading>
                  {items.length ? (
                    <ul className="flex flex-col gap-2.5">
                      {items.map((row, i) => (
                        <ApplicationCard key={row.app.id} row={row} index={i} />
                      ))}
                    </ul>
                  ) : (
                    <p className="border-b border-border pb-3 text-[13px] text-muted">{col.empty}</p>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
