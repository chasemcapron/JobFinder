import { z } from "zod";
import type { ExperienceLevel } from "@/db/schema";
import { env } from "@/lib/env";
import { htmlToText } from "@/lib/text";
import { annualize } from "../salary";
import { finalizeJob, parseDate } from "../normalize";
import type { NormalizedJob, SearchQuery } from "../types";
import { fetchJson, parseItems } from "./http";

/**
 * GET https://data.usajobs.gov/api/Search?Keyword&LocationName&ResultsPerPage&DatePosted&RemoteIndicator&HiringPath
 * Headers: Host: data.usajobs.gov, User-Agent: <registered email>, Authorization-Key: <key>
 * Verified live 2026-10-20:
 * { SearchResult: { SearchResultCount, SearchResultCountAll, SearchResultItems: [{ MatchedObjectId, MatchedObjectDescriptor: {
 *   PositionID, PositionTitle, PositionURI, ApplyURI[], PositionLocationDisplay,
 *   PositionLocation[{ LocationName, CountryCode: "United States" (a country name, not a code), CityName }],
 *   OrganizationName, DepartmentName, JobGrade[{ Code: "GS" | "GG" | "NH" | "ES" | … }], QualificationSummary,
 *   PositionRemuneration[{ MinimumRange, MaximumRange, RateIntervalCode }] (amounts are strings), PublicationStartDate,
 *   UserArea: { Details: { JobSummary, MajorDuties, LowGrade, HighGrade, HiringPath[], RemoteIndicator, … } } } }] } }
 * Remote postings are listed at "Anywhere in the U.S. (remote job), United States" with RemoteIndicator true.
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
        .object({ JobSummary: z.string().nullish(), MajorDuties: textish, LowGrade: numberish, RemoteIndicator: z.boolean().nullish() })
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

/** Pay plans on the GS grade scale: GG is the intelligence agencies' copy of it, GL law enforcement, GM legacy managers. */
const GS_SCALE_PLANS = new Set(["GS", "GG", "GL", "GM"]);
/** DoD acquisition demo (NH) broadband levels, as the lowest GS grade each one spans. */
const NH_LEVEL_TO_GS: Record<number, number> = { 1: 1, 2: 5, 3: 12, 4: 14 };
const EXECUTIVE_PLANS = new Set(["ES", "SES", "SL", "ST"]);

/** Level from the pay plan and the posting's lowest grade; null for plans with their own scales (FP, NF, AD, …). */
export function levelFromPayPlan(plan: string | null | undefined, lowGrade: number | string | null | undefined): ExperienceLevel | null {
  if (!plan) return null;
  if (EXECUTIVE_PLANS.has(plan)) return "executive";
  const grade = Number(lowGrade);
  if (GS_SCALE_PLANS.has(plan)) return levelFromGsGrade(grade);
  if (plan === "NH") return levelFromGsGrade(NH_LEVEL_TO_GS[grade] ?? null);
  return null;
}

const RATE_INTERVALS: Record<string, string> = { PA: "year", PH: "hour", PM: "month", PW: "week", PD: "day", BW: "biweekly" };
const US = "United States";
const NATIONWIDE_REMOTE = /anywhere in the u\.?s\.?|\(remote job\)/i;
/** Who may apply: everyone, students and recent graduates. The other paths are for current federal employees, veterans, spouses, etc. */
const OPEN_HIRING_PATHS = "public;student;graduates";

/**
 * Null for postings with no US location (embassies, overseas bases). Multi-location postings list the
 * searched city first (`near`, e.g. "Chicago, IL"), since the job's city comes from the first place.
 */
export function normalizeUsajobsItem(item: z.infer<typeof Item>, near?: string | null): NormalizedJob | null {
  const d = item.MatchedObjectDescriptor;
  const details = d.UserArea?.Details;
  const places = (d.PositionLocation ?? []).filter((l) => l.LocationName);
  const usPlaces = places.filter((l) => (l.CountryCode ?? US) === US);
  if (places.length > 0 && usPlaces.length === 0) return null;
  const display = d.PositionLocationDisplay ?? "";
  const nationwide = usPlaces.some((l) => NATIONWIDE_REMOTE.test(l.LocationName ?? "")) || NATIONWIDE_REMOTE.test(display);
  const named = usPlaces.map((l) => l.LocationName as string).filter((name) => !NATIONWIDE_REMOTE.test(name));
  const city = near?.split(",")[0].trim().toLowerCase();
  if (city) named.sort((a, b) => Number(b.toLowerCase().startsWith(`${city},`)) - Number(a.toLowerCase().startsWith(`${city},`)));
  const duties = Array.isArray(details?.MajorDuties) ? details.MajorDuties.join("\n") : (details?.MajorDuties ?? "");
  const pay = d.PositionRemuneration?.[0];
  const interval = RATE_INTERVALS[pay?.RateIntervalCode ?? ""] ?? pay?.RateIntervalCode;
  const level = (d.JobGrade ?? []).map((g) => levelFromPayPlan(g.Code, details?.LowGrade)).find(Boolean);
  return finalizeJob({
    source: "usajobs",
    externalId: d.PositionID || item.MatchedObjectId,
    title: d.PositionTitle,
    company: d.OrganizationName || d.DepartmentName || "U.S. Federal Government",
    locationRaw: named.slice(0, 5).join(" • ") || (nationwide ? null : display || null),
    countryHint: "US",
    remote: details?.RemoteIndicator === true || nationwide || undefined,
    experienceLevel: level ?? undefined,
    // Federal agencies sponsor the clearance after the offer, so it never rules an applicant out.
    clearance: null,
    // "One year of specialized experience at the GS-14 level" is the standard federal wording; the
    // grade carries the level, and reading it as "1 year" would make senior roles look entry-level.
    minYears: null,
    description: htmlToText([details?.JobSummary, duties, d.QualificationSummary].filter(Boolean).join("\n\n")),
    // The API writes the default port into links (https://www.usajobs.gov:443/job/…).
    applyUrl: d.PositionURI.replace(/^(https:\/\/[^/]+):443\//, "$1/"),
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
  const params = new URLSearchParams({ Keyword: query.what, ResultsPerPage: "100", DatePosted: "30", HiringPath: OPEN_HIRING_PATHS });
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
  return parseItems(data.SearchResult.SearchResultItems ?? [], Item)
    .map((item) => normalizeUsajobsItem(item, query.where))
    .filter((job): job is NormalizedJob => job !== null);
}
