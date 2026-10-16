import { Badge, buttonClass, cx } from "@/components/ui";
import { applicationStatusLabel } from "@/lib/applications";
import { formatRelativeDate, formatSalary } from "@/lib/format";
import { EXPERIENCE_LABELS } from "@/lib/jobs/experience";
import { formatLocation } from "@/lib/jobs/location";
import type { MatchResult } from "@/lib/jobs/results";
import { adzunaHomepage } from "@/lib/jobs/sources/adzuna";
import type { ReactNode } from "react";

const SOURCE_LABELS: Record<string, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  adzuna: "Adzuna",
  usajobs: "USAJobs",
  mock: "Sample",
};

export function scoreTone(score: number): "green" | "blue" | "amber" | "neutral" {
  return score >= 75 ? "green" : score >= 55 ? "blue" : score >= 35 ? "amber" : "neutral";
}

export function JobCard({ match, actions }: { match: MatchResult; actions?: ReactNode }) {
  const { job, application } = match;
  const salary = formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency);
  const posted = formatRelativeDate(job.postedAt ?? job.firstSeenAt);
  return (
    <li
      className={cx(
        "rounded-lg border border-border bg-surface p-4 transition",
        application && "opacity-60 hover:opacity-100",
      )}
    >
      <div className="flex gap-4">
        <div
          className={cx(
            "flex size-12 shrink-0 flex-col items-center justify-center rounded-md text-lg font-semibold tabular-nums",
            {
              green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
              blue: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
              amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
              neutral: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
            }[scoreTone(match.score)],
          )}
          title={match.aiScored ? "Match score from Claude" : "Keyword match score"}
          aria-label={`Match score ${match.score}`}
        >
          {match.score}
          <span className="text-[9px] font-medium tracking-wide uppercase opacity-70">{match.aiScored ? "AI" : "KW"}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <div className="min-w-0">
              <h3 className="font-semibold leading-snug">
                <a href={job.applyUrl} target="_blank" rel="noreferrer" className="hover:underline">
                  {job.title}
                </a>
              </h3>
              <p className="text-sm text-muted">
                {job.company} · {formatLocation(job, job.locationRaw)}
              </p>
            </div>
            {application ? (
              <Badge tone="green">
                {application.status === "applied" ? "Applied" : `Applied · ${applicationStatusLabel(application.status)}`}
              </Badge>
            ) : null}
          </div>
          <p className="mt-2 text-sm">{match.reasons}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
            {job.experienceLevel ? <Badge>{EXPERIENCE_LABELS[job.experienceLevel]}</Badge> : null}
            {salary ? <Badge>{salary}</Badge> : null}
            {posted ? <span>Posted {posted}</span> : null}
            <span aria-hidden>·</span>
            {job.source === "adzuna" ? (
              // Adzuna's terms require each displayed ad to link "Adzuna" back to their site.
              <a href={adzunaHomepage(job.country)} target="_blank" rel="noreferrer" className="font-medium underline">
                Jobs by Adzuna
              </a>
            ) : (
              <span>via {SOURCE_LABELS[job.source] ?? job.source}</span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={job.applyUrl} target="_blank" rel="noreferrer" className={buttonClass("secondary", "sm")}>
              Apply ↗
            </a>
            {actions}
          </div>
        </div>
      </div>
    </li>
  );
}
