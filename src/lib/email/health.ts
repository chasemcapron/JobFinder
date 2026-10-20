import { and, count, desc, eq } from "drizzle-orm";
import { getDb, type Db } from "@/db";
import { emailLog, profiles, searchRuns } from "@/db/schema";
import { formatDateTime } from "@/lib/format";
import { localDate, localHour } from "@/lib/time";
import { ABANDONED_RUN_ERROR, ABANDONED_RUN_MS } from "@/lib/jobs/search";
import { DIGEST_HOUR, DIGEST_RETRY_HOUR } from "./digest";

export type MorningRunState = "off" | "ran" | "scheduled" | "missed";

export type MorningRunInput = {
  now: Date;
  emailEnabled: boolean;
  /** Chicago date the digest was last claimed (sent, or nothing new to send). */
  lastDigestDate: string | null;
  /** Latest search started by the cron route. */
  lastRun: { startedAt: Date; status: string; jobsFetched: number; error: string | null } | null;
  /** Latest digest that went out, and how many jobs it carried. */
  lastEmail: { sentAt: Date; jobs: number } | null;
};

/**
 * Whether this morning's cron run happened. The cron routes can't record anything when Vercel never
 * calls them or the call is rejected (no CRON_SECRET, or a wrong one), so a missing run is the signal.
 * The search runs early, the email at 7 AM (Vercel fires somewhere within that hour), and 8 AM retries
 * a run that didn't finish, so by 9 AM Chicago an unfinished day is a missed one.
 */
export function morningRunStatus({ now, emailEnabled, lastDigestDate, lastRun: run, lastEmail }: MorningRunInput): {
  state: MorningRunState;
  note: string;
} {
  const today = localDate(now);
  // A run "running" past the function limit was cut off; the next search marks it, but say so now.
  const lastRun =
    run?.status === "running" && now.getTime() - run.startedAt.getTime() > ABANDONED_RUN_MS
      ? { ...run, status: "error", error: ABANDONED_RUN_ERROR }
      : run;
  const lastRunText = lastRun ? `last automatic run ${formatDateTime(lastRun.startedAt)}` : "no automatic run yet";
  if (!emailEnabled) return { state: "off", note: `Turned off, so there's no morning search either (${lastRunText}).` };
  const ranToday = lastRun !== null && localDate(lastRun.startedAt) === today;

  if (lastDigestDate !== today && ranToday && lastRun.status === "running") {
    return { state: "scheduled", note: `Searching now (started ${formatDateTime(lastRun.startedAt)}).` };
  }
  if (lastDigestDate === today) {
    const parts: string[] = [];
    if (ranToday) {
      const searched = `searched ${lastRun.jobsFetched.toLocaleString()} postings`;
      parts.push(
        lastRun.status === "ok" ? `Ran ${formatDateTime(lastRun.startedAt)}: ${searched}` : `Ran ${formatDateTime(lastRun.startedAt)} with errors: ${searched}`,
      );
    } else {
      parts.push("Today's digest is done");
    }
    parts.push(
      lastEmail && localDate(lastEmail.sentAt) === today
        ? `emailed ${lastEmail.jobs} match${lastEmail.jobs === 1 ? "" : "es"}`
        : "no new matches to email",
    );
    return { state: "ran", note: `${parts.join(", ")}.` };
  }

  const hour = localHour(now);
  if (hour <= DIGEST_HOUR) return { state: "scheduled", note: `Searches early, emails at 7 AM Central (${lastRunText}).` };
  if (hour === DIGEST_RETRY_HOUR) return { state: "scheduled", note: `Not sent yet; retries before 9 AM Central (${lastRunText}).` };
  if (ranToday && lastRun.error) return { state: "missed", note: `This morning's run failed: ${lastRun.error} (${lastRunText}).` };
  return { state: "missed", note: `This morning's run didn't happen (${lastRunText}).` };
}

/** Loads what morningRunStatus needs for one user. */
export async function loadMorningRunStatus(userId: string, db?: Db, now = new Date()) {
  db ??= await getDb();
  const [profile, lastRun, [lastEmail]] = await Promise.all([
    db.query.profiles.findFirst({ where: eq(profiles.userId, userId), columns: { emailEnabled: true, lastDigestDate: true } }),
    db.query.searchRuns.findFirst({
      where: and(eq(searchRuns.userId, userId), eq(searchRuns.trigger, "cron")),
      orderBy: desc(searchRuns.startedAt),
      columns: { startedAt: true, status: true, jobsFetched: true, error: true },
    }),
    // Every job in one digest is logged with the same sentAt.
    db
      .select({ sentAt: emailLog.sentAt, jobs: count() })
      .from(emailLog)
      .where(eq(emailLog.userId, userId))
      .groupBy(emailLog.sentAt)
      .orderBy(desc(emailLog.sentAt))
      .limit(1),
  ]);
  return morningRunStatus({
    now,
    emailEnabled: profile?.emailEnabled ?? false,
    lastDigestDate: profile?.lastDigestDate ?? null,
    lastRun: lastRun ?? null,
    lastEmail: lastEmail ?? null,
  });
}
