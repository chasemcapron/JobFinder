import { z } from "zod";
import { annualize } from "../salary";
import { companyFromSlug, finalizeJob, parseDate } from "../normalize";
import type { NormalizedJob } from "../types";
import { fetchJson, parseItems } from "./http";

/**
 * GET https://api.ashbyhq.com/posting-api/job-board/{name}?includeCompensation=true
 * Shape verified against live responses (linear, ramp) on 2026-10-15:
 * { apiVersion, jobs: [{ id, title, department, team, employmentType ("FullTime"|"Intern"|...),
 *   location, secondaryLocations: [{ location, address }], publishedAt, isListed, isRemote,
 *   workplaceType ("Remote"|"Hybrid"|"OnSite"), address: { postalAddress: { addressLocality,
 *   addressRegion, addressCountry } }, jobUrl, applyUrl, descriptionHtml, descriptionPlain,
 *   compensation: { summaryComponents: [{ compensationType, interval, currencyCode, minValue, maxValue }] } }] }
 * Notes: isRemote is true for Hybrid roles too, so workplaceType decides remote. postalAddress
 * contains typos ("San Fransisco"), so the `location` string is parsed first. No company name.
 */
const AshbyJob = z.object({
  id: z.string(),
  title: z.string(),
  employmentType: z.string().nullish(),
  location: z.string().nullish(),
  secondaryLocations: z.array(z.object({ location: z.string().nullish() })).nullish(),
  publishedAt: z.string().nullish(),
  isListed: z.boolean().nullish(),
  isRemote: z.boolean().nullish(),
  workplaceType: z.string().nullish(),
  address: z
    .object({
      postalAddress: z
        .object({
          addressCountry: z.string().nullish(),
        })
        .nullish(),
    })
    .nullish(),
  jobUrl: z.string(),
  descriptionPlain: z.string().nullish(),
  compensation: z
    .object({
      summaryComponents: z
        .array(
          z.object({
            compensationType: z.string().nullish(),
            interval: z.string().nullish(),
            currencyCode: z.string().nullish(),
            minValue: z.number().nullish(),
            maxValue: z.number().nullish(),
          }),
        )
        .nullish(),
    })
    .nullish(),
});

const Envelope = z.object({ jobs: z.array(z.unknown()) });

export function normalizeAshbyJob(raw: z.infer<typeof AshbyJob>, slug: string): NormalizedJob {
  const salary = raw.compensation?.summaryComponents?.find((c) => c.compensationType === "Salary");
  const workplace = raw.workplaceType?.toLowerCase();
  const locations = [raw.location, ...(raw.secondaryLocations ?? []).map((s) => s.location)].filter(Boolean);
  return finalizeJob({
    source: "ashby",
    externalId: `${slug}:${raw.id}`,
    title: raw.title,
    company: companyFromSlug(slug),
    locationRaw: locations.join(" • ") || null,
    countryHint: raw.address?.postalAddress?.addressCountry,
    remote: workplace ? workplace === "remote" : (raw.isRemote ?? undefined),
    experienceLevel: raw.employmentType === "Intern" ? "internship" : undefined,
    description: raw.descriptionPlain ?? "",
    applyUrl: raw.jobUrl,
    postedAt: parseDate(raw.publishedAt),
    salaryMin: annualize(salary?.minValue, salary?.interval),
    salaryMax: annualize(salary?.maxValue, salary?.interval),
    salaryCurrency: salary ? (salary.currencyCode ?? null) : undefined,
  });
}

export async function fetchAshby(slug: string, signal: AbortSignal): Promise<NormalizedJob[]> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`;
  const data = await fetchJson(url, Envelope, { signal, notFoundMessage: `No Ashby job board named "${slug}"` });
  return parseItems(data.jobs, AshbyJob)
    .filter((j) => j.isListed !== false)
    .map((j) => normalizeAshbyJob(j, slug));
}
