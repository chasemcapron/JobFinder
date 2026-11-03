import { and, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db";
import { jobMatches, jobs, searchRuns, type Profile, type SourceRunResult, type TargetCompanyRow } from "@/db/schema";
import { env } from "@/lib/env";
import { redactPersonalInfo } from "@/lib/ai/redact";
import { ensureProfile, getUser, listEnabledTargetCompanies } from "@/lib/profile";
import { isCurrentEvaluation } from "./evaluation";
import { isInTargetCountry } from "./location";
import { dedupeJobs } from "./normalize";
import { finalMatch, rankCandidates, type JobForScoring } from "./rank";
import { STALE_AFTER_DAYS } from "./results";
import { buildSourceTasks, mockJobsForced, runSourceTasks } from "./sources";
import type { SourceTask } from "./types";

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

/**
 * The one job-search pipeline, shared by the "Refresh jobs" button and the morning cron:
 * fetch all sources in parallel → normalize → dedupe → keep US jobs → store → score (see
 * scoreAndSaveMatches) → save matches.
 */
export async function runJobSearch(userId: string, opts: Options): Promise<RunSummary> {
  const started = Date.now();
  const db = opts.db ?? (await getDb());
  const profile = await ensureProfile(userId, db);
  const targets = await listEnabledTargetCompanies(userId, db);
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

    // 3. Store (insert new, touch existing)
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
            experienceLevel: sqlExcluded("experience_level"),
            minYears: sqlExcluded("min_years"),
            clearance: sqlExcluded("clearance"),
          },
        })
        .returning({ id: jobs.id, dedupeKey: jobs.dedupeKey });
      for (const r of rows) idByKey.set(r.dedupeKey, r.id);
    }
    const jobsNew = unique.length - existingCount;

    // 4. Score what was fetched plus everything already matched, then save.
    const fetchedById = new Map<string, JobForScoring>();
    for (const j of unique) {
      const id = idByKey.get(j.dedupeKey);
      if (id) fetchedById.set(id, j);
    }
    const scored = await scoreAndSaveMatches(userId, profile, db, {
      fetched: fetchedById,
      useAi: true,
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
async function scoreAndSaveMatches(
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
    .where(and(eq(jobMatches.userId, userId), gt(jobs.lastSeenAt, staleBefore)));

  const existing = new Map(stored.map((r) => [r.id, r]));
  const all = new Map<string, JobForScoring>(stored.map((r) => [r.id, r]));
  for (const [id, job] of opts.fetched) all.set(id, job);

  // Fresh: evaluated by the AI since the last profile change, with the current prompt.
  const isFresh = (id: string) => {
    const m = existing.get(id);
    return Boolean(m?.aiScored && m.scoredAt >= profile.matchingUpdatedAt && isCurrentEvaluation(m.evaluation));
  };
  const { candidates, excluded, aiScores, errors: rankErrors } = await rankCandidates(profile, all, {
    isFresh,
    cap: opts.maxAiScores ?? env.maxAiScoresPerRun,
    useAi: opts.useAi,
    hideMock: env.isProduction && !mockJobsForced(),
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
