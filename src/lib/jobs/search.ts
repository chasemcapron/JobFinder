import { and, eq, gt, inArray, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db";
import { jobMatches, jobs, searchRuns, workdayCrawlState, type Profile, type SourceRunResult, type TargetCompanyRow } from "@/db/schema";
import { env } from "@/lib/env";
import { redactPersonalInfo } from "@/lib/ai/redact";
import { ensureProfile, getUser, listEnabledTargetCompanies } from "@/lib/profile";
import { hiddenState, loadHidden } from "./dismissals";
import { isCurrentEvaluation } from "./evaluation";
import { isInTargetCountry } from "./location";
import { dedupeJobs, dedupeKey } from "./normalize";
import { finalMatch, rankCandidates, type JobForScoring } from "./rank";
import { STALE_AFTER_DAYS } from "./results";
import { buildSourceTasks, runSourceTasks } from "./sources";
import { CRAWLED_RECENTLY_MS } from "./sources/workday-crawl";
import type { NormalizedJob, SourceTask } from "./types";
import { ensureStarterCompanies } from "./recommend-companies";

export type RunSummary = {
  runId: string;
  status: "ok" | "partial" | "error";
  sources: SourceRunResult[];
  jobsFetched: number;
  jobsNew: number;
  matchesScored: number;
  aiScored: number;
  errors: string[];
  durationMs: number;
};

type Options = {
  trigger: "manual" | "cron";
  db?: Db;
  /** For tests: replace the real source adapters. */
  buildTasks?: (profile: Profile, targets: TargetCompanyRow[]) => SourceTask[];
  maxAiScores?: number;
  /** false: keyword scores only (no AI work at all), e.g. a manual refresh past the daily limit. */
  useAi?: boolean;
  /** Epoch ms by which AI scoring must finish. Defaults to 42 s after the run starts (Vercel allows 60 s). */
  deadline?: number;
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** No search runs this long: Vercel stops a function after 60 s. */
export const ABANDONED_RUN_MS = 5 * 60_000;
export const ABANDONED_RUN_ERROR = "Stopped before finishing (the server function ran out of time)";

/** True while a search for this user started in the last minute and hasn't finished (functions stop at 60 s). */
export async function searchInFlight(userId: string, db: Db, now = new Date()) {
  const running = await db.query.searchRuns.findFirst({
    where: and(eq(searchRuns.userId, userId), eq(searchRuns.status, "running"), gt(searchRuns.startedAt, new Date(now.getTime() - 60_000))),
  });
  return Boolean(running);
}

/** A user whose search (any trigger) started this recently and didn't fail is skipped by the next cron slot. */
export const SEARCHED_RECENTLY_MS = 12 * 3_600_000;

/**
 * The users a daily search slot should search, least recently searched first (never searched
 * before all). One search takes ~40 s of a 60 s function, so each slot reaches about one user;
 * with three slots (vercel.json) and this order, every user gets a search, and with more users
 * than slots the ones a day missed go first the next day. Failed searches don't count, so they're
 * retried in the next slot; nor do ones Vercel stopped mid-run (still "running" past
 * ABANDONED_RUN_MS: closeAbandonedRuns only marks them at the user's next search).
 */
export async function usersDueForSearch(userIds: string[], db: Db, now = new Date()): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await db
    .select({ userId: searchRuns.userId, last: sql`max(${searchRuns.startedAt})`.mapWith(searchRuns.startedAt) })
    .from(searchRuns)
    .where(
      and(
        inArray(searchRuns.userId, userIds),
        ne(searchRuns.status, "error"),
        or(ne(searchRuns.status, "running"), gt(searchRuns.startedAt, new Date(now.getTime() - ABANDONED_RUN_MS))),
      ),
    )
    .groupBy(searchRuns.userId);
  const last = new Map(rows.map((r) => [r.userId, r.last.getTime()]));
  const at = (id: string) => last.get(id) ?? 0;
  return userIds
    .filter((id) => now.getTime() - at(id) >= SEARCHED_RECENTLY_MS)
    .sort((a, b) => at(a) - at(b) || a.localeCompare(b));
}

/** Marks runs still "running" past ABANDONED_RUN_MS as stopped, so they don't read as in progress forever. */
export async function closeAbandonedRuns(userId: string, db: Db, now: Date) {
  await db
    .update(searchRuns)
    .set({ status: "error", finishedAt: now, error: ABANDONED_RUN_ERROR })
    .where(
      and(
        eq(searchRuns.userId, userId),
        eq(searchRuns.status, "running"),
        lt(searchRuns.startedAt, new Date(now.getTime() - ABANDONED_RUN_MS)),
      ),
    );
}

/** Workday sites the nightly crawler covered recently; the Vercel search leaves them to it. */
async function recentlyCrawled(userId: string, db: Db, now: Date): Promise<Set<string>> {
  const rows = await db
    .select({ slug: workdayCrawlState.slug })
    .from(workdayCrawlState)
    .where(
      and(
        eq(workdayCrawlState.userId, userId),
        gt(workdayCrawlState.lastCrawledAt, new Date(now.getTime() - CRAWLED_RECENTLY_MS)),
        or(eq(workdayCrawlState.status, "ok"), eq(workdayCrawlState.status, "partial")),
      ),
    );
  return new Set(rows.map((r) => r.slug));
}

type StorableJob = NormalizedJob & { dedupeKey: string };

/**
 * Inserts new postings and refreshes stored ones (last seen, derived fields, reopened if they had
 * been marked closed). Shared by the search and the Workday crawler. Returns each posting's id by
 * dedupe key and how many were new.
 */
export async function storeJobs(db: Db, unique: StorableJob[], now: Date) {
  const idByKey = new Map<string, string>();
  for (const keys of chunk(unique.map((j) => j.dedupeKey), 500)) {
    const rows = await db.select({ id: jobs.id, dedupeKey: jobs.dedupeKey }).from(jobs).where(inArray(jobs.dedupeKey, keys));
    for (const r of rows) idByKey.set(r.dedupeKey, r.id);
  }
  const existingCount = idByKey.size;
  for (const batch of chunk(unique, 200)) {
    const rows = await db
      .insert(jobs)
      .values(batch.map((j) => ({ ...j, firstSeenAt: now, lastSeenAt: now })))
      // Derived fields are refreshed too, so better parsing reaches postings already stored.
      .onConflictDoUpdate({
        target: jobs.dedupeKey,
        set: {
          lastSeenAt: now,
          closedAt: null,
          experienceLevel: sqlExcluded("experience_level"),
          minYears: sqlExcluded("min_years"),
          clearance: sqlExcluded("clearance"),
          listingKey: sql.raw("coalesce(excluded.listing_key, jobs.listing_key)"),
        },
      })
      .returning({ id: jobs.id, dedupeKey: jobs.dedupeKey });
    for (const r of rows) idByKey.set(r.dedupeKey, r.id);
  }
  return { idByKey, jobsNew: unique.length - existingCount };
}

/** Marks Workday postings seen by a crawl (by listing key) as seen now, and open. */
export async function markListingsSeen(db: Db, listingKeys: string[], now: Date) {
  for (const keys of chunk(listingKeys, 500)) {
    await db.update(jobs).set({ lastSeenAt: now, closedAt: null }).where(inArray(jobs.listingKey, keys));
  }
}

/**
 * Greenhouse, Lever and Ashby return a company's whole board in one request, so a posting stored
 * from that board but missing from a fresh fetch has closed. Only boards that answered with
 * postings count (an empty answer could be a hiccup). The idea follows career-ops' liveness checks
 * (github.com/career-ops-hq/career-ops, MIT); Workday is checked per posting instead (liveness.ts).
 */
export async function closeMissingPostings(db: Db, fetched: StorableJob[], now: Date): Promise<number> {
  const boards = new Map<string, { source: NormalizedJob["source"]; company: string; keys: string[] }>();
  for (const j of fetched) {
    if (j.source !== "greenhouse" && j.source !== "lever" && j.source !== "ashby") continue;
    const id = `${j.source}|${j.company}`;
    const b = boards.get(id) ?? { source: j.source, company: j.company, keys: [] };
    b.keys.push(j.dedupeKey);
    boards.set(id, b);
  }
  let closed = 0;
  for (const b of boards.values()) {
    const rows = await db
      .update(jobs)
      .set({ closedAt: now })
      .where(and(eq(jobs.source, b.source), eq(jobs.company, b.company), isNull(jobs.closedAt), notInArray(jobs.dedupeKey, b.keys)))
      .returning({ id: jobs.id });
    closed += rows.length;
  }
  return closed;
}

/**
 * closeMissingPostings for one board known by slug, for the wide sweep: matching by company name
 * would let two boards with the same name (sibling boards, or slugs like "acme-inc" and "acme_inc")
 * close each other's postings. Greenhouse, Lever and Ashby ids are "{slug}:{id}". `onBoard` is the
 * board's whole current list (dedupe keys); stored postings from it not on the list are closed.
 * An empty list closes nothing: like closeMissingPostings, an empty answer could be a hiccup.
 */
export async function closeMissingOnBoard(
  db: Db,
  board: { source: "greenhouse" | "lever" | "ashby"; slug: string },
  onBoard: string[],
  now: Date,
): Promise<number> {
  if (onBoard.length === 0) return 0;
  const rows = await db
    .update(jobs)
    .set({ closedAt: now })
    .where(
      and(
        eq(jobs.source, board.source),
        sql`starts_with(${jobs.externalId}, ${`${board.slug}:`})`,
        isNull(jobs.closedAt),
        notInArray(jobs.dedupeKey, onBoard),
      ),
    )
    .returning({ id: jobs.id });
  return rows.length;
}

/**
 * The one job-search pipeline, shared by the "Refresh jobs" button and the morning cron:
 * fetch all sources in parallel → normalize → dedupe → keep US jobs → store → score (see
 * scoreAndSaveMatches) → save matches.
 */
export async function runJobSearch(userId: string, opts: Options): Promise<RunSummary> {
  const started = Date.now();
  const db = opts.db ?? (await getDb());
  const profile = await ensureProfile(userId, db);
  // An account without employers of its own gets a starting list first (once), so this search uses it.
  await ensureStarterCompanies(userId, db).catch((err) => console.error("Starter employers failed", err));
  // Workday sites the nightly crawler covered are left to it; the rest (or all, if it stopped) are searched here.
  const crawled = await recentlyCrawled(userId, db, new Date(started));
  const targets = (await listEnabledTargetCompanies(userId, db)).filter((t) => !(t.ats === "workday" && crawled.has(t.slug)));
  await closeAbandonedRuns(userId, db, new Date(started));
  const [run] = await db.insert(searchRuns).values({ userId, trigger: opts.trigger }).returning({ id: searchRuns.id });
  const errors: string[] = [];

  try {
    // 1. Fetch
    const tasks = (opts.buildTasks ?? buildSourceTasks)(profile, targets);
    const { jobs: fetched, results: sources } = await runSourceTasks(tasks, profile);

    // 2. Dedupe across sources and keep US jobs only
    const unique = dedupeJobs(fetched).filter(isInTargetCountry);
    const now = new Date();

    // 3. Store (insert new, touch existing), and close hosted-board postings that disappeared.
    const { idByKey, jobsNew } = await storeJobs(db, unique, now);
    // Each board's own postings, before dedupe: a role also on another board is still on this one.
    await closeMissingPostings(db, fetched.map((j) => ({ ...j, dedupeKey: dedupeKey(j) })), now);

    // 4. Score what was fetched plus everything already matched, then save.
    const fetchedById = new Map<string, JobForScoring>();
    for (const j of unique) {
      const id = idByKey.get(j.dedupeKey);
      if (id) fetchedById.set(id, j);
    }
    const scored = await scoreAndSaveMatches(userId, profile, db, {
      fetched: fetchedById,
      useAi: opts.useAi ?? true,
      maxAiScores: opts.maxAiScores,
      deadline: opts.deadline ?? started + 42_000,
      now,
    });
    errors.push(...scored.errors);

    const failed = sources.filter((s) => !s.ok).length;
    const status: RunSummary["status"] =
      failed === sources.length && sources.length > 0 ? "error" : failed > 0 || errors.length ? "partial" : "ok";
    const summary: RunSummary = {
      runId: run.id,
      status,
      sources,
      jobsFetched: fetched.length,
      jobsNew,
      matchesScored: scored.saved,
      aiScored: scored.aiScored,
      errors,
      durationMs: Date.now() - started,
    };
    await db
      .update(searchRuns)
      .set({
        finishedAt: new Date(),
        status,
        sourceResults: sources,
        jobsFetched: summary.jobsFetched,
        jobsNew,
        matchesScored: summary.matchesScored,
        aiScored: summary.aiScored,
        error: errors.length ? errors.join("; ").slice(0, 2000) : null,
      })
      .where(eq(searchRuns.id, run.id));
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(searchRuns)
      .set({ finishedAt: new Date(), status: "error", error: message.slice(0, 2000) })
      .where(eq(searchRuns.id, run.id));
    throw err;
  }
}

/**
 * Re-ranks the user's stored matches against the current profile with the keyword matcher
 * (no fetching, no AI), so edits to the resume or preferences apply to every job right away.
 * The next search, or the backlog cron (scoreBacklog), then has the AI evaluate them again.
 */
export async function rescoreStoredMatches(userId: string, db?: Db) {
  db ??= await getDb();
  const profile = await ensureProfile(userId, db);
  return scoreAndSaveMatches(userId, profile, db, { fetched: new Map(), useAi: false, now: new Date() });
}

/**
 * How many roles one backlog run evaluates: 10 batches of 8. Batches start 4.5 s apart (the
 * free tier's per-minute limit), so about 10 fit in the cron's 50 s of AI time.
 */
export const BACKLOG_CAP = 80;

/**
 * Has the AI evaluate stored matches that lack a current evaluation, with no fetching: after a
 * profile change every evaluation is stale, and a search only evaluates its usual cap. Run by
 * the score cron between the morning search and the email.
 */
export async function scoreBacklog(userId: string, opts: { db?: Db; deadline: number; cap?: number }) {
  const db = opts.db ?? (await getDb());
  // Hobby crons fire at any minute of their hour, so a late search can still be running: it
  // evaluates the same roles, and doing both would double the free-tier calls.
  if (await searchInFlight(userId, db)) return { saved: 0, removed: 0, aiScored: 0, errors: ["A search is running; skipped"] };
  const profile = await ensureProfile(userId, db);
  return scoreAndSaveMatches(userId, profile, db, {
    fetched: new Map(),
    useAi: true,
    maxAiScores: opts.cap ?? BACKLOG_CAP,
    deadline: opts.deadline,
    now: new Date(),
  });
}

/** The resume as the AI may see it: personal details removed (free-tier inputs may be used by Google). */
async function redactedResume(userId: string, profile: Profile, db: Db): Promise<string | null> {
  if (!profile.resumeText?.trim()) return null;
  const user = await getUser(userId, db);
  return redactPersonalInfo(profile.resumeText, { names: [user?.name] });
}

/**
 * Scores `fetched` jobs plus every job the user already has a (non-stale) match for:
 * 1. drops matches for excluded titles, non-US rows from before the US-only change, and
 *    sample jobs in production;
 * 2. keyword-scores the rest. Every job gets a match row, however weak: the list hides weak
 *    ones, and keeping them lets a profile change re-rank everything recent searches found;
 * 3. AI-scores the best candidates that lack a fresh AI score (newer than the last profile change);
 * 4. upserts matches, leaving fresh AI scores untouched.
 */
export async function scoreAndSaveMatches(
  userId: string,
  profile: Profile,
  db: Db,
  opts: { fetched: Map<string, JobForScoring>; useAi: boolean; maxAiScores?: number; deadline?: number; now: Date },
): Promise<{ saved: number; removed: number; aiScored: number; errors: string[] }> {
  const errors: string[] = [];
  const staleBefore = new Date(opts.now.getTime() - STALE_AFTER_DAYS * 86_400_000);

  // Stored matches (with their jobs) for this user.
  const stored = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      company: jobs.company,
      source: jobs.source,
      description: jobs.description,
      city: jobs.city,
      state: jobs.state,
      country: jobs.country,
      remote: jobs.remote,
      locationRaw: jobs.locationRaw,
      experienceLevel: jobs.experienceLevel,
      minYears: jobs.minYears,
      clearance: jobs.clearance,
      aiScored: jobMatches.aiScored,
      scoredAt: jobMatches.scoredAt,
      evaluation: jobMatches.evaluation,
    })
    .from(jobMatches)
    .innerJoin(jobs, eq(jobs.id, jobMatches.jobId))
    .where(and(eq(jobMatches.userId, userId), gt(jobs.lastSeenAt, staleBefore), isNull(jobs.closedAt)));

  const existing = new Map(stored.map((r) => [r.id, r]));
  const all = new Map<string, JobForScoring>(stored.map((r) => [r.id, r]));
  for (const [id, job] of opts.fetched) all.set(id, job);

  // Fresh: evaluated by the AI since the last profile change, with the current prompt.
  const isFresh = (id: string) => {
    const m = existing.get(id);
    return Boolean(m?.aiScored && m.scoredAt >= profile.matchingUpdatedAt && isCurrentEvaluation(m.evaluation));
  };
  const hidden = opts.useAi ? await loadHidden(userId, db) : null;
  const { candidates, excluded, aiScores, errors: rankErrors } = await rankCandidates(profile, all, {
    isFresh,
    skipAi: hidden ? (job) => Boolean(hiddenState(job, hidden)) : undefined,
    cap: opts.maxAiScores ?? env.maxAiScoresPerRun,
    useAi: opts.useAi,
    hideMock: env.isProduction && !env.mockJobs,
    deadline: opts.deadline,
    resume: opts.useAi ? await redactedResume(userId, profile, db) : null,
  });
  errors.push(...rankErrors);

  const toRemove = excluded.filter((id) => existing.has(id));
  for (const ids of chunk(toRemove, 500)) {
    await db.delete(jobMatches).where(and(eq(jobMatches.userId, userId), inArray(jobMatches.jobId, ids)));
  }

  // Save (keep fresh AI evaluations from earlier runs untouched).
  const matchRows = candidates
    .filter((c) => aiScores.has(c.id) || !isFresh(c.id))
    .map((c) => {
      const final = finalMatch(c, aiScores.get(c.id));
      return {
        userId,
        jobId: c.id,
        score: final.score,
        keywordScore: c.kw.score,
        aiScored: final.aiScored,
        reasons: final.reasons,
        matchedKeywords: c.kw.matched,
        verdict: final.verdict,
        evaluation: final.evaluation,
        scoredAt: opts.now,
      };
    });
  for (const batch of chunk(matchRows, 300)) {
    await db
      .insert(jobMatches)
      .values(batch)
      .onConflictDoUpdate({
        target: [jobMatches.userId, jobMatches.jobId],
        set: {
          score: sqlExcluded("score"),
          keywordScore: sqlExcluded("keyword_score"),
          aiScored: sqlExcluded("ai_scored"),
          reasons: sqlExcluded("reasons"),
          matchedKeywords: sqlExcluded("matched_keywords"),
          verdict: sqlExcluded("verdict"),
          evaluation: sqlExcluded("evaluation"),
          scoredAt: sqlExcluded("scored_at"),
        },
      });
  }
  return { saved: matchRows.length, removed: toRemove.length, aiScored: aiScores.size, errors };
}

function sqlExcluded(column: string) {
  return sql.raw(`excluded.${column}`);
}
