import type { CrawlStatus, Profile } from "@/db/schema";
import { uniqueCaseInsensitive } from "@/lib/text";
import { isExcludedTitle, titleSimilarity } from "../scoring";
import { SourceError, type NormalizedJob } from "../types";
import { fetchJson, parseItems } from "./http";
import {
  Detail,
  isAbroad,
  Listing,
  ListingPosting,
  normalizeWorkdayJob,
  parseWorkdaySlug,
  rankForDetails,
  US_COUNTRY_ID,
  workdayApi,
  workdayListingKey,
  workdaySiteUrl,
} from "./workday";

/**
 * A deep, polite crawl of one Workday career site, for the nightly crawler (scripts/crawl-workday.ts,
 * run by GitHub Actions with no 60 s limit). The Vercel search's fetchWorkday reads one page for
 * three titles and 25 details in 9 s; measured on 2026-11-03, that reached 19 of 34+ relevant
 * Capital One listings, and pages 2-5 were still 45-80% relevant. So this one:
 * - searches every target title and a few synonyms, US filter on;
 * - pages until the site's total, MAX_OFFSET, or two pages in a row with no relevant title;
 * - fetches details only for postings not already stored (`knownKeys`), best titles first;
 * - reports every US listing it saw, so stored postings are marked seen and don't go stale;
 * - spaces requests and backs off on 429 (Workday sits behind Cloudflare, which rate limited one
 *   IP after ~1,000 requests in a minute across tenants on 2026-10-27).
 * Paging and pacing ideas also follow career-ops' Workday scanner (github.com/career-ops-hq/career-ops, MIT).
 */

const PAGE_SIZE = 20;
/** Deepest offset searched per term. */
export const MAX_OFFSET = 400;
/** Listings with at least this title similarity count as relevant (and get their details fetched). */
export const RELEVANT_SIMILARITY = 0.3;
/** Paging goes on only while a page has at least PAGE_KEEP_GOING titles this close to a target title. */
const STRONG_SIMILARITY = 0.5;
const PAGE_KEEP_GOING = 2;
/**
 * Listing pages per site per night, shared by its search terms. Without a budget, 12 terms × 20 pages
 * on 70 sites came to ~16,000 requests a night: too long for the job and impolite to Workday.
 */
export const MAX_PAGES_PER_SITE = 60;
/** Most new postings whose details one crawl fetches per site (the first crawl of a big site). */
export const MAX_DETAILS_PER_SITE = 100;
/** Between requests to one site. */
export const CRAWL_SPACING_MS = 300;
/** A site crawled this recently is left to the crawler by the Vercel search, and its crawl is shown in Settings. */
export const CRAWLED_RECENTLY_MS = 30 * 3_600_000;
/** No single request waits longer than this (a hung connection would otherwise stall the whole crawl). */
const REQUEST_TIMEOUT_MS = 15_000;
/** 429 backoff: tries after the first, with these base delays (plus up to 50% jitter). */
const BACKOFF_MS = [2_000, 5_000, 12_000];
const MAX_QUERIES = 10;

/** Search terms that mean the same work as a target title, for sites whose search is literal. */
const QUERY_SYNONYMS: [RegExp, string[]][] = [
  [/\bdata analyst\b/i, ["reporting analyst", "business intelligence analyst"]],
  [/\bsystems analyst\b/i, ["it specialist", "systems administrator"]],
  [/\bbusiness (systems )?analyst\b/i, ["business analyst"]],
  [/\bproject (analyst|coordinator)\b/i, ["project coordinator", "project analyst"]],
  [/\b(help ?desk|service desk|desktop support)\b/i, ["help desk", "service desk", "desktop support"]],
  [/\b(security|soc|cyber\w*) analyst\b/i, ["soc analyst", "cybersecurity analyst"]],
];
const SENIORITY_WORDS = /\b(junior|jr\.?|senior|sr\.?|entry[- ]level|associate|lead|i{1,3})\b/gi;

/** The profile's titles and keywords, seniority words removed (Workday's search treats them as required), plus synonyms. */
export function buildCrawlQueries(profile: Pick<Profile, "titles" | "searchKeywords">): string[] {
  const base = [...profile.titles, ...profile.searchKeywords].map((t) => t.replace(SENIORITY_WORDS, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
  const synonyms = base.flatMap((t) => QUERY_SYNONYMS.filter(([re]) => re.test(t)).flatMap(([, s]) => s));
  return uniqueCaseInsensitive([...base, ...synonyms]).slice(0, MAX_QUERIES);
}

export type CrawlOptions = {
  queries: string[];
  profile: Pick<Profile, "titles" | "searchKeywords" | "excludeKeywords" | "seniority">;
  /** Of these listing keys, the ones already stored with a description. */
  knownKeys: (keys: string[]) => Promise<Set<string>>;
  signal?: AbortSignal;
  spacingMs?: number;
  maxDetails?: number;
  /** For tests. */
  sleep?: (ms: number) => Promise<void>;
};

export type CrawlResult = {
  status: CrawlStatus;
  /** Postings fetched in full this crawl (new ones). */
  jobs: NormalizedJob[];
  /** Every US listing seen, new or not: stored ones get marked seen. */
  seenKeys: string[];
  /** Workday's own total per search term. */
  totals: Record<string, number>;
  listingsSeen: number;
  detailsFetched: number;
  error?: string;
};

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function crawlWorkdaySite(slug: string, opts: CrawlOptions): Promise<CrawlResult> {
  const board = parseWorkdaySlug(slug);
  const api = workdayApi(board);
  const sleep = opts.sleep ?? realSleep;
  const spacing = opts.spacingMs ?? CRAWL_SPACING_MS;
  const outer = opts.signal ?? new AbortController().signal;
  const signal = () => AbortSignal.any([outer, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
  const terms = [...opts.profile.titles, ...opts.profile.searchKeywords];
  const relevance = (title: string) => Math.max(0, ...terms.map((t) => titleSimilarity(t, title)));
  const totals: Record<string, number> = {};
  const listings = new Map<string, { posting: ListingPosting; relevant: boolean; firstPage: boolean }>();
  let status: CrawlStatus = "ok";
  let error: string | undefined;
  let requests = 0;

  // One request, spaced from the last, retried with backoff on 429.
  const request = async <T>(make: () => Promise<T>): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      if (requests++ > 0) await sleep(spacing);
      try {
        return await make();
      } catch (err) {
        if (!(err instanceof SourceError && err.status === 429) || attempt >= BACKOFF_MS.length) throw err;
        await sleep(BACKOFF_MS[attempt] * (1 + Math.random() * 0.5));
      }
    }
  };

  let facets: Record<string, string[]> = { locationCountry: [US_COUNTRY_ID] };
  const listPage = async (searchText: string, offset: number) => {
    const body = () => ({ appliedFacets: facets, limit: PAGE_SIZE, offset, searchText });
    const call = () => fetchJson(`${api}/jobs`, Listing, { signal: signal(), notFoundMessage: `No Workday career site at ${workdaySiteUrl(board)}`, body: body() });
    try {
      return await request(call);
    } catch (err) {
      // Sites without a country filter reject it: search them unfiltered, drop foreign postings below.
      if (err instanceof SourceError && err.status === 400 && Object.keys(facets).length) {
        facets = {};
        return request(call);
      }
      throw err;
    }
  };

  // The site's page budget is shared evenly by its terms; a term that ends early leaves its pages unused.
  const pagesPerQuery = Math.max(2, Math.ceil(MAX_PAGES_PER_SITE / Math.max(1, opts.queries.length)));
  try {
    for (const query of opts.queries) {
      let total = Infinity;
      let barren = 0;
      const maxOffset = Math.min(MAX_OFFSET, pagesPerQuery * PAGE_SIZE);
      for (let offset = 0; offset < Math.min(total, maxOffset); offset += PAGE_SIZE) {
        const data = await listPage(query, offset);
        // Only the first page states the total; later pages may say 0.
        if (offset === 0) total = data.total ?? 0;
        const postings = parseItems(data.jobPostings ?? [], ListingPosting);
        if (postings.length === 0) break;
        let strong = 0;
        for (const p of postings) {
          const sim = relevance(p.title);
          if (sim >= STRONG_SIMILARITY) strong++;
          const prev = listings.get(p.externalPath);
          listings.set(p.externalPath, {
            posting: p,
            relevant: sim >= RELEVANT_SIMILARITY || Boolean(prev?.relevant),
            firstPage: offset === 0 || Boolean(prev?.firstPage),
          });
        }
        // Two thin pages in a row end the term; one can be followed by a good one (seen on Leidos).
        barren = strong >= PAGE_KEEP_GOING ? 0 : barren + 1;
        if (barren >= 2) break;
      }
      totals[query] = Number.isFinite(total) ? total : 0;
    }
  } catch (err) {
    if (err instanceof SourceError && (err.status === 404 || err.status === 422)) {
      return { status: "not_found", jobs: [], seenKeys: [], totals, listingsSeen: 0, detailsFetched: 0, error: err.message };
    }
    status = err instanceof SourceError && err.status === 429 ? "rate_limited" : "partial";
    error = err instanceof Error ? err.message : String(err);
    if (listings.size === 0) return { status: status === "partial" ? "error" : status, jobs: [], seenKeys: [], totals, listingsSeen: 0, detailsFetched: 0, error };
  }

  const usable = [...listings.values()].filter(
    (l) => !isAbroad(l.posting.locationsText) && !isExcludedTitle(l.posting.title, opts.profile.excludeKeywords),
  );
  const seenKeys = usable.map((l) => workdayListingKey(board, l.posting.externalPath));
  const known = await opts.knownKeys(seenKeys);
  // Details for new postings worth reading: relevant by title, or on a first page (Workday's own
  // best matches, which can be relevant with an unfamiliar title, e.g. "Analyst I, Falcon Complete").
  const wanted = rankForDetails(
    usable.filter((l) => (l.relevant || l.firstPage) && !known.has(workdayListingKey(board, l.posting.externalPath))).map((l) => ({ ...l.posting })),
    { titles: terms, seniority: opts.profile.seniority },
  ).slice(0, opts.maxDetails ?? MAX_DETAILS_PER_SITE);

  const jobs: NormalizedJob[] = [];
  let detailErrors = 0;
  for (const posting of wanted) {
    if (status === "rate_limited" || outer.aborted) break;
    try {
      const data = await request(() => fetchJson(`${api}${posting.externalPath}`, Detail, { signal: signal() }));
      jobs.push(normalizeWorkdayJob(data.jobPostingInfo, board, posting.externalPath));
    } catch (err) {
      if (err instanceof SourceError && err.status === 429) {
        status = "rate_limited";
        error = err.message;
      } else if (!(err instanceof SourceError && err.status === 404)) {
        // 404: closed since it was listed. Anything else counts against the crawl.
        detailErrors++;
        error ??= err instanceof Error ? err.message : String(err);
      }
    }
  }
  if (status === "ok" && detailErrors > 0) status = "partial";
  return { status, jobs, seenKeys, totals, listingsSeen: usable.length, detailsFetched: jobs.length, error };
}
