import type { JobSource } from "@/db/schema";
import { normalizeForKey } from "@/lib/text";
import { inferExperienceLevel } from "./experience";
import { parseLocation } from "./location";
import { parseSalaryFromText } from "./salary";
import type { NormalizedJob } from "./types";

export const MAX_DESCRIPTION_CHARS = 20_000;

type JobInput = Omit<NormalizedJob, "city" | "state" | "country" | "remote" | "experienceLevel" | "salaryMin" | "salaryMax" | "salaryCurrency"> &
  Partial<Pick<NormalizedJob, "city" | "state" | "country" | "remote" | "experienceLevel" | "salaryMin" | "salaryMax" | "salaryCurrency">> & {
    /** Passed to the location parser when the source provides a separate country. */
    countryHint?: string | null;
  };

/**
 * Fills in everything an adapter didn't provide: parsed location, inferred
 * experience level, salary parsed from the description, trimmed text.
 */
export function finalizeJob(input: JobInput): NormalizedJob {
  const { countryHint, ...job } = input;
  const parsed = parseLocation(job.locationRaw, { country: countryHint ?? job.country, remote: job.remote });
  const salaryFromText =
    job.salaryMin == null && job.salaryMax == null ? parseSalaryFromText(job.description) : null;
  const title = job.title.replace(/\s+/g, " ").trim();
  return {
    ...job,
    title,
    company: job.company.replace(/\s+/g, " ").trim(),
    locationRaw: job.locationRaw?.trim() || null,
    city: job.city ?? parsed.city,
    state: job.state ?? parsed.state,
    country: job.country ?? parsed.country,
    remote: job.remote ?? parsed.remote,
    experienceLevel: job.experienceLevel ?? inferExperienceLevel(title),
    description: job.description.trim().slice(0, MAX_DESCRIPTION_CHARS),
    salaryMin: job.salaryMin ?? salaryFromText?.min ?? null,
    salaryMax: job.salaryMax ?? salaryFromText?.max ?? null,
    salaryCurrency: job.salaryCurrency ?? salaryFromText?.currency ?? null,
  };
}

/** Same company + title + location = same job, whichever source it came from. */
export function dedupeKey(job: Pick<NormalizedJob, "company" | "title" | "city" | "state" | "country" | "remote" | "locationRaw">): string {
  const place =
    [job.city, job.state, job.country].filter(Boolean).join(" ") || (job.remote ? "remote" : job.locationRaw ?? "");
  return [normalizeForKey(job.company), normalizeForKey(job.title), normalizeForKey(place)].join("|");
}

/** Direct ATS postings are preferred over aggregator copies: richer descriptions and direct apply links. */
export const SOURCE_PRIORITY: Record<JobSource, number> = {
  greenhouse: 0,
  lever: 0,
  ashby: 0,
  usajobs: 1,
  adzuna: 2,
  mock: 3,
};

/** Removes duplicates, keeping the highest-priority source (then the longest description). */
export function dedupeJobs(jobs: NormalizedJob[]): (NormalizedJob & { dedupeKey: string })[] {
  const byKey = new Map<string, NormalizedJob & { dedupeKey: string }>();
  for (const job of jobs) {
    const key = dedupeKey(job);
    const existing = byKey.get(key);
    if (
      !existing ||
      SOURCE_PRIORITY[job.source] < SOURCE_PRIORITY[existing.source] ||
      (SOURCE_PRIORITY[job.source] === SOURCE_PRIORITY[existing.source] && job.description.length > existing.description.length)
    ) {
      byKey.set(key, { ...job, dedupeKey: key });
    }
  }
  return [...byKey.values()];
}

/** "spotify" -> "Spotify", "my-company" -> "My Company" (Lever doesn't return a company name). */
export function companyFromSlug(slug: string): string {
  return slug
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

export function parseDate(value: string | number | null | undefined): Date | null {
  if (value == null || value === "") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
