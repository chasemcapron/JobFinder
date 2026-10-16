import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db";
import { jobMatches, jobs, searchRuns, type Profile, type SourceRunResult, type TargetCompanyRow } from "@/db/schema";
import { getClaude } from "@/lib/ai/claude";
import { env } from "@/lib/env";
import { ensureProfile, listEnabledTargetCompanies } from "@/lib/profile";
import { scoreWithClaude } from "./ai-score";
import { dedupeJobs } from "./normalize";
import { keywordScore, MIN_KEYWORD_SCORE, profileHasTerms } from "./scoring";
import { buildSourceTasks, runSourceTasks } from "./sources";
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
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * The one job-search pipeline, shared by the "Refresh jobs" button and the morning cron:
 * fetch all sources in parallel → normalize → dedupe → store → keyword-score → Claude-score
 * the top candidates (capped) → save matches.
 */
export async function runJobSearch(userId: string, opts: Options): Promise<RunSummary> {
  const started = Date.now();
  const db = opts.db ?? (await getDb());
  const profile = await ensureProfile(userId, db);
  const targets = await listEnabledTargetCompanies(userId, db);
  const [run] = await db.insert(searchRuns).values({ userId, trigger: opts.trigger }).returning({ id: searchRuns.id });
  const errors: string[] = [];

  try {
    // 1. Fetch
    const tasks = (opts.buildTasks ?? buildSourceTasks)(profile, targets);
    const { jobs: fetched, results: sources } = await runSourceTasks(tasks, profile);

    // 2. Dedupe across sources
    const unique = dedupeJobs(fetched);
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

    // 4. Keyword prefilter
    const ids = unique.map((j) => idByKey.get(j.dedupeKey)!).filter(Boolean);
    const existingMatches = new Map<string, { aiScored: boolean; scoredAt: Date }>();
    for (const idChunk of chunk(ids, 500)) {
      const rows = await db
        .select({ jobId: jobMatches.jobId, aiScored: jobMatches.aiScored, scoredAt: jobMatches.scoredAt })
        .from(jobMatches)
        .where(and(eq(jobMatches.userId, userId), inArray(jobMatches.jobId, idChunk)));
      for (const r of rows) existingMatches.set(r.jobId, r);
    }
    const hasTerms = profileHasTerms(profile);
    const candidates = unique
      .map((job) => ({ job, id: idByKey.get(job.dedupeKey)!, kw: keywordScore(job, profile) }))
      .filter((c) => c.id && (!hasTerms || c.kw.score >= MIN_KEYWORD_SCORE));

    // 5. Claude scores only the best candidates that don't already have a fresh AI score.
    const isFresh = (id: string) => {
      const m = existingMatches.get(id);
      return Boolean(m?.aiScored && m.scoredAt >= profile.matchingUpdatedAt);
    };
    const cap = opts.maxAiScores ?? env.maxAiScoresPerRun;
    const toAiScore =
      hasTerms && getClaude()
        ? [...candidates].filter((c) => !isFresh(c.id)).sort((a, b) => b.kw.score - a.kw.score).slice(0, cap)
        : [];
    const { scores: aiScores, errors: aiErrors } = await scoreWithClaude(
      profile,
      new Map(toAiScore.map((c) => [c.id, c.job])),
    );
    errors.push(...aiErrors.map((e) => `Claude scoring: ${e}`));

    // 6. Save matches (keep fresh AI scores from earlier runs untouched).
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
          scoredAt: now,
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

    const failed = sources.filter((s) => !s.ok).length;
    const status: RunSummary["status"] =
      failed === sources.length && sources.length > 0 ? "error" : failed > 0 || errors.length ? "partial" : "ok";
    const summary: RunSummary = {
      runId: run.id,
      status,
      sources,
      jobsFetched: fetched.length,
      jobsNew,
      matchesScored: matchRows.length,
      aiScored: aiScores.size,
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

function sqlExcluded(column: string) {
  return sql.raw(`excluded.${column}`);
}
