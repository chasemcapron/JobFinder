import { z } from "zod";
import type { Profile } from "@/db/schema";
import { htmlToText } from "@/lib/text";
import { inferExperienceLevel, isTooSenior } from "../experience";
import { normalizeCountry, parseLocation, TARGET_COUNTRY } from "../location";
import { companyFromSlug, finalizeJob, parseDate } from "../normalize";
import { isExcludedTitle, titleSimilarity } from "../scoring";
import { SourceError, type NormalizedJob } from "../types";
import { fetchJson, parseItems } from "./http";
import { findWorkdayEmployer } from "./workday-employers";

/**
 * Workday career sites ({tenant}.wd{N}.myworkdayjobs.com/{site}) have no public API. The site's own
 * page loads postings from these JSON endpoints (robots.txt doesn't exclude them), used here:
 *   POST /wday/cxs/{tenant}/{site}/jobs  { appliedFacets, limit (20 max), offset, searchText }
 *     -> { total (first page only; later pages may say 0), facets,
 *          jobPostings: [{ title, externalPath, locationsText ("McLean, VA" | "2 Locations"), postedOn }] }
 *   GET  /wday/cxs/{tenant}/{site}{externalPath}
 *     -> { jobPostingInfo: { id, title, jobDescription (HTML), location, additionalLocations,
 *          startDate ("2026-08-25"), postedOn ("Posted 7 Days Ago"), remoteType ("Onsite Job"),
 *          externalUrl, country: { descriptor }, jobRequisitionLocation: { country: { alpha2Code } } } }
 * Shapes verified live on 2026-10-20 against Leidos, CrowdStrike, Booz Allen, Northrop Grumman, RTX,
 * Boeing, Capital One, NVIDIA and Mastercard. A wrong site name returns 404; a wrong tenant or wdN, 422.
 * The hiring organization is a legal entity ("631 Booz Allen Hamilton_United States", often empty),
 * so the company name comes from the list of checked employers, else from the site name.
 *
 * Big sites hold thousands of postings and listings have no descriptions, so a search takes the
 * first results for the profile's top titles, ranks them by title, and fetches details for the best
 * MAX_DETAILS only.
 */

/** How many of the profile's titles are searched. */
export const WORKDAY_MAX_QUERIES = 3;
const PAGE_SIZE = 20; // larger pages are rejected
/** Listing pages per site, split across the queries (three queries get one page each). */
const LISTING_PAGES = 3;
const MAX_DETAILS = 25;
const DETAIL_CONCURRENCY = 5;
/** No request starts after this, and none runs past it by more than 2 s: runSourceTasks gives up at 12 s. */
const BUDGET_MS = 9_000;
/** Workday's id for the United States: the same on every site that has a country filter. */
const US_COUNTRY_ID = "bc33aa3152ec42d4995f4791a106ed09";
/**
 * Workday's Cloudflare front answers bursts with 429 (seen 2026-10-27 after ~1,000 requests in a minute
 * from one IP, across tenants); a request that gets one is retried once after this pause.
 */
export const RATE_LIMIT_PAUSE_MS = 1_500;

export type WorkdayBoard = { tenant: string; dataCenter: string; site: string };

/** "crowdstrike.wd5/crowdstrikecareers" -> { tenant: "crowdstrike", dataCenter: "wd5", site: "crowdstrikecareers" } */
export function parseWorkdaySlug(slug: string): WorkdayBoard {
  const m = slug.match(/^([a-z0-9-]+)\.(wd\d+)\/([\w-]+)$/i);
  if (!m) throw new SourceError(`Not a Workday site: "${slug}" (expected tenant.wdN/site)`);
  return { tenant: m[1].toLowerCase(), dataCenter: m[2].toLowerCase(), site: m[3] };
}

export function workdaySiteUrl(b: WorkdayBoard): string {
  return `https://${b.tenant}.${b.dataCenter}.myworkdayjobs.com/${b.site}`;
}

// Words that describe the site rather than the company ("External_Careers", "CorporateCareers").
const SITE_WORDS = new Set([
  "external", "ext", "internal", "career", "careers", "site", "sites", "job", "jobs", "rec", "gateway", "corporate",
  "portal", "global", "search", "opportunities", "recruiting", "talent", "join", "us", "usa", "en", "main", "public",
  "professional", "professionals", "experienced", "university", "campus", "students", "early", "hiring", "openings",
  "page", "home", "at",
]);

/**
 * The name from the list of checked employers ("bah.wd1/BAH_Jobs" -> "Booz Allen Hamilton"). Otherwise
 * guessed from the site name, else the tenant: "Northrop_Grumman_External_Site" -> "Northrop Grumman",
 * "REC_RTX_Ext_Gateway" -> "RTX", "NVIDIAExternalCareerSite" -> "NVIDIA", "acmecareers" -> "Acme",
 * and leidos's "External" -> "Leidos".
 */
export function workdayCompanyName(b: WorkdayBoard): string {
  const listed = findWorkdayEmployer(`${b.tenant}.${b.dataCenter}/${b.site}`);
  if (listed) return listed.name;
  const words = b.site
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .map((w) => w.replace(/(?:external)?(?:careers?|jobs?|site)+$/i, (suffix, at: number) => (at > 0 ? "" : suffix)))
    .filter((w) => w && !SITE_WORDS.has(w.toLowerCase()));
  if (words.length === 0) return companyFromSlug(b.tenant);
  return words.map((w) => (w === w.toLowerCase() ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Rewrites Workday's location styles as "City, State, Country" for the shared parser:
 * "USA - Sunnyvale, CA" (CrowdStrike), "United States-Virginia-Dulles" (Northrop Grumman) and
 * "US-VA-ARLINGTON-AR1 ~ 1550 Crystal Dr ~ BLDG AR1" (RTX). Anything else passes through.
 */
export function workdayLocation(raw: string): string {
  const text = raw.split("~")[0].trim();
  const spaced = text.match(/^([^,-]+?)\s+-\s+(.+)$/);
  if (spaced && normalizeCountry(spaced[1])) return `${spaced[2]}, ${spaced[1]}`;
  const [country, ...rest] = text.split("-").map((p) => p.trim());
  if (rest.length === 0 || !normalizeCountry(country) || rest.some((p) => !p || p.includes(","))) return text;
  if (rest.length > 1 && /\d/.test(rest[rest.length - 1])) rest.pop(); // a site code such as "B02"
  const parts = rest.map((p) => (p.length > 2 && p === p.toUpperCase() ? titleCase(p) : p));
  return parts.length === 1 ? `${parts[0]}, ${country}` : `${parts.slice(1).join("-")}, ${parts[0]}, ${country}`;
}

/** "Posted Today", "Posted Yesterday", "Posted 3 Days Ago", "Posted 30+ Days Ago". */
export function parsePostedOn(text: string | null | undefined, now = new Date()): Date | null {
  if (!text) return null;
  const days = /today/i.test(text) ? 0 : /yesterday/i.test(text) ? 1 : Number(text.match(/(\d+)\+?\s+days?/i)?.[1] ?? NaN);
  return Number.isFinite(days) ? new Date(now.getTime() - days * 86_400_000) : null;
}

function remoteFromType(type: string | null | undefined): boolean | undefined {
  if (!type) return undefined;
  if (/hybrid|on-?site|office/i.test(type)) return false;
  return /remote|virtual|telework/i.test(type) ? true : undefined;
}

const Listing = z.object({ total: z.number().nullish(), jobPostings: z.array(z.unknown()).nullish() });
const ListingPosting = z.object({ title: z.string(), externalPath: z.string(), locationsText: z.string().nullish() });
type ListingPosting = z.infer<typeof ListingPosting>;

const PostingInfo = z.object({
  id: z.string(),
  title: z.string(),
  jobDescription: z.string().nullish(),
  location: z.string().nullish(),
  additionalLocations: z.array(z.string()).nullish(),
  startDate: z.string().nullish(),
  postedOn: z.string().nullish(),
  remoteType: z.string().nullish(),
  externalUrl: z.string().nullish(),
  country: z.object({ descriptor: z.string().nullish() }).nullish(),
  jobRequisitionLocation: z.object({ country: z.object({ alpha2Code: z.string().nullish() }).nullish() }).nullish(),
});
const Detail = z.object({ jobPostingInfo: PostingInfo });

export function normalizeWorkdayJob(
  info: z.infer<typeof PostingInfo>,
  board: WorkdayBoard,
  externalPath: string,
  now = new Date(),
): NormalizedJob {
  const places = [info.location, ...(info.additionalLocations ?? [])]
    .filter((p): p is string => Boolean(p?.trim()))
    .map(workdayLocation);
  // US places first: the parser reads the first one (same as Greenhouse).
  const us = places.filter((p) => parseLocation(p).country === TARGET_COUNTRY);
  return finalizeJob({
    source: "workday",
    externalId: `${board.tenant}:${info.id}`,
    title: info.title,
    company: workdayCompanyName(board),
    locationRaw: [...us, ...places.filter((p) => !us.includes(p))].join(" • ") || null,
    countryHint: info.jobRequisitionLocation?.country?.alpha2Code ?? info.country?.descriptor,
    remote: remoteFromType(info.remoteType),
    // Some sites double-encode line breaks ("&amp;#xa;").
    description: htmlToText((info.jobDescription ?? "").replace(/&amp;(#x?[0-9a-f]+;)/gi, "&$1")),
    applyUrl: info.externalUrl ?? `${workdaySiteUrl(board)}${externalPath}`,
    postedAt: parseDate(info.startDate) ?? parsePostedOn(info.postedOn, now),
  });
}

/**
 * Which postings get their details fetched: best title matches first, roles two or more levels above
 * the profile last, ties in Workday's order. Nothing is dropped for its title alone: Workday's search
 * is loose ("Financial Analyst" for "security analyst"), but it also finds relevant roles whose titles
 * share no word with the profile ("Analyst I, Falcon Complete" is CrowdStrike's MDR analyst), and
 * only the description tells them apart.
 */
export function rankForDetails<T extends { title: string }>(postings: T[], profile: Pick<Profile, "titles" | "seniority">): T[] {
  return postings
    .map((p, i) => ({
      p,
      i,
      senior: isTooSenior(inferExperienceLevel(p.title), profile.seniority),
      sim: Math.max(0, ...profile.titles.map((t) => titleSimilarity(t, p.title))),
    }))
    .sort((a, b) => Number(a.senior) - Number(b.senior) || b.sim - a.sim || a.i - b.i)
    .map((x) => x.p);
}

function isAbroad(locationsText: string | null | undefined): boolean {
  if (!locationsText) return false;
  const { country } = parseLocation(workdayLocation(locationsText));
  return country !== null && country !== TARGET_COUNTRY;
}

export type WorkdaySearch = {
  /** Search terms, best first (the profile's top titles). Empty: the site's first postings. */
  queries: string[];
  /** Decides which postings get their details fetched. */
  profile: Pick<Profile, "titles" | "excludeKeywords" | "seniority">;
};

export async function fetchWorkday(slug: string, search: WorkdaySearch, signal: AbortSignal): Promise<NormalizedJob[]> {
  const board = parseWorkdaySlug(slug);
  const started = Date.now();
  const inBudget = () => Date.now() - started < BUDGET_MS;
  const stop = AbortSignal.any([signal, AbortSignal.timeout(BUDGET_MS + 2_000)]);
  const api = `https://${board.tenant}.${board.dataCenter}.myworkdayjobs.com/wday/cxs/${board.tenant}/${board.site}`;
  const notFoundMessage = `No Workday career site at ${workdaySiteUrl(board)}`;
  const queries = search.queries.length ? search.queries.slice(0, WORKDAY_MAX_QUERIES) : [""];
  const pagesPerQuery = Math.max(1, Math.floor(LISTING_PAGES / queries.length));
  // Rate limited: one retry after a pause, if the budget still has room for it.
  const getJson: typeof fetchJson = async (url, schema, opts) => {
    try {
      return await fetchJson(url, schema, opts);
    } catch (err) {
      if (!(err instanceof SourceError && err.status === 429) || Date.now() - started > BUDGET_MS - RATE_LIMIT_PAUSE_MS) throw err;
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_PAUSE_MS));
      return fetchJson(url, schema, opts);
    }
  };

  let appliedFacets: Record<string, string[]> = { locationCountry: [US_COUNTRY_ID] };
  const listPage = async (searchText: string, offset: number) => {
    try {
      const data = await getJson(`${api}/jobs`, Listing, {
        signal: stop,
        notFoundMessage,
        body: { appliedFacets, limit: PAGE_SIZE, offset, searchText },
      });
      return { total: data.total ?? 0, postings: parseItems(data.jobPostings ?? [], ListingPosting) };
    } catch (err) {
      if (err instanceof SourceError && err.status === 422) throw new SourceError(notFoundMessage, 422);
      throw err;
    }
  };

  let first: Awaited<ReturnType<typeof listPage>>;
  try {
    first = await listPage(queries[0], 0);
  } catch (err) {
    // Sites without a country filter reject it; search those unfiltered and drop foreign postings below.
    if (!(err instanceof SourceError && err.status === 400)) throw err;
    appliedFacets = {};
    first = await listPage(queries[0], 0);
  }

  const searchQuery = async (query: string, page0: Awaited<ReturnType<typeof listPage>>) => {
    const found = [...page0.postings];
    for (let p = 1; p < pagesPerQuery && found.length < page0.total && inBudget(); p++) {
      const page = await listPage(query, p * PAGE_SIZE);
      if (page.postings.length === 0) break;
      found.push(...page.postings);
    }
    return found;
  };
  // The first page of the first query must work; anything after it is best effort.
  const lists = await Promise.all(
    queries.map((q, i) =>
      i === 0
        ? searchQuery(q, first).catch(() => first.postings)
        : listPage(q, 0).then((page0) => searchQuery(q, page0)).catch((): ListingPosting[] => []),
    ),
  );

  const seen = new Set<string>();
  const candidates = lists.flat().filter((p) => {
    if (seen.has(p.externalPath)) return false;
    seen.add(p.externalPath);
    return !isExcludedTitle(p.title, search.profile.excludeKeywords) && !isAbroad(p.locationsText);
  });
  const picked = rankForDetails(candidates, search.profile).slice(0, MAX_DETAILS);

  const jobs: NormalizedJob[] = [];
  let lastError: unknown = null;
  let next = 0;
  const worker = async () => {
    while (next < picked.length && inBudget() && !stop.aborted) {
      const posting = picked[next++];
      try {
        const data = await getJson(`${api}${posting.externalPath}`, Detail, { signal: stop });
        jobs.push(normalizeWorkdayJob(data.jobPostingInfo, board, posting.externalPath));
      } catch (err) {
        lastError = err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, picked.length) }, worker));
  if (jobs.length === 0 && lastError) throw lastError instanceof Error ? lastError : new SourceError(String(lastError));
  return jobs;
}
