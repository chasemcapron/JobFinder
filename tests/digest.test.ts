import { eq, inArray } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPglite, schema, type Db } from "@/db";
import { GET as cronGET } from "@/app/api/cron/morning/route";
import { GET as searchCronGET } from "@/app/api/cron/search/route";
import { digestDeliveryTime, pickDigestJobs, renderDigest, runDigestForUser, shouldSendNow } from "@/lib/email/digest";
import { loadMorningRunStatus } from "@/lib/email/health";
import type { EmailMessage } from "@/lib/email/send";
import { ABANDONED_RUN_ERROR, closeAbandonedRuns } from "@/lib/jobs/search";
import { pruneOldData } from "@/lib/maintenance";
import { ensureProfile } from "@/lib/profile";

// 12:00 UTC on a summer day = 7 AM CDT; 13:00 UTC on a winter day = 7 AM CST.
const SUMMER_6AM = new Date("2026-07-01T11:00:00Z");
const SUMMER_7AM = new Date("2026-07-01T12:00:00Z");
const SUMMER_8AM = new Date("2026-07-01T13:00:00Z");
const SUMMER_9AM = new Date("2026-07-01T14:00:00Z");
const WINTER_5AM = new Date("2026-12-01T11:00:00Z");
const WINTER_6AM = new Date("2026-12-01T12:00:00Z");
const WINTER_7AM = new Date("2026-12-01T13:00:00Z");
const WINTER_8AM = new Date("2026-12-01T14:00:00Z");

describe("shouldSendNow", () => {
  it("builds at 6 AM Chicago time with 7 and 8 AM retries, across daylight saving", () => {
    expect(shouldSendNow(SUMMER_6AM, null)).toEqual({ send: true, reason: "6 AM in Chicago: scheduled for 7:00" });
    expect(shouldSendNow(SUMMER_7AM, null)).toEqual({ send: true, reason: "7 AM retry" });
    expect(shouldSendNow(SUMMER_8AM, null)).toEqual({ send: true, reason: "8 AM retry" });
    expect(shouldSendNow(SUMMER_9AM, null).send).toBe(false);
    // The 11:00 UTC cron is 5 AM in winter: too early.
    expect(shouldSendNow(WINTER_5AM, null).send).toBe(false);
    expect(shouldSendNow(WINTER_6AM, null).send).toBe(true);
    expect(shouldSendNow(WINTER_7AM, null).send).toBe(true);
    expect(shouldSendNow(WINTER_8AM, null).send).toBe(true);
    // Vercel Hobby crons can fire late within the hour
    expect(shouldSendNow(new Date("2026-07-01T11:59:00Z"), null).send).toBe(true);
  });

  it("delivers at 7:00 sharp when built before then, and right away after", () => {
    expect(digestDeliveryTime(new Date("2026-07-01T11:31:00Z"))).toEqual(new Date("2026-07-01T12:00:00Z"));
    expect(digestDeliveryTime(new Date("2026-12-01T12:31:00Z"))).toEqual(new Date("2026-12-01T13:00:00Z"));
    expect(digestDeliveryTime(SUMMER_7AM)).toBeNull();
    expect(digestDeliveryTime(new Date("2026-07-01T13:31:00Z"))).toBeNull();
  });

  it("never sends twice on the same Chicago day, even when forced", () => {
    expect(shouldSendNow(SUMMER_7AM, "2026-07-01")).toEqual({ send: false, reason: "Already sent today (2026-07-01)" });
    expect(shouldSendNow(SUMMER_7AM, "2026-06-30").send).toBe(true);
    expect(shouldSendNow(SUMMER_8AM, null, true).send).toBe(true);
    expect(shouldSendNow(SUMMER_8AM, "2026-07-01", true).send).toBe(false);
  });
});

let db: Db;
let userId: string;
const jobIds: string[] = [];

async function addJob(i: number, score: number, source: "greenhouse" | "adzuna" = "greenhouse") {
  const [job] = await db
    .insert(schema.jobs)
    .values({
      source,
      externalId: `j${i}`,
      dedupeKey: `k${i}`,
      title: `Engineer ${i}`,
      company: `Co ${i}`,
      city: "Chicago",
      state: "IL",
      country: "US",
      applyUrl: `https://example.com/${i}`,
    })
    .returning();
  await db.insert(schema.jobMatches).values({ userId, jobId: job.id, score, keywordScore: score, reasons: `Reason ${i}` });
  jobIds.push(job.id);
  return job.id;
}

beforeEach(async () => {
  jobIds.length = 0;
  db = await createPglite("memory://");
  const [u] = await db.insert(schema.users).values({ email: "me@example.com" }).returning();
  userId = u.id;
  await ensureProfile(userId, db);
  for (let i = 1; i <= 14; i++) await addJob(i, 98 - i * 2); // scores 96..70, all above the digest threshold
  await addJob(99, 20); // below the digest threshold
});

const noSearch = vi.fn(async () => ({ status: "ok" }) as never);

describe("runDigestForUser", () => {
  it("emails the top 10 new matches and logs them", async () => {
    const sent: EmailMessage[] = [];
    const outcome = await runDigestForUser(userId, {
      db,
      now: SUMMER_7AM,
      runSearch: noSearch,
      send: async (m) => (sent.push(m), { channel: "console", id: null }),
    });
    expect(outcome).toMatchObject({ status: "sent", jobs: 10, channel: "console", search: "ok" });
    expect(noSearch).toHaveBeenCalledWith(userId, expect.objectContaining({ trigger: "cron" }));
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("me@example.com");
    expect(sent[0].subject).toBe("10 new job matches: Engineer 1 at Co 1 + more");
    expect(sent[0].html).toContain("Engineer 1");
    expect(sent[0].html).toContain("96% match");
    expect(sent[0].html).toContain("Reason 1");
    expect(sent[0].html).toContain("https://example.com/1");
    expect(sent[0].text).toContain("Engineer 10");
    expect(sent[0].text).not.toContain("Engineer 11");
    expect(sent[0].idempotencyKey).toBe(`morning-digest/${userId}/2026-07-01`);
    const logged = await db.select().from(schema.emailLog).where(eq(schema.emailLog.userId, userId));
    expect(logged).toHaveLength(10);
    const profile = await db.query.profiles.findFirst({ where: eq(schema.profiles.userId, userId) });
    expect(profile).toMatchObject({ lastDigestDate: "2026-07-01", digestClaimedAt: null });
    // 7 AM is a retry: past 7:00, so it goes out right away.
    expect(sent[0].scheduledAt).toBeUndefined();
    expect(outcome).toMatchObject({ scheduledFor: null });
  });

  it("at 6 AM, schedules the email for 7:00 sharp and logs it as sent then, in both seasons", async () => {
    const sent: EmailMessage[] = [];
    const send = async (m: EmailMessage) => (sent.push(m), { channel: "resend" as const, id: "re_1" });
    const summer = await runDigestForUser(userId, { db, now: new Date("2026-07-01T11:31:00Z"), runSearch: noSearch, send });
    expect(summer).toMatchObject({ status: "sent", jobs: 10, scheduledFor: "2026-07-01T12:00:00.000Z" });
    expect(sent[0].scheduledAt).toEqual(new Date("2026-07-01T12:00:00Z"));
    const logged = await db.select().from(schema.emailLog).where(eq(schema.emailLog.userId, userId));
    expect(new Set(logged.map((l) => l.sentAt.toISOString()))).toEqual(new Set(["2026-07-01T12:00:00.000Z"]));

    const winter = await runDigestForUser(userId, { db, now: new Date("2026-12-01T12:31:00Z"), runSearch: noSearch, send });
    expect(winter).toMatchObject({ status: "sent", scheduledFor: "2026-12-01T13:00:00.000Z" });
    expect(sent[1].scheduledAt).toEqual(new Date("2026-12-01T13:00:00Z"));
  });

  it("retries a run that was cut off, at 8 AM, without searching again", async () => {
    // A 7 AM run claimed the day, then Vercel stopped the function before it finished.
    await db.update(schema.profiles).set({ digestClaimedAt: SUMMER_7AM }).where(eq(schema.profiles.userId, userId));
    const search = vi.fn(noSearch);
    const send = vi.fn(async () => ({ channel: "console" as const, id: null }));
    const outcome = await runDigestForUser(userId, { db, now: SUMMER_8AM, runSearch: search, send });
    expect(outcome).toMatchObject({ status: "sent", jobs: 10, search: "skipped" });
    expect(search).not.toHaveBeenCalled();
  });

  it("leaves a claim that's still in progress alone", async () => {
    await db.update(schema.profiles).set({ digestClaimedAt: SUMMER_7AM }).where(eq(schema.profiles.userId, userId));
    const oneMinuteLater = new Date(SUMMER_7AM.getTime() + 60_000);
    expect(await runDigestForUser(userId, { db, now: oneMinuteLater, runSearch: noSearch })).toEqual({
      userId,
      status: "skipped",
      reason: "Another run is already sending today's digest",
    });
  });

  it("emails from the early search when it ran, and searches itself when it didn't", async () => {
    const search = vi.fn(noSearch);
    const send = async () => ({ channel: "console" as const, id: null });
    await db.insert(schema.searchRuns).values({ userId, trigger: "cron", startedAt: new Date("2026-07-01T10:05:00Z"), status: "ok" });
    expect(await runDigestForUser(userId, { db, now: SUMMER_7AM, runSearch: search, send })).toMatchObject({ search: "skipped" });
    expect(search).not.toHaveBeenCalled();

    // The next morning's early search failed, so the email searches first.
    await db.insert(schema.searchRuns).values({ userId, trigger: "cron", startedAt: new Date("2026-07-02T10:05:00Z"), status: "error" });
    await runDigestForUser(userId, { db, now: new Date("2026-07-02T12:00:00Z"), runSearch: search, send });
    expect(search).toHaveBeenCalledWith(userId, expect.objectContaining({ trigger: "cron", deadline: expect.any(Number) }));
  });

  it("finishes a day with nothing to send, so the 8 AM run doesn't search again", async () => {
    await db.delete(schema.jobMatches);
    const search = vi.fn(noSearch);
    expect(await runDigestForUser(userId, { db, now: SUMMER_7AM, runSearch: search })).toMatchObject({ reason: "No new matches to send" });
    expect(await runDigestForUser(userId, { db, now: SUMMER_8AM, runSearch: search })).toMatchObject({ reason: "Already sent today (2026-07-01)" });
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("skips the second cron invocation and the same day, then sends only unsent jobs the next day", async () => {
    const send = vi.fn(async () => ({ channel: "console" as const, id: null }));
    await runDigestForUser(userId, { db, now: SUMMER_7AM, runSearch: noSearch, send });
    expect(await runDigestForUser(userId, { db, now: SUMMER_8AM, runSearch: noSearch, send })).toMatchObject({ status: "skipped" });
    expect(await runDigestForUser(userId, { db, now: SUMMER_7AM, runSearch: noSearch, send })).toMatchObject({
      status: "skipped",
      reason: "Already sent today (2026-07-01)",
    });
    const next = await runDigestForUser(userId, { db, now: new Date("2026-07-02T12:00:00Z"), runSearch: noSearch, send });
    // 14 matches above threshold, 10 already sent -> 4 left
    expect(next).toMatchObject({ status: "sent", jobs: 4 });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("excludes jobs already applied to", async () => {
    await db.insert(schema.applications).values({ userId, jobId: jobIds[0] });
    const picked = await pickDigestJobs(userId, db);
    expect(picked.map((p) => p.job.title)).not.toContain("Engineer 1");
    expect(picked[0].job.title).toBe("Engineer 2");
  });

  it("adds Adzuna attribution for Adzuna jobs", async () => {
    await db.delete(schema.jobMatches);
    await addJob(200, 90, "adzuna");
    const sent: EmailMessage[] = [];
    await runDigestForUser(userId, { db, now: SUMMER_7AM, runSearch: noSearch, send: async (m) => (sent.push(m), { channel: "console", id: null }) });
    expect(sent[0].html).toContain("Jobs by Adzuna");
    expect(sent[0].subject).toBe("1 new job match: Engineer 200 at Co 200");
  });

  it("respects the email setting and skips when nothing is new", async () => {
    await db.update(schema.profiles).set({ emailEnabled: false }).where(eq(schema.profiles.userId, userId));
    expect(await runDigestForUser(userId, { db, now: SUMMER_7AM, runSearch: noSearch })).toEqual({
      userId,
      status: "skipped",
      reason: "Email turned off",
    });
    await db.update(schema.profiles).set({ emailEnabled: true }).where(eq(schema.profiles.userId, userId));
    await db.delete(schema.jobMatches);
    expect(await runDigestForUser(userId, { db, now: SUMMER_7AM, runSearch: noSearch })).toMatchObject({
      status: "skipped",
      reason: "No new matches to send",
    });
  });

  it("still emails existing matches if the search fails, and releases the day if sending fails", async () => {
    const failingSearch = vi.fn(async () => {
      throw new Error("all sources down");
    });
    const failingSend = vi.fn(async () => {
      throw new Error("Resend: invalid from address");
    });
    const outcome = await runDigestForUser(userId, { db, now: SUMMER_7AM, runSearch: failingSearch, send: failingSend });
    expect(outcome).toMatchObject({ status: "error", error: "Resend: invalid from address" });
    expect(await db.select().from(schema.emailLog)).toHaveLength(0);
    // The day was released, so a later invocation can retry.
    const retry = await runDigestForUser(userId, {
      db,
      now: SUMMER_7AM,
      runSearch: failingSearch,
      send: async () => ({ channel: "resend", id: "abc" }),
    });
    expect(retry).toMatchObject({ status: "sent", search: "error", channel: "resend" });
  });
});

describe("follow-up reminders", () => {
  const daysBefore = (days: number) => new Date(SUMMER_7AM.getTime() - days * 86_400_000);
  const apply = (i: number, appliedDaysAgo: number, status: "applied" | "interviewing" = "applied") =>
    db.insert(schema.applications).values({ userId, jobId: jobIds[i], appliedAt: daysBefore(appliedDaysAgo), status });
  const collect = (sent: EmailMessage[]) => async (m: EmailMessage) => (sent.push(m), { channel: "console" as const, id: null });

  it("reminds once about applications still marked Applied 7-30 days later, oldest first", async () => {
    await apply(0, 8); // Engineer 1
    await apply(1, 20); // Engineer 2
    await apply(2, 3); // too recent
    await apply(3, 45); // too old to bring up
    await apply(4, 10, "interviewing"); // heard back
    const sent: EmailMessage[] = [];
    const outcome = await runDigestForUser(userId, { db, now: SUMMER_7AM, runSearch: noSearch, send: collect(sent) });
    expect(outcome).toMatchObject({ status: "sent", jobs: 9, followUps: 2 });
    expect(sent[0].subject).toBe("9 new job matches: Engineer 6 at Co 6 + more · 2 to follow up");
    expect(sent[0].html).toContain("Time to follow up");
    expect(sent[0].html).toContain("/applications");
    expect(sent[0].text).toMatch(/Engineer 2[\s\S]*Applied Jun 11 · 20 days ago[\s\S]*Engineer 1[\s\S]*Applied Jun 23 · 8 days ago/);
    expect(sent[0].text).not.toMatch(/Engineer 3\b|Engineer 4\b|Engineer 5\b/);

    // Next day: every match was sent and both reminders went out, so there's nothing to repeat.
    const next = await runDigestForUser(userId, { db, now: new Date("2026-07-02T12:00:00Z"), runSearch: noSearch, send: collect(sent) });
    expect(next).toMatchObject({ status: "skipped", reason: "No new matches to send" });
    expect(sent).toHaveLength(1);
  });

  it("sends a reminder-only email when there are no new matches", async () => {
    await db.delete(schema.jobMatches);
    await apply(0, 9);
    const sent: EmailMessage[] = [];
    const outcome = await runDigestForUser(userId, { db, now: SUMMER_7AM, runSearch: noSearch, send: collect(sent) });
    expect(outcome).toMatchObject({ status: "sent", jobs: 0, followUps: 1 });
    expect(sent[0].subject).toBe("Time to follow up on 1 application: Engineer 1 at Co 1");
    expect(await db.select().from(schema.emailLog)).toHaveLength(0);
    const [app] = await db.select().from(schema.applications);
    expect(app.followUpSentAt).toEqual(SUMMER_7AM);
  });

  it("keeps the reminder for next time when sending fails", async () => {
    await apply(0, 9);
    const failingSend = vi.fn(async () => {
      throw new Error("Resend down");
    });
    expect(await runDigestForUser(userId, { db, now: SUMMER_7AM, runSearch: noSearch, send: failingSend })).toMatchObject({ status: "error" });
    const [app] = await db.select().from(schema.applications);
    expect(app.followUpSentAt).toBeNull();
  });
});

describe("renderDigest", () => {
  it("renders title, company, location, score, reason, and apply link for each job", async () => {
    const { html, text, subject } = await renderDigest(
      [{ title: "Backend Engineer", company: "Acme", location: "Chicago, IL", score: 82, reason: "Strong TypeScript fit", applyUrl: "https://x.test/1", adzunaAttributionUrl: null }],
      SUMMER_7AM,
    );
    expect(subject).toBe("1 new job match: Backend Engineer at Acme");
    for (const s of ["Backend Engineer", "Acme", "Chicago, IL", "82% match", "Strong TypeScript fit", 'href="https://x.test/1"', "Wednesday, July 1"]) {
      expect(html).toContain(s);
    }
    expect(text).toContain("Backend Engineer");
  });
});

describe("cron route auth", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("refuses everything when CRON_SECRET isn't set", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await cronGET(new NextRequest("http://localhost/api/cron/morning"));
    expect(res.status).toBe(503);
  });

  it("rejects a missing or wrong bearer token", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    expect((await cronGET(new NextRequest("http://localhost/api/cron/morning"))).status).toBe(401);
    const wrong = new NextRequest("http://localhost/api/cron/morning", { headers: { authorization: "Bearer nope" } });
    expect((await cronGET(wrong)).status).toBe(401);
  });

  it("accepts the right token and exits early outside the 6-8 AM Chicago window", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    vi.useFakeTimers({ now: SUMMER_9AM, toFake: ["Date"] });
    try {
      const ok = new NextRequest("http://localhost/api/cron/morning", { headers: { authorization: "Bearer s3cret-value" } });
      const res = await cronGET(ok);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, skipped: "It's 9:00 in America/Chicago; the digest arrives at 7:00 (retries until 9:00)" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("guards the search cron the same way", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await searchCronGET(new NextRequest("http://localhost/api/cron/search"))).status).toBe(503);
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    const wrong = new NextRequest("http://localhost/api/cron/search", { headers: { authorization: "Bearer nope" } });
    expect((await searchCronGET(wrong)).status).toBe(401);
  });
});

describe("closeAbandonedRuns", () => {
  it("marks runs still 'running' after five minutes as stopped, and leaves a fresh one alone", async () => {
    const now = SUMMER_7AM;
    await db.insert(schema.searchRuns).values([
      { userId, trigger: "cron", startedAt: new Date(now.getTime() - 6 * 60_000) },
      { userId, trigger: "manual", startedAt: new Date(now.getTime() - 30_000) },
    ]);
    await closeAbandonedRuns(userId, db, now);
    const runs = await db.select().from(schema.searchRuns).orderBy(schema.searchRuns.startedAt);
    expect(runs.map((r) => r.status)).toEqual(["error", "running"]);
    expect(runs[0].error).toBe(ABANDONED_RUN_ERROR);
  });
});

describe("pruneOldData", () => {
  it("drops jobs unseen for 60 days unless someone applied, and search runs older than 90 days", async () => {
    const now = SUMMER_7AM;
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
    await db.update(schema.jobs).set({ lastSeenAt: daysAgo(61) }).where(inArray(schema.jobs.id, jobIds.slice(0, 3)));
    await db.insert(schema.applications).values({ userId, jobId: jobIds[0] });
    await db.insert(schema.searchRuns).values([
      { userId, trigger: "cron", startedAt: daysAgo(91), status: "ok" },
      { userId, trigger: "cron", startedAt: daysAgo(30), status: "ok" },
    ]);
    expect(await pruneOldData(db, now)).toEqual({ jobs: 2, searchRuns: 1 });
    const left = await db.select({ id: schema.jobs.id }).from(schema.jobs);
    expect(left.map((j) => j.id)).toContain(jobIds[0]); // applied to, so kept
    expect(left).toHaveLength(jobIds.length - 2);
    expect(await db.select().from(schema.applications)).toHaveLength(1);
  });
});

describe("loadMorningRunStatus", () => {
  it("reads today's cron search and the digest it sent", async () => {
    await db.insert(schema.searchRuns).values({ userId, trigger: "manual", startedAt: SUMMER_8AM, status: "ok", jobsFetched: 5 });
    await db.insert(schema.searchRuns).values({ userId, trigger: "cron", startedAt: SUMMER_7AM, status: "ok", jobsFetched: 1145 });
    await runDigestForUser(userId, { db, now: SUMMER_7AM, runSearch: noSearch, send: async () => ({ channel: "console", id: null }) });

    const status = await loadMorningRunStatus(userId, db, SUMMER_8AM);
    expect(status.state).toBe("ran");
    expect(status.note).toMatch(/searched 1,145 postings, emailed 10 matches/); // the manual search isn't counted
  });

  it("says when a digest built at 6 AM will arrive", async () => {
    await db.insert(schema.searchRuns).values({ userId, trigger: "cron", startedAt: new Date("2026-07-01T09:40:00Z"), status: "ok", jobsFetched: 900 });
    const built = new Date("2026-07-01T11:31:00Z");
    await runDigestForUser(userId, { db, now: built, runSearch: noSearch, send: async () => ({ channel: "resend", id: "re_1" }) });

    const before = await loadMorningRunStatus(userId, db, new Date("2026-07-01T11:45:00Z"));
    expect(before.note).toMatch(/searched 900 postings, emailing 10 matches at 7:00 AM\.$/);
    expect((await loadMorningRunStatus(userId, db, SUMMER_8AM)).note).toMatch(/emailed 10 matches\.$/);
  });

  it("flags a morning with no run", async () => {
    expect((await loadMorningRunStatus(userId, db, SUMMER_9AM)).state).toBe("missed");
  });
});
