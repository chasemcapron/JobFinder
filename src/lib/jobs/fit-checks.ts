import { and, eq, inArray } from "drizzle-orm";
import { getDb, type Db } from "@/db";
import { fitChecks, type FitCheckResult } from "@/db/schema";

/** What the job card shows. `stale` means the profile changed after the check was made. */
export type FitCheckView = { result: FitCheckResult; model: string; checkedAt: string; stale: boolean };

export async function listFitChecks(userId: string, jobIds: string[], profileChangedAt: Date, db?: Db) {
  const out = new Map<string, FitCheckView>();
  if (jobIds.length === 0) return out;
  db ??= await getDb();
  const rows = await db
    .select()
    .from(fitChecks)
    .where(and(eq(fitChecks.userId, userId), inArray(fitChecks.jobId, jobIds)));
  for (const r of rows) {
    out.set(r.jobId, { result: r.result, model: r.model, checkedAt: r.createdAt.toISOString(), stale: r.createdAt < profileChangedAt });
  }
  return out;
}
