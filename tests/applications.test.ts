import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPglite, schema, type Db } from "@/db";
import { markApplied, syncApplicationToSheet, updateApplicationStatus } from "@/lib/applications";
import { getGoogleAccessToken, GoogleNotConnectedError } from "@/lib/google/tokens";
import { ensureProfile } from "@/lib/profile";
import { localDate, localHour } from "@/lib/time";

let db: Db;
let userId: string;
let jobId: string;

beforeEach(async () => {
  db = await createPglite("memory://");
  const [u] = await db.insert(schema.users).values({ email: "t@example.com" }).returning();
  userId = u.id;
  await ensureProfile(userId, db);
  const [j] = await db
    .insert(schema.jobs)
    .values({
      source: "greenhouse",
      externalId: "acme:1",
      dedupeKey: "acme|engineer|chicago",
      title: "=Engineer",
      company: "Acme",
      city: "Chicago",
      state: "IL",
      country: "US",
      applyUrl: "https://example.com/1",
    })
    .returning();
  jobId = j.id;
});

afterEach(() => vi.unstubAllEnvs());

const okSheets = () =>
  vi.fn(async (url: string | URL | Request) =>
    String(url).includes("batchGet")
      ? new Response(JSON.stringify({ valueRanges: [{ values: [["Company", "x"]] }] }))
      : new Response(JSON.stringify({ updatedRange: "A3:F3" })),
  ) as unknown as typeof fetch;

describe("markApplied", () => {
  it("saves the application as not_configured when no sheet is set", async () => {
    const { applicationId, sync } = await markApplied(userId, jobId, { db });
    expect(sync.status).toBe("not_configured");
    const app = await db.query.applications.findFirst({ where: eq(schema.applications.id, applicationId) });
    expect(app).toMatchObject({ status: "applied", sheetSyncStatus: "not_configured" });
  });

  it("keeps the application when Sheets fails, and a retry then succeeds exactly once", async () => {
    await db.update(schema.profiles).set({ sheetId: "sheet-abc", sheetTab: "Apps" }).where(eq(schema.profiles.userId, userId));
    const failing = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Backend Error" } }), { status: 500 })) as unknown as typeof fetch;
    const first = await markApplied(userId, jobId, { db, getToken: async () => "tok", fetchImpl: failing });
    expect(first.sync).toEqual({ status: "failed", message: "Google Sheets error: Backend Error" });
    const saved = await db.query.applications.findFirst({ where: eq(schema.applications.id, first.applicationId) });
    expect(saved).toMatchObject({ sheetSyncStatus: "failed", sheetSyncError: "Google Sheets error: Backend Error" });

    const fetchOk = okSheets();
    const retry = await syncApplicationToSheet(userId, first.applicationId, { db, getToken: async () => "tok", fetchImpl: fetchOk });
    expect(retry.status).toBe("synced");
    const put = (fetchOk as unknown as ReturnType<typeof vi.fn>).mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(String(put[1].body));
    // default mapping A-F: company, title, date, link, location, status; title is escaped as text
    expect(body.values[0]).toEqual(["Acme", "'=Engineer", localDate(new Date()), "https://example.com/1", "Chicago, IL", "Applied"]);
    expect(decodeURIComponent(put[0])).toContain("'Apps'!A3:F3");

    // A second retry doesn't append a duplicate row.
    const again = await syncApplicationToSheet(userId, first.applicationId, { db, getToken: async () => "tok", fetchImpl: fetchOk });
    expect(again.status).toBe("synced");
    expect((fetchOk as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it("uses the saved column mapping", async () => {
    await db
      .update(schema.profiles)
      .set({ sheetId: "s", sheetColumnMap: { title: "A", company: "C", score: "D" } })
      .where(eq(schema.profiles.userId, userId));
    await db.insert(schema.jobMatches).values({ userId, jobId, score: 88, keywordScore: 70 });
    const fetchOk = okSheets();
    await markApplied(userId, jobId, { db, getToken: async () => "tok", fetchImpl: fetchOk });
    const put = (fetchOk as unknown as ReturnType<typeof vi.fn>).mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(put[1].body)).values[0]).toEqual(["'=Engineer", null, "Acme", 88]);
  });

  it("is idempotent and supports status changes", async () => {
    const a = await markApplied(userId, jobId, { db });
    const b = await markApplied(userId, jobId, { db });
    expect(a.applicationId).toBe(b.applicationId);
    await updateApplicationStatus(userId, a.applicationId, "interviewing", db);
    const app = await db.query.applications.findFirst({ where: eq(schema.applications.id, a.applicationId) });
    expect(app?.status).toBe("interviewing");
  });

  it("treats a missing Google connection as not configured, not a failure", async () => {
    await db.update(schema.profiles).set({ sheetId: "s" }).where(eq(schema.profiles.userId, userId));
    const { sync } = await markApplied(userId, jobId, {
      db,
      getToken: async () => {
        throw new GoogleNotConnectedError("Sign in with Google to enable Sheets sync.");
      },
    });
    expect(sync).toEqual({ status: "not_configured", message: "Sign in with Google to enable Sheets sync." });
  });
});

describe("getGoogleAccessToken", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_GOOGLE_ID", "client-id");
    vi.stubEnv("AUTH_GOOGLE_SECRET", "client-secret");
  });

  async function addAccount(overrides: Partial<typeof schema.accounts.$inferInsert> = {}) {
    await db.insert(schema.accounts).values({
      userId,
      type: "oidc",
      provider: "google",
      providerAccountId: "g-1",
      access_token: "old",
      refresh_token: "refresh-1",
      expires_at: Math.floor(Date.now() / 1000) - 10,
      scope: "openid email https://www.googleapis.com/auth/spreadsheets",
      ...overrides,
    });
  }

  it("returns a still-valid token without calling Google", async () => {
    await addAccount({ expires_at: Math.floor(Date.now() / 1000) + 3600 });
    const f = vi.fn() as unknown as typeof fetch;
    expect(await getGoogleAccessToken(userId, db, f)).toBe("old");
    expect(f).not.toHaveBeenCalled();
  });

  it("refreshes an expired token and stores it", async () => {
    await addAccount();
    const f = vi.fn(async () => new Response(JSON.stringify({ access_token: "new", expires_in: 3599 }))) as unknown as typeof fetch;
    expect(await getGoogleAccessToken(userId, db, f)).toBe("new");
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      client_id: "client-id",
      client_secret: "client-secret",
      grant_type: "refresh_token",
      refresh_token: "refresh-1",
    });
    const acct = await db.query.accounts.findFirst();
    expect(acct?.access_token).toBe("new");
    expect(acct?.refresh_token).toBe("refresh-1");
  });

  it("explains revoked access and missing scope", async () => {
    await addAccount();
    const revoked = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })) as unknown as typeof fetch;
    await expect(getGoogleAccessToken(userId, db, revoked)).rejects.toThrow(/revoked or expired/);
    await db.update(schema.accounts).set({ scope: "openid email" });
    await expect(getGoogleAccessToken(userId, db)).rejects.toBeInstanceOf(GoogleNotConnectedError);
  });

  it("reports when the user never connected Google", async () => {
    await expect(getGoogleAccessToken(userId, db)).rejects.toThrow("Sign in with Google to enable Sheets sync.");
  });
});

describe("time helpers", () => {
  it("uses America/Chicago with daylight saving", () => {
    // 12:00 UTC is 7 AM CDT in summer and 6 AM CST in winter
    expect(localHour(new Date("2026-07-01T12:00:00Z"))).toBe(7);
    expect(localHour(new Date("2026-12-01T12:00:00Z"))).toBe(6);
    expect(localHour(new Date("2026-12-01T13:00:00Z"))).toBe(7);
    // 03:00 UTC on the 2nd is still the 1st in Chicago
    expect(localDate(new Date("2026-12-02T03:00:00Z"))).toBe("2026-12-01");
  });
});
