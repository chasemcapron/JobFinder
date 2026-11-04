import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { aiProvider } from "@/lib/ai/provider";
import { rejectUnlessCron } from "@/lib/cron";
import { digestRecipients } from "@/lib/email/digest";
import { scoreBacklog } from "@/lib/jobs/search";

export const maxDuration = 60;
/** AI work must be done by this long after the start, inside maxDuration. */
const DEADLINE_MS = 50_000;
/** Don't start another user's backlog past this point. */
const START_BUDGET_MS = 10_000;

/**
 * Scheduled at 10:00 UTC, between the 09:00 search and the 11:00 email run. Hobby crons fire
 * somewhere within their hour, so a search started at 09:59 can still be running: scoreBacklog
 * then skips that user rather than evaluate the same roles twice. Has the AI
 * evaluate stored matches that lack a current evaluation, e.g. after a profile change, so the
 * morning email and the Jobs page rank on evaluations rather than keyword scores.
 */
export async function GET(req: NextRequest) {
  const denied = rejectUnlessCron(req);
  if (denied) return denied;
  if (!aiProvider()) return NextResponse.json({ ok: true, skipped: "No AI provider configured" });

  const started = Date.now();
  const db = await getDb();
  const results: { userId: string; aiScored?: number; errors?: string[]; error?: string }[] = [];
  let deferred = 0;
  // One user's backlog can take the whole run: start with a different user each day.
  const users = await digestRecipients(db);
  const shift = users.length ? Math.floor(started / 86_400_000) % users.length : 0;
  for (const userId of [...users.slice(shift), ...users.slice(0, shift)]) {
    if (Date.now() - started > START_BUDGET_MS) {
      deferred++;
      continue;
    }
    try {
      const r = await scoreBacklog(userId, { db, deadline: started + DEADLINE_MS });
      results.push({ userId, aiScored: r.aiScored, errors: r.errors });
    } catch (err) {
      console.error("Backlog scoring failed", err);
      results.push({ userId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return NextResponse.json({ ok: true, results, deferred, durationMs: Date.now() - started });
}
