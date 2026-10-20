import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { rejectUnlessCron } from "@/lib/cron";
import { digestRecipients } from "@/lib/email/digest";
import { runJobSearch } from "@/lib/jobs/search";
import { pruneOldData } from "@/lib/maintenance";

// One search per user (sources in parallel with 12 s timeouts, AI scoring done by ~42 s).
export const maxDuration = 60;
/** Don't start another user's search past this point, to stay inside maxDuration. */
const START_BUDGET_MS = 15_000;

/**
 * Scheduled at 10:00 UTC (5 AM Central in summer, 4 AM in winter): the slow, Gemini-using part of the
 * morning, done well before the 7 AM email so a slow search can't make the email miss its window.
 * Also prunes old jobs and search runs once a day.
 */
export async function GET(req: NextRequest) {
  const denied = rejectUnlessCron(req);
  if (denied) return denied;

  const started = Date.now();
  const db = await getDb();
  const pruned = await pruneOldData(db, new Date());
  const searches: { userId: string; status: string; jobsFetched?: number; error?: string }[] = [];
  let deferred = 0;
  for (const userId of await digestRecipients(db)) {
    if (Date.now() - started > START_BUDGET_MS) {
      deferred++;
      continue;
    }
    try {
      const summary = await runJobSearch(userId, { trigger: "cron", db });
      searches.push({ userId, status: summary.status, jobsFetched: summary.jobsFetched });
    } catch (err) {
      console.error("Morning search failed", err);
      searches.push({ userId, status: "error", error: err instanceof Error ? err.message : String(err) });
    }
  }
  if (deferred) console.warn(`Morning search: ran out of time; skipped ${deferred} user(s)`);
  return NextResponse.json({ ok: true, pruned, searches, deferred, durationMs: Date.now() - started });
}
