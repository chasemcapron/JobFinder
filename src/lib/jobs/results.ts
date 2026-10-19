import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db";
import { applications, jobMatches, jobs, searchRuns, type ApplicationStatus, type JobRow, type SheetSyncStatus } from "@/db/schema";
import { TARGET_COUNTRY } from "./location";

/** Postings not seen by any search in this long are treated as closed and hidden. */
export const STALE_AFTER_DAYS = 21;

/** Upper bound on rows loaded per page view; filtering happens in memory (see filters.ts). */
const MAX_RESULTS = 2000;
const SEARCHABLE_DESCRIPTION_CHARS = 3000;

export type MatchResult = {
  job: Pick<
    JobRow,
    | "id"
    | "source"
    | "title"
    | "company"
    | "locationRaw"
    | "city"
    | "state"
    | "country"
    | "remote"
    | "experienceLevel"
    | "applyUrl"
    | "postedAt"
    | "salaryMin"
    | "salaryMax"
    | "salaryCurrency"
    | "firstSeenAt"
    | "description"
  >;
  score: number;
  aiScored: boolean;
  reasons: string;
  matchedKeywords: string[];
  application: {
    id: string;
    status: ApplicationStatus;
    appliedAt: Date;
    sheetSyncStatus: SheetSyncStatus;
    sheetSyncError: string | null;
  } | null;
};

/** SQL twin of `isInTargetCountry`: US jobs plus jobs with no parsed country. Hides older non-US rows too. */
export const inTargetCountry = or(isNull(jobs.country), eq(jobs.country, TARGET_COUNTRY));

export async function listMatches(userId: string, db?: Db): Promise<MatchResult[]> {
  db ??= await getDb();
  const staleBefore = new Date(Date.now() - STALE_AFTER_DAYS * 86_400_000);
  const rows = await db
    .select({
      job: {
        id: jobs.id,
        source: jobs.source,
        title: jobs.title,
        company: jobs.company,
        locationRaw: jobs.locationRaw,
        city: jobs.city,
        state: jobs.state,
        country: jobs.country,
        remote: jobs.remote,
        experienceLevel: jobs.experienceLevel,
        applyUrl: jobs.applyUrl,
        postedAt: jobs.postedAt,
        salaryMin: jobs.salaryMin,
        salaryMax: jobs.salaryMax,
        salaryCurrency: jobs.salaryCurrency,
        firstSeenAt: jobs.firstSeenAt,
        // Only used for keyword search; the head of a posting carries the signal.
        description: sql<string>`left(${jobs.description}, ${sql.raw(String(SEARCHABLE_DESCRIPTION_CHARS))})`,
      },
      score: jobMatches.score,
      aiScored: jobMatches.aiScored,
      reasons: jobMatches.reasons,
      matchedKeywords: jobMatches.matchedKeywords,
      applicationId: applications.id,
      applicationStatus: applications.status,
      appliedAt: applications.appliedAt,
      sheetSyncStatus: applications.sheetSyncStatus,
      sheetSyncError: applications.sheetSyncError,
    })
    .from(jobMatches)
    .innerJoin(jobs, eq(jobs.id, jobMatches.jobId))
    .leftJoin(applications, and(eq(applications.jobId, jobs.id), eq(applications.userId, userId)))
    .where(and(eq(jobMatches.userId, userId), gt(jobs.lastSeenAt, staleBefore), inTargetCountry))
    .orderBy(desc(jobMatches.score), desc(jobs.postedAt))
    .limit(MAX_RESULTS);

  return rows.map((r) => ({
    job: r.job,
    score: r.score,
    aiScored: r.aiScored,
    reasons: r.reasons,
    matchedKeywords: r.matchedKeywords,
    application:
      r.applicationId && r.applicationStatus && r.appliedAt && r.sheetSyncStatus
        ? {
            id: r.applicationId,
            status: r.applicationStatus,
            appliedAt: r.appliedAt,
            sheetSyncStatus: r.sheetSyncStatus,
            sheetSyncError: r.sheetSyncError,
          }
        : null,
  }));
}

export async function lastSearchRun(userId: string, db?: Db) {
  db ??= await getDb();
  return db.query.searchRuns.findFirst({
    where: eq(searchRuns.userId, userId),
    orderBy: desc(searchRuns.startedAt),
  });
}
