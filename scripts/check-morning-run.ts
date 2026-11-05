// Read-only: why didn't this morning's email go out? Prints counts and times only (users are numbered,
// no emails or job titles). Changes nothing. Run from the project folder:
//   npx tsx --env-file=.env.local scripts/check-morning-run.ts
import { and, desc, eq, gt, gte, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { emailLog, jobMatches, jobs, profiles, searchRuns } from "@/db/schema";
import { DIGEST_MIN_SCORE, pickDigestJobs, shouldSendNow } from "@/lib/email/digest";
import { canScheduleEmail } from "@/lib/email/send";
import { localDate } from "@/lib/time";

const utc = (d: Date | null) => (d ? d.toISOString().slice(5, 16).replace("T", " ") + " UTC" : "never");

(async () => {
  const db = await getDb();
  const now = new Date();
  console.log(`Now: ${utc(now)} (Chicago date ${localDate(now)})\n`);
  const users = await db
    .select({ userId: profiles.userId, emailEnabled: profiles.emailEnabled, last: profiles.lastDigestDate, claimed: profiles.digestClaimedAt })
    .from(profiles)
    .orderBy(profiles.userId);
  let n = 0;
  for (const u of users) {
    n++;
    console.log(`User ${n}: email on=${u.emailEnabled}, last digest day=${u.last ?? "never"}, claim=${utc(u.claimed)}`);
    console.log(`  gate at 6 AM today: ${shouldSendNow(new Date(`${localDate(now)}T12:30:00Z`), u.last, false, canScheduleEmail()).reason}`);
    const runs = await db
      .select({ t: searchRuns.trigger, s: searchRuns.status, at: searchRuns.startedAt, end: searchRuns.finishedAt, err: searchRuns.error, fetched: searchRuns.jobsFetched, scored: searchRuns.matchesScored })
      .from(searchRuns)
      .where(and(eq(searchRuns.userId, u.userId), gt(searchRuns.startedAt, new Date(now.getTime() - 36 * 3_600_000))))
      .orderBy(desc(searchRuns.startedAt));
    for (const r of runs) console.log(`  search ${r.t} ${utc(r.at)} → ${r.s}${r.end ? "" : " (never finished)"}, fetched ${r.fetched}, scored ${r.scored}${r.err ? `, error: ${r.err.slice(0, 160)}` : ""}`);
    if (runs.length === 0) console.log("  no searches in the last 36 hours");
    const sent = await db
      .select({ at: emailLog.sentAt })
      .from(emailLog)
      .where(and(eq(emailLog.userId, u.userId), gt(emailLog.sentAt, new Date(now.getTime() - 4 * 86_400_000))))
      .orderBy(desc(emailLog.sentAt));
    const perDay = new Map<string, number>();
    for (const s of sent) perDay.set(localDate(s.at), (perDay.get(localDate(s.at)) ?? 0) + 1);
    console.log(`  jobs emailed by day: ${[...perDay].map(([d, c]) => `${d}: ${c}`).join(", ") || "none in 4 days"}`);
    const [pool] = await db
      .select({ c: jobMatches.id })
      .from(jobMatches)
      .innerJoin(jobs, eq(jobs.id, jobMatches.jobId))
      .where(and(eq(jobMatches.userId, u.userId), gte(jobMatches.score, DIGEST_MIN_SCORE), isNull(jobs.closedAt)))
      .then((r) => [r.length]);
    try {
      const picks = await pickDigestJobs(u.userId, db, 15, now);
      console.log(`  open matches scoring ${DIGEST_MIN_SCORE}+: ${pool}; roles the email would pick right now: ${picks.length}`);
    } catch (err) {
      console.log(`  open matches scoring ${DIGEST_MIN_SCORE}+: ${pool}; picking roles FAILED: ${err instanceof Error ? err.message : err}`);
    }
    console.log();
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
