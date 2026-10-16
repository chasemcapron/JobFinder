import { z } from "zod";
import type { ExperienceLevel } from "@/db/schema";
import { env } from "@/lib/env";
import { htmlToText } from "@/lib/text";
import { annualize } from "../salary";
import { finalizeJob, parseDate } from "../normalize";
import type { NormalizedJob, SearchQuery } from "../types";
import { fetchJson, parseItems } from "./http";

/**
 * GET https://data.usajobs.gov/api/Search?Keyword&LocationName&ResultsPerPage&DatePosted&RemoteIndicator
 * Headers: Host: data.usajobs.gov, User-Agent: <registered email>, Authorization-Key: <key>
 * Shape taken from the USAJobs API reference (developer.usajobs.gov/api-reference/get-api-search),
 * NOT yet verified live — no API key was available while building:
 * { SearchResult: { SearchResultCount, SearchResultItems: [{ MatchedObjectId, MatchedObjectDescriptor: {
 *   PositionID, PositionTitle, PositionURI, ApplyURI[], PositionLocationDisplay,
 *   PositionLocation[{ LocationName, CountryCode, CountrySubDivisionCode, CityName }],
 *   OrganizationName, DepartmentName, JobGrade[{ Code }], QualificationSummary,
 *   PositionRemuneration[{ MinimumRange, MaximumRange, RateIntervalCode }], PublicationStartDate,
 *   UserArea: { Details: { JobSummary, MajorDuties, LowGrade, HighGrade } } } }] } }
 */
const numberish = z.union([z.number(), z.string()]).nullish();
const textish = z.union([z.string(), z.array(z.string())]).nullish();

const Descriptor = z.object({
  PositionID: z.string().nullish(),
  PositionTitle: z.string(),
  PositionURI: z.string(),
  ApplyURI: z.array(z.string()).nullish(),
  PositionLocationDisplay: z.string().nullish(),
  PositionLocation: z
    .array(
      z.object({
        LocationName: z.string().nullish(),
        CountryCode: z.string().nullish(),
      }),
    )
    .nullish(),
  OrganizationName: z.string().nullish(),
  DepartmentName: z.string().nullish(),
  JobGrade: z.array(z.object({ Code: z.string().nullish() })).nullish(),
  QualificationSummary: z.string().nullish(),
  PositionRemuneration: z
    .array(z.object({ MinimumRange: numberish, MaximumRange: numberish, RateIntervalCode: z.string().nullish() }))
    .nullish(),
  PublicationStartDate: z.string().nullish(),
  UserArea: z
    .object({
      Details: z
        .object({ JobSummary: z.string().nullish(), MajorDuties: textish, LowGrade: numberish })
        .nullish(),
    })
    .nullish(),
});

const Item = z.object({ MatchedObjectId: z.union([z.string(), z.number()]).transform(String), MatchedObjectDescriptor: Descriptor });
const Envelope = z.object({ SearchResult: z.object({ SearchResultItems: z.array(z.unknown()).nullish() }) });

/** Rough GS grade -> level mapping (GS-5/7 entry, 9/11 mid, 12/13 senior, 14 lead, 15+ executive). */
export function levelFromGsGrade(grade: number | null): ExperienceLevel | null {
  if (grade == null || !Number.isFinite(grade) || grade <= 0) return null;
  if (grade <= 7) return "entry";
  if (grade <= 11) return "mid";
  if (grade <= 13) return "senior";
  if (grade === 14) return "lead";
  return "executive";
}

const RATE_INTERVALS: Record<string, string> = { PA: "year", PH: "hour", PM: "month", PW: "week", PD: "day", BW: "biweekly" };

export function normalizeUsajobsItem(item: z.infer<typeof Item>): NormalizedJob {
  const d = item.MatchedObjectDescriptor;
  const details = d.UserArea?.Details;
  const duties = Array.isArray(details?.MajorDuties) ? details.MajorDuties.join("\n") : (details?.MajorDuties ?? "");
  const pay = d.PositionRemuneration?.[0];
  const interval = RATE_INTERVALS[pay?.RateIntervalCode ?? ""] ?? pay?.RateIntervalCode;
  const locations = (d.PositionLocation ?? []).map((l) => l.LocationName).filter(Boolean) as string[];
  const display = d.PositionLocationDisplay ?? "";
  const isGs = (d.JobGrade ?? []).some((g) => g.Code === "GS");
  return finalizeJob({
    source: "usajobs",
    externalId: d.PositionID || item.MatchedObjectId,
    title: d.PositionTitle,
    company: d.OrganizationName || d.DepartmentName || "U.S. Federal Government",
    locationRaw: locations.slice(0, 5).join(" • ") || display || null,
    countryHint: d.PositionLocation?.[0]?.CountryCode ?? "US",
    remote: /remote/i.test(`${display} ${locations.join(" ")}`) || undefined,
    experienceLevel: isGs ? (levelFromGsGrade(Number(details?.LowGrade)) ?? undefined) : undefined,
    description: htmlToText([details?.JobSummary, duties, d.QualificationSummary].filter(Boolean).join("\n\n")),
    applyUrl: d.PositionURI,
    postedAt: parseDate(d.PublicationStartDate),
    salaryMin: annualize(pay?.MinimumRange == null ? null : Number(pay.MinimumRange), interval),
    salaryMax: annualize(pay?.MaximumRange == null ? null : Number(pay.MaximumRange), interval),
    salaryCurrency: pay ? "USD" : undefined,
  });
}

export function usajobsConfigured() {
  return Boolean(env.usajobsApiKey && env.usajobsUserAgent);
}

export async function fetchUsajobs(query: SearchQuery, signal: AbortSignal): Promise<NormalizedJob[]> {
  const params = new URLSearchParams({ Keyword: query.what, ResultsPerPage: "100", DatePosted: "30" });
  if (query.where) params.set("LocationName", query.where);
  if (query.remoteOnly) params.set("RemoteIndicator", "True");
  const data = await fetchJson(`https://data.usajobs.gov/api/Search?${params}`, Envelope, {
    signal,
    headers: {
      Host: "data.usajobs.gov",
      "User-Agent": env.usajobsUserAgent ?? "",
      "Authorization-Key": env.usajobsApiKey ?? "",
    },
  });
  return parseItems(data.SearchResult.SearchResultItems ?? [], Item).map(normalizeUsajobsItem);
}
