import { NextResponse, type NextRequest } from "next/server";
import { rejectUnlessCron } from "@/lib/cron";
import { digestRecipients, runDigestForUser, shouldSendNow, type DigestOutcome } from "@/lib/email/digest";

// Normally only renders and sends (the 5 AM search cron did the slow part); an inline search, when
// that one didn't happen, stops scoring at 35 s to leave room for the email.
export const maxDuration = 60;
/** Don't start another user's digest past this point, to stay inside maxDuration. */
const START_BUDGET_MS = 35_000;

/**
 * Scheduled at 12:00, 13:00 and 14:00 UTC (see vercel.json) because Vercel Cron is UTC-only and fires
 * anywhere within the hour: each user's digest goes out when it's 7 AM in America/Chicago, and 8 AM
 * retries a run that didn't finish. `?force=1` skips the hour check (still once per day) for manual testing.
 */
export async function GET(req: NextRequest) {
  const denied = rejectUnlessCron(req);
  if (denied) return denied;

  const started = Date.now();
  const force = req.nextUrl.searchParams.get("force") === "1";
  const now = new Date();

  // Cheap early exit for the invocation outside the send window.
  const gate = shouldSendNow(now, null, force);
  if (!gate.send) return NextResponse.json({ ok: true, skipped: gate.reason });

  const outcomes: DigestOutcome[] = [];
  const deferred: string[] = [];
  for (const userId of await digestRecipients()) {
    if (Date.now() - started > START_BUDGET_MS) {
      deferred.push(userId);
      continue;
    }
    outcomes.push(await runDigestForUser(userId, { now, force }));
  }
  if (deferred.length) console.warn(`Morning digest: ran out of time; skipped ${deferred.length} user(s)`);
  return NextResponse.json({ ok: true, outcomes, deferred: deferred.length, durationMs: Date.now() - started });
}
