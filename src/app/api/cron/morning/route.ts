import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { digestRecipients, runDigestForUser, shouldSendNow, type DigestOutcome } from "@/lib/email/digest";
import { env } from "@/lib/env";

// Searches fetch every source in parallel with 12s timeouts; leave headroom for scoring and email.
export const maxDuration = 60;
/** Don't start another user's digest past this point, to stay inside maxDuration. */
const START_BUDGET_MS = 35_000;

function authorized(req: NextRequest): boolean {
  const secret = env.cronSecret;
  if (!secret) return false;
  // Vercel Cron sends "Authorization: Bearer <CRON_SECRET>".
  const header = req.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Scheduled twice (12:00 and 13:00 UTC, see vercel.json) because Vercel Cron is UTC-only;
 * each user's digest only goes out when it's 7 AM in America/Chicago and not already sent today.
 * `?force=1` skips the hour check (still once per day) for manual testing.
 */
export async function GET(req: NextRequest) {
  if (!env.cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const started = Date.now();
  const force = req.nextUrl.searchParams.get("force") === "1";
  const now = new Date();

  // Cheap early exit for the invocation that isn't 7 AM local.
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
