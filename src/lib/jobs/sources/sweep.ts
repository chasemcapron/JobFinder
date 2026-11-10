import { z } from "zod";
import type { Profile, SweepAts } from "@/db/schema";
import { hardBlockers, type BlockerProfile } from "../blockers";
import { isInTargetCountry } from "../location";
import { bestTitleSimilarity, isExcludedTitle, ownFamily } from "../scoring";
import { SourceError, type NormalizedJob } from "../types";
import { fetchAshby } from "./ashby";
import { fetchGreenhouse } from "./greenhouse";
import { fetchLever } from "./lever";
import { STRONG_SIMILARITY } from "./workday-crawl";

/**
 * The nightly "wide sweep" (scripts/sweep-boards.ts, run by GitHub Actions): every known public
 * Greenhouse, Lever and Ashby board, not just the employers a user picked. Each board answers with
 * its whole list in one request, so ~16,000 boards take minutes. Only US postings whose title is
 * relevant to some user's target titles are stored, which keeps the database inside Neon's free tier.
 * Measured on 2026-11-10 (dry run): 8,550 Greenhouse and 3,203 Ashby boards in under 5 minutes,
 * 150,000 US postings, ~2,000 with entry-level IT or security titles.
 */

/**
 * Board lists from github.com/Riley-Dorrington/job-board-aggregator (MIT): plain JSON arrays of
 * slugs. Read weekly; boards already known stay if a list drops them or the repo goes away.
 */
export const BOARD_LIST_URLS: Record<SweepAts, string> = {
  greenhouse: "https://raw.githubusercontent.com/Riley-Dorrington/job-board-aggregator/main/data/greenhouse_companies.json",
  lever: "https://raw.githubusercontent.com/Riley-Dorrington/job-board-aggregator/main/data/lever_companies.json",
  ashby: "https://raw.githubusercontent.com/Riley-Dorrington/job-board-aggregator/main/data/ashby_companies.json",
};
export const BOARD_LIST_REFRESH_MS = 7 * 86_400_000;
/** A board answering "not found" this many nights in a row is skipped, */
export const MAX_MISSES = 3;
/** then tried again once this long after its last try. */
export const RETRY_GONE_MS = 30 * 86_400_000;
/** The sweep stops starting boards after this; boards not reached go first next night (least recently swept first). */
export const SWEEP_RUN_MS = 25 * 60_000;

/**
 * Requests in flight per source and the pause after each. Lever's robots.txt asks for one request a
 * second (Crawl-delay: 1), so its ~4,400 boards take several nights. Greenhouse and Ashby set no
 * delay; four at a time with a pause stays well under ten requests a second.
 */
export const SWEEP_PACE: Record<SweepAts, { concurrency: number; gapMs: number }> = {
  greenhouse: { concurrency: 4, gapMs: 100 },
  ashby: { concurrency: 4, gapMs: 100 },
  lever: { concurrency: 1, gapMs: 1_000 },
};
const REQUEST_TIMEOUT_MS = 20_000;

/** Slugs as they appear in board URLs; anything else in a list is ignored. */
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** A board list's slugs: valid ones only, first spelling of each kept. */
export function parseBoardList(data: unknown): string[] {
  const items = z.array(z.unknown()).parse(data);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of items) {
    if (typeof s !== "string" || !SLUG.test(s) || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
  }
  return out;
}

export type SweepProfile = Pick<Profile, "titles" | "searchKeywords" | "excludeKeywords"> & BlockerProfile;

/**
 * How close a title must be to a target title. Stricter than the Workday crawl's 0.3, which follows
 * a site's own search results: across all boards, 0.3 kept ~11,000 postings a night for one profile
 * (2026-11-10 dry run), mostly loose matches like "Cloud Architect" for "Security Analyst".
 */
export const SWEEP_SIMILARITY = STRONG_SIMILARITY;

/**
 * Whether a posting is worth storing for this profile: in the US, a title close to a target title,
 * not an excluded title, and not ruled out by the fixed rules the scorer applies anyway (too senior,
 * internship, military branch, active clearance). Null for a profile with nothing to match on.
 */
export function relevanceFilter(profile: SweepProfile): ((job: NormalizedJob) => boolean) | null {
  const terms = [...profile.titles, ...profile.searchKeywords].filter((t) => t.trim());
  if (terms.length === 0) return null;
  const own = ownFamily(profile.titles);
  return (job) =>
    isInTargetCountry(job) &&
    !isExcludedTitle(job.title, profile.excludeKeywords) &&
    bestTitleSimilarity(terms, job.title, own) >= SWEEP_SIMILARITY &&
    hardBlockers(job, profile).length === 0;
}

export type BoardFetchers = {
  greenhouse: (slug: string, signal: AbortSignal, opts: { content?: boolean }) => Promise<NormalizedJob[]>;
  lever: (slug: string, signal: AbortSignal) => Promise<NormalizedJob[]>;
  ashby: (slug: string, signal: AbortSignal) => Promise<NormalizedJob[]>;
};
const FETCHERS: BoardFetchers = { greenhouse: fetchGreenhouse, lever: fetchLever, ashby: fetchAshby };

export type BoardSweep = {
  status: "ok" | "empty" | "gone" | "error";
  /** Postings on the board. */
  count: number;
  /** Relevant to at least one filter, with descriptions. */
  relevant: NormalizedJob[];
  /**
   * The whole board with descriptions, for closing stored postings that left it: when it has a
   * relevant posting or `hasStored` (postings from it were stored earlier, maybe its last relevant
   * one just closed). Otherwise null: a board with nothing of ours isn't worth the larger request.
   */
  full: NormalizedJob[] | null;
};

/**
 * Reads one board. Greenhouse is read without descriptions first (a fraction of the size) and in
 * full only when something on it is relevant, or straight away when `hasStored`; Lever and Ashby
 * always include descriptions.
 */
export async function sweepBoard(
  ats: SweepAts,
  slug: string,
  filters: ((job: NormalizedJob) => boolean)[],
  opts: { hasStored?: boolean; signal?: AbortSignal; fetchers?: BoardFetchers } = {},
): Promise<BoardSweep> {
  const f = opts.fetchers ?? FETCHERS;
  const signal = () => (opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS));
  const isRelevant = (j: NormalizedJob) => filters.some((keep) => keep(j));
  const done = (all: NormalizedJob[]): BoardSweep => {
    if (all.length === 0) return { status: "empty", count: 0, relevant: [], full: null };
    const relevant = all.filter(isRelevant);
    return { status: "ok", count: all.length, relevant, full: relevant.length || opts.hasStored ? all : null };
  };
  try {
    if (ats !== "greenhouse") return done(await (ats === "lever" ? f.lever : f.ashby)(slug, signal()));
    if (opts.hasStored) return done(await f.greenhouse(slug, signal(), {}));
    const listed = await f.greenhouse(slug, signal(), { content: false });
    if (listed.length === 0 || !listed.some(isRelevant)) return { ...done(listed), relevant: [], full: null };
    return done(await f.greenhouse(slug, signal(), {}));
  } catch (err) {
    return { status: err instanceof SourceError && err.status === 404 ? "gone" : "error", count: 0, relevant: [], full: null };
  }
}

/**
 * Runs `work` over `items` in order, `concurrency` at a time, pausing `gapMs` after each, and
 * starting none after `deadline`. Returns how many were started.
 */
export async function runPaced<T>(
  items: T[],
  pace: { concurrency: number; gapMs: number; deadline: number },
  work: (item: T) => Promise<void>,
  opts: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<number> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(pace.concurrency, items.length) }, async () => {
      while (next < items.length && now() < pace.deadline) {
        await work(items[next++]);
        if (pace.gapMs) await sleep(pace.gapMs);
      }
    }),
  );
  return next;
}
