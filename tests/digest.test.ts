import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPglite, schema, type Db } from "@/db";
import { GET as cronGET } from "@/app/api/cron/morning/route";
import { pickDigestJobs, renderDigest, runDigestForUser, shouldSendNow } from "@/lib/email/digest";
import type { EmailMessage } from "@/lib/email/send";
import { ensureProfile } from "@/lib/profile";

// 12:00 UTC on a summer day = 7 AM CDT; 13:00 UTC on a winter day = 7 AM CST.
const SUMMER_7AM = new Date("2026-07-01T12:00:00Z");
const SUMMER_8AM = new Date("2026-07-01T13:00:00Z");
const WINTER_6AM = new Date("2026-12-01T12:00:00Z");
const WINTER_7AM = new Date("2026-12-01T13:00:00Z");

describe("shouldSendNow", () => {
  it("sends only at 7 AM Chicago time, across daylight saving", () => {
    expect(shouldSendNow(SUMMER_7AM, null).send).toBe(true);
    expect(shouldSendNow(SUMMER_8AM, null).send).toBe(false);
    expect(shouldSendNow(WINTER_6AM, null).send).toBe(false);
    expect(shouldSendNow(WINTER_7AM, null).send).toBe(true);
    // Vercel Hobby crons can fire late within the hour
    expect(shouldSendNow(new Date("2026-07-01T12:59:00Z"), null).send).toBe(true);
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
  for (let i = 1; i <= 14; i++) await addJob(i, 100 - i * 4); // scores 96..44
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
    const logged = await db.select().from(schema.emailLog).where(eq(schema.emailLog.userId, userId));
    expect(logged).toHaveLength(10);
    const profile = await db.query.profiles.findFirst({ where: eq(schema.profiles.userId, userId) });
    expect(profile?.lastDigestDate).toBe("2026-07-01");
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

  it("accepts the right token and exits early outside 7 AM Chicago", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    vi.useFakeTimers({ now: SUMMER_8AM, toFake: ["Date"] });
    try {
      const ok = new NextRequest("http://localhost/api/cron/morning", { headers: { authorization: "Bearer s3cret-value" } });
      const res = await cronGET(ok);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, skipped: "It's 8:00 in America/Chicago, not 7:00" });
    } finally {
      vi.useRealTimers();
    }
  });
});
