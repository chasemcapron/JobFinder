import { render } from "@react-email/components";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lte } from "drizzle-orm";
import { createElement } from "react";
import { getDb, type Db } from "@/db";
import { applications, emailLog, jobMatches, jobs, profiles, users } from "@/db/schema";
import { MorningDigestEmail, type DigestFollowUp, type DigestJob } from "@/emails/morning-digest";
import { env } from "@/lib/env";
import { formatLocation } from "@/lib/jobs/location";
import { inTargetCountry } from "@/lib/jobs/results";
import { runJobSearch, type RunSummary } from "@/lib/jobs/search";
import { adzunaHomepage } from "@/lib/jobs/sources/adzuna";
import { APP_TIME_ZONE, localDate, localHour } from "@/lib/time";
import { sendEmail, type SendResult } from "./send";

export const DIGEST_HOUR = 7;
export const DIGEST_MAX_JOBS = 10;
/** Matches below this aren't worth an email. */
export const DIGEST_MIN_SCORE = 50;
/** An application still marked "applied" this many days later gets one follow-up reminder. */
export const FOLLOW_UP_AFTER_DAYS = 7;
/** Older applications are left alone, so the first email after this shipped didn't list months of them. */
const FOLLOW_UP_WITHIN_DAYS = 30;
const FOLLOW_UP_MAX = 5;
const DAY_MS = 86_400_000;

export type DigestOutcome =
  | {
      userId: string;
      status: "sent";
      jobs: number;
      followUps: number;
      channel: SendResult["channel"];
      search: RunSummary["status"] | "skipped";
    }
  | { userId: string; status: "skipped"; reason: string }
  | { userId: string; status: "error"; error: string };

/** Vercel Cron runs in UTC with no DST; both 12:00 and 13:00 UTC fire, and only the one that's 7 AM in Chicago sends. */
export function shouldSendNow(now: Date, lastDigestDate: string | null, force = false): { send: boolean; reason: string } {
  const today = localDate(now);
  if (lastDigestDate === today) return { send: false, reason: `Already sent today (${today})` };
  if (force) return { send: true, reason: "forced" };
  const hour = localHour(now);
  if (hour !== DIGEST_HOUR) return { send: false, reason: `It's ${hour}:00 in ${APP_TIME_ZONE}, not ${DIGEST_HOUR}:00` };
  return { send: true, reason: "7 AM in Chicago" };
}

/** Top matches that haven't been emailed or applied to yet. */
export async function pickDigestJobs(userId: string, db: Db, limit = DIGEST_MAX_JOBS) {
  const recent = new Date(Date.now() - 21 * 86_400_000);
  return db
    .select({ job: jobs, score: jobMatches.score, reasons: jobMatches.reasons })
    .from(jobMatches)
    .innerJoin(jobs, eq(jobs.id, jobMatches.jobId))
    .leftJoin(emailLog, and(eq(emailLog.jobId, jobs.id), eq(emailLog.userId, userId)))
    .leftJoin(applications, and(eq(applications.jobId, jobs.id), eq(applications.userId, userId)))
    .where(
      and(
        eq(jobMatches.userId, userId),
        gte(jobMatches.score, DIGEST_MIN_SCORE),
        gt(jobs.lastSeenAt, recent),
        inTargetCountry,
        isNull(emailLog.id),
        isNull(applications.id),
      ),
    )
    .orderBy(desc(jobMatches.score), desc(jobs.postedAt))
    .limit(limit);
}

/**
 * Applications to suggest following up on: still "applied" a week later (7-30 days ago), not
 * reminded before, oldest first.
 */
export async function pickFollowUps(userId: string, db: Db, now = new Date()) {
  return db
    .select({ id: applications.id, appliedAt: applications.appliedAt, title: jobs.title, company: jobs.company, applyUrl: jobs.applyUrl })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(
      and(
        eq(applications.userId, userId),
        eq(applications.status, "applied"),
        isNull(applications.followUpSentAt),
        lte(applications.appliedAt, new Date(now.getTime() - FOLLOW_UP_AFTER_DAYS * DAY_MS)),
        gt(applications.appliedAt, new Date(now.getTime() - FOLLOW_UP_WITHIN_DAYS * DAY_MS)),
      ),
    )
    .orderBy(asc(applications.appliedAt))
    .limit(FOLLOW_UP_MAX);
}

export function toDigestFollowUp(f: Awaited<ReturnType<typeof pickFollowUps>>[number], now: Date): DigestFollowUp {
  const days = Math.floor((now.getTime() - f.appliedAt.getTime()) / DAY_MS);
  const date = f.appliedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: APP_TIME_ZONE });
  return { title: f.title, company: f.company, applyUrl: f.applyUrl, appliedLabel: `Applied ${date} · ${days} days ago` };
}

export async function renderDigest(digestJobs: DigestJob[], now: Date, followUps: DigestFollowUp[] = []) {
  const dateLabel = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: APP_TIME_ZONE });
  const element = createElement(MorningDigestEmail, { jobs: digestJobs, followUps, dateLabel, appUrl: env.appUrl });
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  const n = followUps.length;
  const top = digestJobs[0];
  const first = followUps[0];
  const subject = top
    ? `${digestJobs.length} new job match${digestJobs.length === 1 ? "" : "es"}: ${top.title} at ${top.company}${digestJobs.length > 1 ? " + more" : ""}${n ? ` · ${n} to follow up` : ""}`
    : `Time to follow up on ${n} application${n === 1 ? "" : "s"}: ${first.title} at ${first.company}${n > 1 ? " + more" : ""}`;
  return { html, text, subject };
}

type DigestOptions = {
  db?: Db;
  now?: Date;
  /** Skip the 7 AM check (still only once per day). */
  force?: boolean;
  /** Set false to email from existing matches without searching first. */
  search?: boolean;
  runSearch?: typeof runJobSearch;
  send?: typeof sendEmail;
};

/** One user's morning run: search, pick new top matches, email them, record what was sent. */
export async function runDigestForUser(userId: string, opts: DigestOptions = {}): Promise<DigestOutcome> {
  const db = opts.db ?? (await getDb());
  const now = opts.now ?? new Date();
  try {
    const [row] = await db
      .select({ email: users.email, emailEnabled: profiles.emailEnabled, lastDigestDate: profiles.lastDigestDate })
      .from(profiles)
      .innerJoin(users, eq(users.id, profiles.userId))
      .where(eq(profiles.userId, userId));
    if (!row) return { userId, status: "skipped", reason: "No profile" };
    if (!row.emailEnabled) return { userId, status: "skipped", reason: "Email turned off" };
    if (!row.email) return { userId, status: "skipped", reason: "No email address on the account" };
    const gate = shouldSendNow(now, row.lastDigestDate, opts.force);
    if (!gate.send) return { userId, status: "skipped", reason: gate.reason };

    // Claim today before the slow part so an overlapping cron invocation can't double-send.
    const today = localDate(now);
    const claimed = await db
      .update(profiles)
      .set({ lastDigestDate: today })
      .where(and(eq(profiles.userId, userId), row.lastDigestDate ? eq(profiles.lastDigestDate, row.lastDigestDate) : isNull(profiles.lastDigestDate)))
      .returning({ userId: profiles.userId });
    if (claimed.length === 0) return { userId, status: "skipped", reason: "Another run is already sending today's digest" };

    let searchStatus: RunSummary["status"] | "skipped" = "skipped";
    if (opts.search !== false) {
      try {
        searchStatus = (await (opts.runSearch ?? runJobSearch)(userId, { trigger: "cron", db })).status;
      } catch (err) {
        // Still email whatever matches exist from earlier searches.
        console.error("Morning search failed", err);
        searchStatus = "error";
      }
    }

    const picked = await pickDigestJobs(userId, db);
    const followUps = await pickFollowUps(userId, db, now);
    if (picked.length === 0 && followUps.length === 0) return { userId, status: "skipped", reason: "No new matches to send" };

    const digestJobs: DigestJob[] = picked.map(({ job, score, reasons }) => ({
      title: job.title,
      company: job.company,
      location: formatLocation(job, job.locationRaw),
      score,
      reason: reasons,
      applyUrl: job.applyUrl,
      adzunaAttributionUrl: job.source === "adzuna" ? adzunaHomepage(job.country) : null,
    }));
    const message = await renderDigest(
      digestJobs,
      now,
      followUps.map((f) => toDigestFollowUp(f, now)),
    );
    let result: SendResult;
    try {
      result = await (opts.send ?? sendEmail)({ to: row.email, ...message });
    } catch (err) {
      // Release today's claim so the next scheduled invocation can try again.
      await db.update(profiles).set({ lastDigestDate: row.lastDigestDate }).where(eq(profiles.userId, userId));
      throw err;
    }
    if (picked.length) {
      await db
        .insert(emailLog)
        .values(picked.map(({ job }) => ({ userId, jobId: job.id, channel: result.channel, sentAt: now })))
        .onConflictDoNothing();
    }
    if (followUps.length) {
      await db.update(applications).set({ followUpSentAt: now }).where(inArray(applications.id, followUps.map((f) => f.id)));
    }
    return { userId, status: "sent", jobs: picked.length, followUps: followUps.length, channel: result.channel, search: searchStatus };
  } catch (err) {
    console.error("Digest failed", err);
    return { userId, status: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

/** Every user with the morning email turned on. */
export async function digestRecipients(db?: Db) {
  db ??= await getDb();
  const rows = await db.select({ userId: profiles.userId }).from(profiles).where(eq(profiles.emailEnabled, true));
  return rows.map((r) => r.userId);
}
