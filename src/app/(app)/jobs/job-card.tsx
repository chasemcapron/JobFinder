import type { CSSProperties, ReactNode } from "react";
import type { MatchVerdict } from "@/db/schema";
import { Badge, buttonClass, Card, cx, Icon, ScoreBadge, scoreTier, SourceBadge } from "@/components/ui";
import { applicationStatusLabel } from "@/lib/applications";
import { formatRelativeDate, formatSalary } from "@/lib/format";
import { EXPERIENCE_LABELS } from "@/lib/jobs/experience";
import { isNewMatch, type RoleMatch } from "@/lib/jobs/filters";
import { formatLocation } from "@/lib/jobs/location";
import type { MatchResult } from "@/lib/jobs/results";
import { adzunaHomepage } from "@/lib/jobs/sources/adzuna";
import { SOURCE_LABELS } from "@/lib/jobs/source-labels";
import { DismissibleJob, DismissMenu } from "./dismiss";

// Sources sometimes send a placeholder instead of a location; showing "N/A" adds nothing.
const PLACEHOLDER_LOCATION = /^(n\/?a|none|tbd|unknown|-+)$/i;

function placeOf(job: MatchResult["job"]): string | null {
  const location = formatLocation(job, job.locationRaw).trim();
  return location && !PLACEHOLDER_LOCATION.test(location) ? location : null;
}

/** "Company · Austin, TX · 3d ago · $97k–$131k", with separators only between parts that exist. */
function MetaLine({ parts }: { parts: ReactNode[] }) {
  const shown = parts.filter(Boolean);
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] leading-5 text-muted">
      {shown.map((part, i) => (
        <span key={i} className="inline-flex items-center gap-2">
          {i > 0 ? <span aria-hidden className="size-1 rounded-full bg-border-strong" /> : null}
          {part}
        </span>
      ))}
    </p>
  );
}

const VERDICTS: Record<MatchVerdict, { label: string; tone: "success" | "warning" | "danger"; title: string }> = {
  apply: { label: "Apply", tone: "success", title: "Worth applying: on target, at your level, most required skills shown" },
  maybe: { label: "Maybe", tone: "warning", title: "Worth a look, with real gaps" },
  skip: { label: "Do not apply", tone: "danger", title: "Off target, too senior, or a hard requirement you don't meet" },
};

/** What the evaluation found: skills the posting asks for that the resume shows, and what's missing. */
function EvaluationLines({ matched, missing }: { matched: string[]; missing: string[] }) {
  if (!matched.length && !missing.length) return null;
  return (
    <dl className="mt-2 grid gap-0.5 text-[13px] leading-5">
      {matched.length ? (
        <div className="flex gap-1.5">
          <dt className="shrink-0 font-medium text-success-fg">Matches:</dt>
          <dd className="min-w-0 text-muted">{matched.join(", ")}</dd>
        </div>
      ) : null}
      {missing.length ? (
        <div className="flex gap-1.5">
          <dt className="shrink-0 font-medium text-warning-fg">Missing:</dt>
          <dd className="min-w-0 text-muted">{missing.join(", ")}</dd>
        </div>
      ) : null}
    </dl>
  );
}

/** "Also in 4 other places", opening to the list with each posting's own link. */
function OtherPlaces({ others }: { others: MatchResult[] }) {
  return (
    <details className="group/places mt-2 text-[13px]">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 font-medium text-section-fg select-none hover:underline">
        <Icon name="map-pin" className="size-3.5" />
        Also in {others.length} other place{others.length === 1 ? "" : "s"}
        <Icon name="chevron-down" className="size-3.5 transition-transform group-open/places:rotate-180" />
      </summary>
      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {others.map((m) => (
          <li key={m.job.id}>
            <a
              href={m.job.applyUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-subtle px-2 py-0.5 text-foreground hover:border-border-strong"
            >
              {placeOf(m.job) ?? "Location not listed"}
              {m.application ? <Icon name="check" className="size-3 text-success-fg" title="Applied" /> : null}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * One role in the results. `ranked` is false until the user has a resume or keywords (scores are
 * then all 0 and shown neutral). `fit` is the "Check my fit" control. `index` staggers the entrance.
 */
export function JobCard({
  match,
  actions,
  fit,
  ranked = true,
  hasClearance = false,
  index = 0,
}: {
  match: RoleMatch;
  actions?: ReactNode;
  fit?: ReactNode;
  ranked?: boolean;
  hasClearance?: boolean;
  index?: number;
}) {
  const { job, application, others } = match;
  const salary = formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency);
  const posted = formatRelativeDate(job.postedAt ?? job.firstSeenAt);
  const isNew = isNewMatch(match);
  const needsClearance = job.clearance === "active" && !hasClearance;
  const verdict = match.verdict ? VERDICTS[match.verdict] : null;
  const evaluation = match.evaluation;
  // The clearance badge already says so; other hard stops get their own badge.
  const blocker = evaluation?.blockers.find((b) => !(needsClearance && /clearance/i.test(b)));
  const source =
    job.source === "adzuna" ? (
      // Adzuna's terms require each displayed ad to link "Adzuna" back to their site.
      <a href={adzunaHomepage(job.country)} target="_blank" rel="noreferrer" className="font-medium text-accent-text underline">
        Jobs by Adzuna
      </a>
    ) : (
      <SourceBadge source={job.source}>via {SOURCE_LABELS[job.source]}</SourceBadge>
    );

  return (
    <li className="rise-in" style={{ "--i": index } as CSSProperties}>
      <DismissibleJob jobId={job.id} title={job.title} company={job.company} initial={match.hidden ?? null}>
        <Card
          padding="none"
          interactive
          outline={ranked ? scoreTier(match.score) : undefined}
          className={cx("overflow-hidden", application && "opacity-85 transition-opacity focus-within:opacity-100 hover:opacity-100")}
        >
          <div className="flex items-start gap-3.5 p-4">
            <ScoreBadge
              score={match.score}
              unranked={!ranked}
              title={match.aiScored ? "AI match score: the AI read the whole posting" : "Keyword match score: how well this job fits your resume"}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h3 className="min-w-0 text-[15px] leading-snug font-semibold tracking-tight">
                  <a href={job.applyUrl} target="_blank" rel="noreferrer" className="hover:text-section-fg hover:underline">
                    {job.title}
                  </a>
                </h3>
                {isNew && !application ? (
                  <span className="rounded-[4px] bg-blue px-1.5 font-label text-[11px] leading-[18px] font-bold tracking-[0.1em] text-white uppercase">
                    New
                  </span>
                ) : null}
                {application ? (
                  <Badge tone="success" dot>
                    {application.status === "applied" ? "Applied" : `Applied · ${applicationStatusLabel(application.status)}`}
                  </Badge>
                ) : null}
              </div>
              <MetaLine
                parts={[
                  <span key="c" className="font-medium text-foreground">
                    {job.company}
                  </span>,
                  placeOf(job),
                  posted ? `Posted ${posted}` : null,
                  salary ? <span className="text-foreground">{salary}</span> : null,
                ]}
              />
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {verdict ? (
                  <Badge tone={verdict.tone} dot title={evaluation?.source === "rule" ? "Decided by a fixed rule, without AI" : verdict.title}>
                    {verdict.label}
                  </Badge>
                ) : null}
                {blocker ? (
                  <Badge tone="danger" title="A hard requirement this job has that your profile doesn't meet">
                    <Icon name="alert-triangle" className="size-3" />
                    {blocker}
                  </Badge>
                ) : null}
                {needsClearance ? (
                  <Badge tone="danger" title="The posting asks for a security clearance you already hold. Change this in Settings if you have one.">
                    <Icon name="alert-triangle" className="size-3" />
                    Active clearance required
                  </Badge>
                ) : null}
                {job.experienceLevel ? <Badge>{EXPERIENCE_LABELS[job.experienceLevel]}</Badge> : null}
                {job.minYears ? <Badge title="Smallest years of experience the posting asks for">{job.minYears}+ yrs</Badge> : null}
                {source}
              </div>
              {match.reasons ? (
                <p className="mt-2.5 line-clamp-2 text-[13px] leading-5 text-muted">
                  {match.aiScored ? (
                    <Icon name="sparkles" className="mr-1 inline size-3.5 align-[-2px] text-section-fg" title="AI fit" />
                  ) : (
                    <span className="font-medium text-foreground">Why: </span>
                  )}
                  {match.reasons}
                </p>
              ) : null}
              {evaluation?.source === "ai" ? <EvaluationLines matched={evaluation.matchedSkills} missing={evaluation.missingSkills} /> : null}
              {others.length ? <OtherPlaces others={others} /> : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-border bg-surface-subtle/40 px-4 py-2.5">
            <a href={job.applyUrl} target="_blank" rel="noreferrer" className={buttonClass("primary", "sm")}>
              Apply
              <Icon name="external-link" className="size-3.5" />
            </a>
            {actions}
            {fit}
            {/* Applied jobs stay in the list whatever happens, so there is nothing to hide. */}
            {!application || match.hidden ? <DismissMenu jobId={job.id} /> : null}
          </div>
        </Card>
      </DismissibleJob>
    </li>
  );
}
