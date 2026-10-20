import { and, desc, eq } from "drizzle-orm";
import { getDb, type Db } from "@/db";
import { applications, jobMatches, jobs, profiles, type ApplicationStatus, type SheetSyncStatus } from "@/db/schema";
import { appendMappedRow, DEFAULT_COLUMN_MAP } from "@/lib/google/sheets";
import { getGoogleAccessToken, GoogleNotConnectedError } from "@/lib/google/tokens";
import { formatLocation } from "@/lib/jobs/location";
import { localDate } from "@/lib/time";

export type SyncResult = { status: SheetSyncStatus; message: string };

type Deps = {
  db?: Db;
  getToken?: (userId: string) => Promise<string>;
  fetchImpl?: typeof fetch;
};

const STATUS_LABELS: Record<ApplicationStatus, string> = {
  applied: "Applied",
  interviewing: "Interviewing",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export function applicationStatusLabel(s: ApplicationStatus) {
  return STATUS_LABELS[s];
}

/**
 * Saves the application first, then tries to add it to the user's Google Sheet. A Sheets
 * failure never loses the application; it's marked "failed" so it can be retried.
 */
export async function markApplied(userId: string, jobId: string, deps: Deps = {}): Promise<{ applicationId: string; sync: SyncResult }> {
  const db = deps.db ?? (await getDb());
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId), columns: { id: true } });
  if (!job) throw new Error("That job no longer exists.");
  await db.insert(applications).values({ userId, jobId }).onConflictDoNothing();
  const app = await db.query.applications.findFirst({
    where: and(eq(applications.userId, userId), eq(applications.jobId, jobId)),
  });
  if (!app) throw new Error("Couldn't save the application.");
  const sync = await syncApplicationToSheet(userId, app.id, { ...deps, db });
  return { applicationId: app.id, sync };
}

export async function syncApplicationToSheet(userId: string, applicationId: string, deps: Deps = {}): Promise<SyncResult> {
  const db = deps.db ?? (await getDb());
  const [row] = await db
    .select({ app: applications, job: jobs, score: jobMatches.score })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .leftJoin(jobMatches, and(eq(jobMatches.jobId, jobs.id), eq(jobMatches.userId, userId)))
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)));
  if (!row) throw new Error("Application not found.");
  // Never append the same application twice.
  if (row.app.sheetSyncStatus === "synced") return { status: "synced", message: "Already in your sheet." };

  const profile = await db.query.profiles.findFirst({ where: eq(profiles.userId, userId) });
  const save = async (status: SheetSyncStatus, message: string | null) => {
    await db
      .update(applications)
      .set({ sheetSyncStatus: status, sheetSyncError: message, sheetSyncedAt: status === "synced" ? new Date() : null })
      .where(eq(applications.id, applicationId));
    return { status, message: message ?? "Added to your Google Sheet." };
  };

  if (!profile?.sheetId) return save("not_configured", "No Google Sheet set. Add one in Settings to sync applications.");

  try {
    const token = await (deps.getToken ?? ((id) => getGoogleAccessToken(id, db, deps.fetchImpl)))(userId);
    await appendMappedRow({
      token,
      sheetId: profile.sheetId,
      tab: profile.sheetTab,
      map: profile.sheetColumnMap ?? DEFAULT_COLUMN_MAP,
      values: {
        company: row.job.company,
        title: row.job.title,
        dateApplied: localDate(row.app.appliedAt),
        link: row.job.applyUrl,
        location: formatLocation(row.job, row.job.locationRaw),
        status: STATUS_LABELS[row.app.status],
        source: row.job.source,
        ...(row.score != null ? { score: row.score } : {}),
      },
      fetchImpl: deps.fetchImpl,
    });
    return save("synced", null);
  } catch (err) {
    if (err instanceof GoogleNotConnectedError) return save("not_configured", err.message);
    console.error("Sheets sync failed", err);
    return save("failed", err instanceof Error ? err.message : "Sheets sync failed.");
  }
}

export async function updateApplicationStatus(userId: string, applicationId: string, status: ApplicationStatus, db?: Db) {
  db ??= await getDb();
  await db
    .update(applications)
    .set({ status })
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)));
}

export async function deleteApplication(userId: string, applicationId: string, db?: Db) {
  db ??= await getDb();
  await db.delete(applications).where(and(eq(applications.id, applicationId), eq(applications.userId, userId)));
}

export async function listApplications(userId: string, db?: Db) {
  db ??= await getDb();
  return db
    .select({ app: applications, job: jobs })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(eq(applications.userId, userId))
    .orderBy(desc(applications.appliedAt));
}

export type ApplicationStats = {
  total: number;
  thisWeek: number;
  interviewing: number;
  offers: number;
  /** Share of applications that got an answer (interview, offer or rejection), 0-1; null before any. */
  responseRate: number | null;
};

/** Counts for the summary tiles. Withdrawn applications don't count toward the response rate. */
export function summarizeApplications(rows: { status: ApplicationStatus; appliedAt: Date }[], now = new Date()): ApplicationStats {
  const weekAgo = now.getTime() - 7 * 86_400_000;
  const considered = rows.filter((r) => r.status !== "withdrawn");
  const answered = considered.filter((r) => r.status !== "applied").length;
  return {
    total: rows.length,
    thisWeek: rows.filter((r) => r.appliedAt.getTime() >= weekAgo).length,
    interviewing: rows.filter((r) => r.status === "interviewing").length,
    offers: rows.filter((r) => r.status === "offer").length,
    responseRate: considered.length ? answered / considered.length : null,
  };
}

export async function applicationStats(userId: string, db?: Db, now = new Date()): Promise<ApplicationStats> {
  db ??= await getDb();
  const rows = await db
    .select({ status: applications.status, appliedAt: applications.appliedAt })
    .from(applications)
    .where(eq(applications.userId, userId));
  return summarizeApplications(rows, now);
}
