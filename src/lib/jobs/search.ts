import { and, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db";
import { jobMatches, jobs, searchRuns, type JobSource, type Profile, type SourceRunResult, type TargetCompanyRow } from "@/db/schema";
import { aiProvider } from "@/lib/ai/provider";
import { env } from "@/lib/env";
import { ensureProfile, listEnabledTargetCompanies } from "@/lib/profile";
import { normalizeForKey } from "@/lib/text";
import { scoreWithAi, type AiScore } from "./ai-score";
import { isInTargetCountry } from "./location";
import { dedupeJobs } from "./normalize";
import { STALE_AFTER_DAYS } from "./results";
import { isExcludedTitle, keywordScore, profileHasTerms, type ScoredJob } from "./scoring";
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

type JobForScoring = ScoredJob & { company: string; source: JobSource };

/** No search runs this long: Vercel stops a function after 60 s. */
export const ABANDONED_RUN_MS = 5 * 60_000;
export const ABANDONED_RUN_ERROR = "Stopped before finishing (the server function ran out of time)";

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
        .onConflictDoUpdate({ target: jobs.dedupeKey, set: { lastSeenAt: now } })
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
 * The next search then AI-scores the top ones again.
 */
export async function rescoreStoredMatches(userId: string, db?: Db) {
  db ??= await getDb();
  const profile = await ensureProfile(userId, db);
  return scoreAndSaveMatches(userId, profile, db, { fetched: new Map(), useAi: false, now: new Date() });
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
      aiScored: jobMatches.aiScored,
      scoredAt: jobMatches.scoredAt,
    })
    .from(jobMatches)
    .innerJoin(jobs, eq(jobs.id, jobMatches.jobId))
    .where(and(eq(jobMatches.userId, userId), gt(jobs.lastSeenAt, staleBefore)));

  const existing = new Map(stored.map((r) => [r.id, r]));
  const all = new Map<string, JobForScoring>(stored.map((r) => [r.id, r]));
  for (const [id, job] of opts.fetched) all.set(id, job);

  const isFresh = (id: string) => {
    const m = existing.get(id);
    return Boolean(m?.aiScored && m.scoredAt >= profile.matchingUpdatedAt);
  };
  const hideMock = env.isProduction && !mockJobsForced();
  const hasTerms = profileHasTerms(profile);

  const toRemove: string[] = [];
  const candidates: { id: string; job: JobForScoring; kw: ReturnType<typeof keywordScore> }[] = [];
  for (const [id, job] of all) {
    if (isExcludedTitle(job.title, profile.excludeKeywords) || !isInTargetCountry(job) || (hideMock && job.source === "mock")) {
      if (existing.has(id)) toRemove.push(id);
      continue;
    }
    candidates.push({ id, job, kw: keywordScore(job, profile) });
  }
  for (const ids of chunk(toRemove, 500)) {
    await db.delete(jobMatches).where(and(eq(jobMatches.userId, userId), inArray(jobMatches.jobId, ids)));
  }

  // AI scores only the best candidates that don't already have a fresh AI score. Companies
  // often post one role once per city ("Solutions Engineer" x 11 states), so each company +
  // title is scored once and the result is shared with its copies, saving free-tier quota.
  const cap = opts.maxAiScores ?? env.maxAiScoresPerRun;
  const groups = new Map<string, typeof candidates>();
  if (opts.useAi && hasTerms && aiProvider()) {
    for (const c of [...candidates].filter((c) => !isFresh(c.id)).sort((a, b) => b.kw.score - a.kw.score)) {
      const key = `${normalizeForKey(c.job.company)}|${normalizeForKey(c.job.title)}`;
      const group = groups.get(key);
      if (group) group.push(c);
      else if (groups.size < cap) groups.set(key, [c]);
    }
  }
  const representatives = [...groups.values()].map((g) => g[0]);
  const { scores: groupScores, errors: aiErrors } = await scoreWithAi(
    profile,
    new Map(representatives.map((c) => [c.id, c.job])),
    { deadline: opts.deadline },
  );
  errors.push(...aiErrors.map((e) => `AI scoring: ${e}`));
  const aiScores = new Map<string, AiScore>();
  for (const group of groups.values()) {
    const score = groupScores.get(group[0].id);
    if (score) for (const c of group) aiScores.set(c.id, score);
  }

  // Save (keep fresh AI scores from earlier runs untouched).
  const matchRows = candidates
    .filter((c) => aiScores.has(c.id) || !isFresh(c.id))
    .map((c) => {
      const ai = aiScores.get(c.id);
      return {
        userId,
        jobId: c.id,
        score: ai?.score ?? c.kw.score,
        keywordScore: c.kw.score,
        aiScored: Boolean(ai),
        reasons: ai?.reason ?? c.kw.reason,
        matchedKeywords: c.kw.matched,
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
          scoredAt: sqlExcluded("scored_at"),
        },
      });
  }
  return { saved: matchRows.length, removed: toRemove.length, aiScored: aiScores.size, errors };
}

function sqlExcluded(column: string) {
  return sql.raw(`excluded.${column}`);
}
