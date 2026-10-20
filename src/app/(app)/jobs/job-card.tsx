import type { ReactNode } from "react";
import { Badge, buttonClass, Card, cx, Icon, ScoreBadge, scoreTier, SourceBadge } from "@/components/ui";
import { applicationStatusLabel } from "@/lib/applications";
import { formatRelativeDate, formatSalary } from "@/lib/format";
import { EXPERIENCE_LABELS } from "@/lib/jobs/experience";
import { formatLocation } from "@/lib/jobs/location";
import type { MatchResult } from "@/lib/jobs/results";
import { adzunaHomepage } from "@/lib/jobs/sources/adzuna";

const SOURCE_LABELS: Record<string, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  workday: "Workday",
  adzuna: "Adzuna",
  usajobs: "USAJobs",
  mock: "Sample",
};

function Meta({ icon, children }: { icon: "building" | "map-pin" | "calendar"; children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Icon name={icon} className="size-3.5 shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </span>
  );
}

// Sources sometimes send a placeholder instead of a location; showing "N/A" adds nothing.
const PLACEHOLDER_LOCATION = /^(n\/?a|none|tbd|unknown|-+)$/i;

/**
 * `ranked` is false until the user has a resume or keywords; scores are then all 0 and shown neutral.
 * `fit` is the "Check my fit" control, shown after the other actions.
 */
export function JobCard({
  match,
  actions,
  fit,
  ranked = true,
}: {
  match: MatchResult;
  actions?: ReactNode;
  fit?: ReactNode;
  ranked?: boolean;
}) {
  const { job, application } = match;
  const salary = formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency);
  const posted = formatRelativeDate(job.postedAt ?? job.firstSeenAt);
  const location = formatLocation(job, job.locationRaw).trim();
  return (
    <li>
      <Card
        padding="sm"
        interactive
        outline={ranked ? scoreTier(match.score) : undefined}
        className={cx("flex flex-col gap-3", application && "opacity-65 transition-opacity focus-within:opacity-100 hover:opacity-100")}
      >
        <div className="flex items-start gap-3">
          <ScoreBadge
            score={match.score}
            unranked={!ranked}
            title={match.aiScored ? "AI match score: the AI read the whole posting" : "Keyword match score: how well this job fits your resume"}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
              <h3 className="min-w-0 text-base leading-snug font-semibold tracking-tight">
                <a href={job.applyUrl} target="_blank" rel="noreferrer" className="hover:text-accent-text hover:underline">
                  {job.title}
                </a>
              </h3>
              {application ? (
                <Badge tone="success" dot>
                  {application.status === "applied" ? "Applied" : `Applied · ${applicationStatusLabel(application.status)}`}
                </Badge>
              ) : null}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
              <Meta icon="building">
                <span className="font-medium text-foreground">{job.company}</span>
              </Meta>
              {location && !PLACEHOLDER_LOCATION.test(location) ? <Meta icon="map-pin">{location}</Meta> : null}
              {posted ? <Meta icon="calendar">Posted {posted}</Meta> : null}
            </div>
          </div>
        </div>

        {match.reasons ? (
          <p className="rounded-control bg-surface-subtle px-3 py-2 text-sm text-muted">
            {match.aiScored ? (
              <>
                <span className="inline-flex items-center gap-1 font-medium text-foreground">
                  <Icon name="sparkles" className="size-3.5 text-section-fg" />
                  AI fit:
                </span>{" "}
              </>
            ) : (
              <span className="font-medium text-foreground">Why it matched: </span>
            )}
            {match.reasons}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          {job.experienceLevel ? <Badge>{EXPERIENCE_LABELS[job.experienceLevel]}</Badge> : null}
          {salary ? <Badge tone="accent">{salary}</Badge> : null}
          {job.source === "adzuna" ? (
            // Adzuna's terms require each displayed ad to link "Adzuna" back to their site.
            <a href={adzunaHomepage(job.country)} target="_blank" rel="noreferrer" className="font-medium text-accent-text underline">
              Jobs by Adzuna
            </a>
          ) : (
            <SourceBadge source={job.source}>via {SOURCE_LABELS[job.source] ?? job.source}</SourceBadge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <a href={job.applyUrl} target="_blank" rel="noreferrer" className={buttonClass("primary", "sm")}>
            Apply
            <Icon name="external-link" className="size-3.5" />
          </a>
          {actions}
          {fit}
        </div>
      </Card>
    </li>
  );
}
