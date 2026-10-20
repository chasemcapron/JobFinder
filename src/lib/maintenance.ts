import { and, eq, lt, notExists } from "drizzle-orm";
import type { Db } from "@/db";
import { applications, jobs, searchRuns } from "@/db/schema";

/** Postings no source has listed for this long are gone; they're already hidden after 21 days. */
export const PRUNE_JOBS_UNSEEN_DAYS = 60;
export const PRUNE_SEARCH_RUNS_DAYS = 90;
const DAY_MS = 86_400_000;

/**
 * Keeps the database inside Neon's free 0.5 GB. Jobs are shared across users, so this is a global
 * maintenance step run only by the CRON_SECRET-protected search cron. Jobs anyone applied to are kept
 * (deleting one would cascade to the application); deleting a job also removes its matches, fit
 * checks and email log rows.
 */
export async function pruneOldData(db: Db, now: Date): Promise<{ jobs: number; searchRuns: number }> {
  const goneJobs = await db
    .delete(jobs)
    .where(
      and(
        lt(jobs.lastSeenAt, new Date(now.getTime() - PRUNE_JOBS_UNSEEN_DAYS * DAY_MS)),
        notExists(db.select({ id: applications.id }).from(applications).where(eq(applications.jobId, jobs.id))),
      ),
    )
    .returning({ id: jobs.id });
  const goneRuns = await db
    .delete(searchRuns)
    .where(lt(searchRuns.startedAt, new Date(now.getTime() - PRUNE_SEARCH_RUNS_DAYS * DAY_MS)))
    .returning({ id: searchRuns.id });
  return { jobs: goneJobs.length, searchRuns: goneRuns.length };
}
