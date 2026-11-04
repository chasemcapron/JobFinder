import { z } from "zod";
import { htmlToText } from "@/lib/text";
import { companyFromSlug, finalizeJob, parseDate } from "../normalize";
import { isExcludedTitle } from "../scoring";
import { SourceError, type NormalizedJob } from "../types";
import { fetchJson, parseItems } from "./http";
import { RATE_LIMIT_PAUSE_MS, rankForDetails, type WorkdaySearch } from "./workday";

/**
 * SmartRecruiters' public Posting API, no key needed. Shapes verified against live responses
 * (ServiceNow, Bosch, Western Digital) on 2026-11-04:
 *
 * GET https://api.smartrecruiters.com/v1/companies/{company}/postings?q=&country=us&limit=100&offset=0
 *   { offset, limit, totalFound, content: [{ id, name, company: { identifier, name }, releasedDate,
 *     location: { city, region, country ("us"), remote, hybrid, fullLocation },
 *     experienceLevel: { id }, typeOfEmployment: { id, label } }] }
 * GET https://api.smartrecruiters.com/v1/companies/{company}/postings/{id}
 *   the same fields plus postingUrl, applyUrl, active, and jobAd.sections.{companyDescription,
 *   jobDescription, qualifications, additionalInformation}.text (HTML).
 *
 * Notes: company identifiers are case-insensitive. An unknown company isn't a 404: it answers
 * totalFound 0, the same as a company with nothing open. `q` is a full-text search, so like Workday
 * the listings are ranked by title before details are fetched. An unknown or closed posting id
 * answers 400, so there's no reliable per-posting liveness check; postings close after 21 days
 * unseen like other searched sources.
 */
const API = "https://api.smartrecruiters.com/v1/companies";
/** At most this many title searches per company (the profile's top titles). */
export const SMARTRECRUITERS_MAX_QUERIES = 3;
/** Companies searched per run; with more, they take turns day by day (like Workday sites). */
export const MAX_SMARTRECRUITERS_PER_SEARCH = 6;
const PAGE_SIZE = 100;
const MAX_DETAILS = 25;
const DETAIL_CONCURRENCY = 5;
/** Leaves room inside the 12 s per-source timeout. */
const BUDGET_MS = 9_000;

const Location = z
  .object({
    city: z.string().nullish(),
    region: z.string().nullish(),
    country: z.string().nullish(),
    remote: z.boolean().nullish(),
    hybrid: z.boolean().nullish(),
    fullLocation: z.string().nullish(),
  })
  .nullish();

export const SmartRecruitersListing = z.object({
  id: z.string(),
  name: z.string(),
  company: z.object({ identifier: z.string().nullish(), name: z.string().nullish() }).nullish(),
  location: Location,
  experienceLevel: z.object({ id: z.string().nullish() }).nullish(),
  typeOfEmployment: z.object({ id: z.string().nullish() }).nullish(),
});
const Listing = z.object({ totalFound: z.number().nullish(), content: z.array(z.unknown()).nullish() });

const Section = z.object({ title: z.string().nullish(), text: z.string().nullish() }).nullish();
export const SmartRecruitersPosting = z.object({
  id: z.string(),
  name: z.string(),
  company: z.object({ identifier: z.string().nullish(), name: z.string().nullish() }).nullish(),
  location: Location,
  releasedDate: z.string().nullish(),
  postingUrl: z.string().nullish(),
  applyUrl: z.string().nullish(),
  active: z.boolean().nullish(),
  experienceLevel: z.object({ id: z.string().nullish() }).nullish(),
  typeOfEmployment: z.object({ id: z.string().nullish() }).nullish(),
  jobAd: z
    .object({
      sections: z
        .object({ jobDescription: Section, qualifications: Section, additionalInformation: Section })
        .nullish(),
    })
    .nullish(),
});
type Posting = z.infer<typeof SmartRecruitersPosting>;

/** Searched like a Workday site: the profile's top titles, then the best postings by title. */
export type SmartRecruitersSearch = WorkdaySearch;

/**
 * Internships and part-time postings last, unless the profile is after internships: they can match a
 * title search as well as full-time roles, and would use up the detail budget.
 */
function fullTimeFirst<T extends z.infer<typeof SmartRecruitersListing>>(postings: T[], seniority: string | null): T[] {
  if (seniority === "internship") return postings;
  const later = (p: T) => p.experienceLevel?.id === "internship" || /intern|part_time|temporary/.test(p.typeOfEmployment?.id ?? "");
  return [...postings.filter((p) => !later(p)), ...postings.filter(later)];
}

/** "City, Region, Country" without the street address SmartRecruiters sometimes adds. */
function placeText(loc: Posting["location"]): string | null {
  if (!loc) return null;
  const parts = [loc.city, loc.region].filter((p): p is string => Boolean(p?.trim()));
  if (parts.length) return [...parts, loc.country?.toUpperCase()].filter(Boolean).join(", ");
  return loc.fullLocation?.trim() || null;
}

export function normalizeSmartRecruitersJob(raw: Posting, slug: string): NormalizedJob {
  const sections = raw.jobAd?.sections;
  // The company description is left out, like other sources' "About us" (signals.ts drops it anyway).
  const description = [sections?.jobDescription, sections?.qualifications, sections?.additionalInformation]
    .map((s) => (s?.text ? `${s.title ? `${s.title}\n` : ""}${htmlToText(s.text)}` : ""))
    .filter(Boolean)
    .join("\n\n");
  const level = raw.experienceLevel?.id;
  return finalizeJob({
    source: "smartrecruiters",
    externalId: `${slug.toLowerCase()}:${raw.id}`,
    title: raw.name,
    company: raw.company?.name?.trim() || companyFromSlug(slug),
    locationRaw: placeText(raw.location),
    countryHint: raw.location?.country,
    // Hybrid counts as on-site, as for Ashby and Workday.
    remote: raw.location?.hybrid ? false : (raw.location?.remote ?? undefined),
    // Only SmartRecruiters' clear levels; "associate" and "mid_senior_level" are too broad to trust.
    experienceLevel: level === "internship" ? "internship" : level === "entry_level" ? "entry" : undefined,
    description,
    applyUrl: raw.postingUrl ?? raw.applyUrl ?? `https://jobs.smartrecruiters.com/${encodeURIComponent(raw.company?.identifier ?? slug)}/${raw.id}`,
    postedAt: parseDate(raw.releasedDate),
  });
}

export async function fetchSmartRecruiters(company: string, search: SmartRecruitersSearch, signal: AbortSignal): Promise<NormalizedJob[]> {
  const started = Date.now();
  const inBudget = () => Date.now() - started < BUDGET_MS;
  const stop = AbortSignal.any([signal, AbortSignal.timeout(BUDGET_MS + 2_000)]);
  const base = `${API}/${encodeURIComponent(company)}/postings`;
  const queries = search.queries.length ? search.queries.slice(0, SMARTRECRUITERS_MAX_QUERIES) : [""];

  // Rate limited: one retry after a pause, if the budget still has room for it (as for Workday).
  const getJson: typeof fetchJson = async (url, schema, opts) => {
    try {
      return await fetchJson(url, schema, opts);
    } catch (err) {
      if (!(err instanceof SourceError && err.status === 429) || Date.now() - started > BUDGET_MS - RATE_LIMIT_PAUSE_MS) throw err;
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_PAUSE_MS));
      return fetchJson(url, schema, opts);
    }
  };

  const listPage = async (q: string, country: string | null) => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: "0" });
    if (q) params.set("q", q);
    if (country) params.set("country", country);
    const data = await getJson(`${base}?${params}`, Listing, { signal: stop });
    return { total: data.totalFound ?? 0, postings: parseItems(data.content ?? [], SmartRecruitersListing) };
  };

  // The first search must work; the others are best effort.
  const lists = await Promise.all(
    queries.map((q, i) => (i === 0 ? listPage(q, "us") : listPage(q, "us").catch(() => ({ total: 0, postings: [] })))),
  );
  if (lists.every((l) => l.total === 0)) {
    // Nothing for these titles: say so if the company itself is unknown, since that isn't a 404 here.
    const any = await listPage("", null);
    if (any.total === 0) throw new SourceError(`No open postings for a SmartRecruiters company named "${company}"`, 404);
    return [];
  }

  const seen = new Set<string>();
  const candidates = lists
    .flatMap((l) => l.postings)
    .filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return !isExcludedTitle(p.name, search.profile.excludeKeywords);
    })
    .map((p) => ({ ...p, title: p.name }));
  const picked = fullTimeFirst(rankForDetails(candidates, search.profile), search.profile.seniority).slice(0, MAX_DETAILS);

  const jobs: NormalizedJob[] = [];
  let lastError: unknown = null;
  let next = 0;
  const worker = async () => {
    while (next < picked.length && inBudget() && !stop.aborted) {
      const posting = picked[next++];
      try {
        const data = await getJson(`${base}/${encodeURIComponent(posting.id)}`, SmartRecruitersPosting, { signal: stop });
        if (data.active === false) continue;
        jobs.push(normalizeSmartRecruitersJob(data, company));
      } catch (err) {
        lastError = err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, picked.length) }, worker));
  if (jobs.length === 0 && lastError) throw lastError instanceof Error ? lastError : new SourceError(String(lastError));
  return jobs;
}
