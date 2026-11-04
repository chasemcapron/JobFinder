import { render } from "@react-email/components";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, ne, not, or } from "drizzle-orm";
import { createElement } from "react";
import { getDb, type Db } from "@/db";
import { applications, emailLog, jobMatches, jobs, profiles, searchRuns, users } from "@/db/schema";
import { MorningDigestEmail, type DigestFollowUp, type DigestJob } from "@/emails/morning-digest";
import { FOLLOW_UP_AFTER_DAYS } from "@/lib/applications";
import { env } from "@/lib/env";
import { checkLiveness } from "@/lib/jobs/liveness";
import { formatLocation } from "@/lib/jobs/location";
import { hiddenState, isHiddenSql, loadHidden } from "@/lib/jobs/dismissals";
import { groupByRole } from "@/lib/jobs/filters";
import { roleKey } from "@/lib/jobs/normalize";
import { inTargetCountry } from "@/lib/jobs/results";
import { runJobSearch, type RunSummary } from "@/lib/jobs/search";
import { adzunaHomepage } from "@/lib/jobs/sources/adzuna";
import { APP_TIME_ZONE, atLocalHour, localDate, localHour } from "@/lib/time";
import { sendEmail, type SendResult } from "./send";

/** The digest arrives at 7:00 AM Chicago time. */
export const DIGEST_HOUR = 7;
/**
 * Vercel Hobby fires a cron anywhere within its hour (it was landing at 7:31), so the digest is built
 * the hour before and handed to Resend to deliver at 7:00 sharp.
 */
export const DIGEST_PREPARE_HOUR = DIGEST_HOUR - 1;
/** 7 and 8 AM retry a 6 AM run that failed or was cut off, sending right away. */
export const DIGEST_RETRY_HOUR = DIGEST_HOUR + 1;
export const DIGEST_MAX_JOBS = 10;
/** Extra candidates picked, so postings found closed can be replaced. */
const LIVENESS_SPARES = 5;
/** Postings read to find the top roles: a defense contractor can post one role in 20+ cities. */
const CANDIDATE_POSTINGS = 400;
/** Postings not seen in this long aren't emailed. */
const RECENT_DAYS = 21;
/** A role emailed this recently (in any city) isn't emailed again: as long as jobs are kept (pruneOldData). */
const EMAILED_ROLE_DAYS = 60;
/** After each role's best posting, this many of its other copies are checked too, to stand in if it closed. */
const LIVENESS_COPIES = 2;
/** Time for checking that the picked Workday postings are still open, when the run has it to spare. */
const LIVENESS_BUDGET_MS = 8_000;
/** The liveness check never runs past this long after the user's run started (Vercel stops at 60 s). */
const LIVENESS_DEADLINE_MS = 48_000;
/** A claim older than this belongs to a run that died: Vercel stops a function after 60 s. */
export const DIGEST_LEASE_MS = 5 * 60_000;
/** A search this recent (normally the early search cron) counts as this morning's; the email doesn't search again. */
export const FRESH_SEARCH_MS = 6 * 3_600_000;
/** An inline search (the early one didn't happen) stops scoring by then, leaving room to render and send. */
const INLINE_SEARCH_BUDGET_MS = 35_000;
/** Matches below this aren't worth an email. */
export const DIGEST_MIN_SCORE = 50;
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
      /** When Resend delivers it; null when it went out right away. */
      scheduledFor: string | null;
    }
  | { userId: string; status: "skipped"; reason: string }
  | { userId: string; status: "error"; error: string };

/**
 * Vercel Cron runs in UTC with no DST; 11:00 to 14:00 UTC all fire. The one that's 6 AM in Chicago
 * schedules the digest for 7:00, and the ones that are 7 and 8 AM retry if that run didn't finish.
 */
export function shouldSendNow(now: Date, lastDigestDate: string | null, force = false): { send: boolean; reason: string } {
  const today = localDate(now);
  if (lastDigestDate === today) return { send: false, reason: `Already sent today (${today})` };
  if (force) return { send: true, reason: "forced" };
  const hour = localHour(now);
  if (hour === DIGEST_PREPARE_HOUR) return { send: true, reason: "6 AM in Chicago: scheduled for 7:00" };
  if (hour === DIGEST_HOUR) return { send: true, reason: "7 AM retry" };
  if (hour === DIGEST_RETRY_HOUR) return { send: true, reason: "8 AM retry" };
  return { send: false, reason: `It's ${hour}:00 in ${APP_TIME_ZONE}; the digest arrives at ${DIGEST_HOUR}:00 (retries until ${DIGEST_RETRY_HOUR + 1}:00)` };
}

/** Today's 7:00 AM Chicago while that's still ahead, so Resend holds the email until then; null once it's past (send now). */
export function digestDeliveryTime(now: Date): Date | null {
  const at = atLocalHour(localDate(now), DIGEST_HOUR);
  return at > now ? at : null;
}

/** True when a search finished recently enough to email from (normally the early search cron). */
async function searchedRecently(userId: string, db: Db, now: Date): Promise<boolean> {
  const since = new Date(now.getTime() - FRESH_SEARCH_MS);
  const recent = await db.query.searchRuns.findFirst({
    where: and(eq(searchRuns.userId, userId), gt(searchRuns.startedAt, since), inArray(searchRuns.status, ["ok", "partial"])),
    columns: { id: true },
  });
  return Boolean(recent);
}

type DigestPosting = { job: typeof jobs.$inferSelect; score: number; reasons: string };
/** One role (company + title) in the email: its best-ranked posting, and the same role elsewhere. */
export type DigestRole = DigestPosting & { others: DigestPosting[] };

/**
 * The top roles that haven't been emailed or applied to yet, one per company and title: employers
 * like defense contractors post one role once per city, and each copy used to take its own slot.
 * A role emailed in the last 60 days in any city, or applied to in any city, is left out, and so
 * is anything marked "Not interested" (the role, or its whole company).
 */
export async function pickDigestJobs(userId: string, db: Db, limit = DIGEST_MAX_JOBS, now = new Date()): Promise<DigestRole[]> {
  const recent = new Date(now.getTime() - RECENT_DAYS * DAY_MS);
  const emailedSince = new Date(now.getTime() - EMAILED_ROLE_DAYS * DAY_MS);
  // Light rows first (no descriptions), grouped by role; full rows only for the roles picked.
  const rows = await db
    .select({ job: { id: jobs.id, company: jobs.company, title: jobs.title } })
    .from(jobMatches)
    .innerJoin(jobs, eq(jobs.id, jobMatches.jobId))
    .leftJoin(emailLog, and(eq(emailLog.jobId, jobs.id), eq(emailLog.userId, userId)))
    .leftJoin(applications, and(eq(applications.jobId, jobs.id), eq(applications.userId, userId)))
    .where(
      and(
        eq(jobMatches.userId, userId),
        gte(jobMatches.score, DIGEST_MIN_SCORE),
        // Never email a job marked "do not apply" (by the AI or a fixed rule), or one known to be closed.
        or(isNull(jobMatches.verdict), ne(jobMatches.verdict, "skip")),
        isNull(jobs.closedAt),
        gt(jobs.lastSeenAt, recent),
        inTargetCountry,
        isNull(emailLog.id),
        isNull(applications.id),
        not(isHiddenSql(userId)),
      ),
    )
    .orderBy(desc(jobMatches.score), desc(jobs.postedAt), asc(jobs.id))
    .limit(CANDIDATE_POSTINGS);
  if (rows.length === 0) return [];

  const [emailed, applied, hidden] = await Promise.all([
    db
      .select({ company: jobs.company, title: jobs.title })
      .from(emailLog)
      .innerJoin(jobs, eq(jobs.id, emailLog.jobId))
      .where(and(eq(emailLog.userId, userId), gt(emailLog.sentAt, emailedSince))),
    db.select({ company: jobs.company, title: jobs.title }).from(applications).innerJoin(jobs, eq(jobs.id, applications.jobId)).where(eq(applications.userId, userId)),
    loadHidden(userId, db),
  ]);
  const done = new Set([...emailed, ...applied].map(roleKey));
  const groups = groupByRole(rows)
    .filter((role) => !done.has(roleKey(role.job)) && !hiddenState(role.job, hidden))
    .slice(0, limit)
    .map((role) => [role, ...role.others].map((r) => r.job.id));
  if (groups.length === 0) return [];

  const full = await db
    .select({ job: jobs, score: jobMatches.score, reasons: jobMatches.reasons })
    .from(jobMatches)
    .innerJoin(jobs, eq(jobs.id, jobMatches.jobId))
    .where(and(eq(jobMatches.userId, userId), inArray(jobs.id, groups.flat())));
  const byId = new Map(full.map((f) => [f.job.id, f]));
  return groups.flatMap((group) => {
    const [lead, ...others] = group.map((id) => byId.get(id)).filter((p): p is DigestPosting => Boolean(p));
    return lead ? [{ ...lead, others }] : [];
  });
}

/**
 * Drops postings known to be closed: a role whose best posting closed is led by its next copy, and
 * one with every copy closed is left out.
 */
export function withoutClosed(roles: DigestRole[], isClosed: (id: string) => boolean): DigestRole[] {
  return roles.flatMap((role) => {
    const [lead, ...others] = [role, ...role.others].filter((p) => !isClosed(p.job.id));
    return lead ? [{ job: lead.job, score: lead.score, reasons: lead.reasons, others }] : [];
  });
}

/** Distinct places the role is also posted, besides the one shown. */
function alsoIn(role: DigestRole): string[] {
  const shown = formatLocation(role.job, role.job.locationRaw);
  const places = role.others.map((o) => formatLocation(o.job, o.job.locationRaw)).filter((p) => p && p !== shown);
  return [...new Set(places)];
}

export function toDigestJob(role: DigestRole): DigestJob {
  const { job } = role;
  return {
    title: job.title,
    company: job.company,
    location: formatLocation(job, job.locationRaw),
    alsoIn: alsoIn(role),
    score: role.score,
    reason: role.reasons,
    applyUrl: job.applyUrl,
    adzunaAttributionUrl: job.source === "adzuna" ? adzunaHomepage(job.country) : null,
  };
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
  /** Skip the hour check (still only once per day). */
  force?: boolean;
  /** Set false to email from existing matches without searching first. Otherwise it searches unless one ran recently. */
  search?: boolean;
  runSearch?: typeof runJobSearch;
  send?: typeof sendEmail;
  /** For tests: replaces the check that picked postings are still open. */
  checkLive?: typeof checkLiveness;
};

/**
 * One user's morning run: claim today, search unless the early search already ran, pick new top
 * matches and due follow-ups, email them, record what was sent, then mark today done.
 *
 * The claim is a lease: a run Vercel cuts off at 60 s leaves `digestClaimedAt` set without
 * finishing the day, and once that's older than DIGEST_LEASE_MS the 7 or 8 AM retry takes over. The
 * retry skips the search (the likely thing that ran out of time) and sends what's already matched.
 */
export async function runDigestForUser(userId: string, opts: DigestOptions = {}): Promise<DigestOutcome> {
  const runStarted = Date.now();
  const db = opts.db ?? (await getDb());
  const now = opts.now ?? new Date();
  try {
    const [row] = await db
      .select({
        email: users.email,
        emailEnabled: profiles.emailEnabled,
        lastDigestDate: profiles.lastDigestDate,
        digestClaimedAt: profiles.digestClaimedAt,
      })
      .from(profiles)
      .innerJoin(users, eq(users.id, profiles.userId))
      .where(eq(profiles.userId, userId));
    if (!row) return { userId, status: "skipped", reason: "No profile" };
    if (!row.emailEnabled) return { userId, status: "skipped", reason: "Email turned off" };
    if (!row.email) return { userId, status: "skipped", reason: "No email address on the account" };
    const gate = shouldSendNow(now, row.lastDigestDate, opts.force);
    if (!gate.send) return { userId, status: "skipped", reason: gate.reason };

    // Claim today so an overlapping cron invocation can't double-send; a claim past its lease is free to take.
    const today = localDate(now);
    const claimed = await db
      .update(profiles)
      .set({ digestClaimedAt: now })
      .where(
        and(
          eq(profiles.userId, userId),
          or(isNull(profiles.digestClaimedAt), lt(profiles.digestClaimedAt, new Date(now.getTime() - DIGEST_LEASE_MS))),
          row.lastDigestDate ? eq(profiles.lastDigestDate, row.lastDigestDate) : isNull(profiles.lastDigestDate),
        ),
      )
      .returning({ userId: profiles.userId });
    if (claimed.length === 0) return { userId, status: "skipped", reason: "Another run is already sending today's digest" };
    const earlierRunDied = row.digestClaimedAt !== null && localDate(row.digestClaimedAt) === today;
    const finishDay = () => db.update(profiles).set({ lastDigestDate: today, digestClaimedAt: null }).where(eq(profiles.userId, userId));

    let searchStatus: RunSummary["status"] | "skipped" = "skipped";
    if (opts.search !== false && !earlierRunDied && !(await searchedRecently(userId, db, now))) {
      try {
        const deadline = Date.now() + INLINE_SEARCH_BUDGET_MS;
        searchStatus = (await (opts.runSearch ?? runJobSearch)(userId, { trigger: "cron", db, deadline })).status;
      } catch (err) {
        // Still email whatever matches exist from earlier searches.
        console.error("Morning search failed", err);
        searchStatus = "error";
      }
    }

    // Confirm Workday postings are still open before emailing them (a few spares cover the closed ones).
    const candidates = await pickDigestJobs(userId, db, DIGEST_MAX_JOBS + LIVENESS_SPARES, now);
    const livenessBudget = Math.min(LIVENESS_BUDGET_MS, runStarted + LIVENESS_DEADLINE_MS - Date.now());
    const liveness =
      livenessBudget >= 1_000
        ? await (opts.checkLive ?? checkLiveness)(
            // Each role's best posting first, then the copies that would stand in for it.
            [...candidates.map((c) => c.job), ...candidates.flatMap((c) => c.others.slice(0, LIVENESS_COPIES).map((o) => o.job))],
            { budgetMs: livenessBudget },
          )
        : new Map<string, never>();
    const closedIds = [...liveness].filter(([, s]) => s === "closed").map(([id]) => id);
    if (closedIds.length) await db.update(jobs).set({ closedAt: now }).where(inArray(jobs.id, closedIds));
    const picked = withoutClosed(candidates, (id) => liveness.get(id) === "closed").slice(0, DIGEST_MAX_JOBS);
    const followUps = await pickFollowUps(userId, db, now);
    if (picked.length === 0 && followUps.length === 0) {
      await finishDay();
      return { userId, status: "skipped", reason: "No new matches to send" };
    }

    const message = await renderDigest(
      picked.map(toDigestJob),
      now,
      followUps.map((f) => toDigestFollowUp(f, now)),
    );
    const deliverAt = digestDeliveryTime(now);
    let result: SendResult;
    try {
      // Same key all day: if a run is cut off after Resend accepted the email, the retry can't send it twice.
      result = await (opts.send ?? sendEmail)({
        to: row.email,
        ...message,
        idempotencyKey: `morning-digest/${userId}/${today}`,
        ...(deliverAt ? { scheduledAt: deliverAt } : {}),
      });
    } catch (err) {
      // Release the claim so the next invocation (7 or 8 AM) can try again.
      await db.update(profiles).set({ digestClaimedAt: null }).where(eq(profiles.userId, userId));
      throw err;
    }
    await finishDay();
    // Logged as sent when it arrives, which is what Settings reports.
    const sentAt = deliverAt ?? now;
    if (picked.length) {
      // Every copy of an emailed role is logged, so none comes back in a later email.
      const sentJobIds = picked.flatMap((role) => [role.job.id, ...role.others.map((o) => o.job.id)]);
      await db
        .insert(emailLog)
        .values(sentJobIds.map((jobId) => ({ userId, jobId, channel: result.channel, sentAt })))
        .onConflictDoNothing();
    }
    if (followUps.length) {
      await db.update(applications).set({ followUpSentAt: sentAt }).where(inArray(applications.id, followUps.map((f) => f.id)));
    }
    return {
      userId,
      status: "sent",
      jobs: picked.length,
      followUps: followUps.length,
      channel: result.channel,
      search: searchStatus,
      scheduledFor: deliverAt?.toISOString() ?? null,
    };
  } catch (err) {
    console.error("Digest failed", err);
    return { userId, status: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

/** Every user with the morning email turned on, in a fixed order (the crons rotate through it). */
export async function digestRecipients(db?: Db) {
  db ??= await getDb();
  const rows = await db
    .select({ userId: profiles.userId })
    .from(profiles)
    .where(eq(profiles.emailEnabled, true))
    .orderBy(asc(profiles.userId));
  return rows.map((r) => r.userId);
}
