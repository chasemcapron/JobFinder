import { eq, getTableName, is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { createPglite, schema, type Db } from "@/db";
import { confirmsEmail, deleteAccount } from "@/lib/account";
import { ensureProfile } from "@/lib/profile";

/** A sample of what a user owns, checked row by row; the test below checks every table's foreign key. */
async function seedUser(db: Db, email: string, jobId: string) {
  const [u] = await db.insert(schema.users).values({ email }).returning();
  await ensureProfile(u.id, db);
  await db.insert(schema.accounts).values({ userId: u.id, type: "oauth", provider: "google", providerAccountId: email });
  await db.insert(schema.jobMatches).values({ userId: u.id, jobId, score: 80, keywordScore: 80 });
  const [app] = await db.insert(schema.applications).values({ userId: u.id, jobId, notes: "Phone screen went well" }).returning();
  await db.insert(schema.dismissedRoles).values({ userId: u.id, roleKey: "x|y", company: "X", title: "Y", reason: "other" });
  await db.insert(schema.aiUsage).values({ userId: u.id, day: "2026-11-04", kind: "fit", count: 2 });
  await db.insert(schema.targetCompanies).values({ userId: u.id, ats: "greenhouse", slug: "acme" });
  await db.insert(schema.emailLog).values({ userId: u.id, jobId, channel: "console" });
  await db.insert(schema.searchRuns).values({ userId: u.id, trigger: "manual" });
  return { userId: u.id, applicationId: app.id };
}

const OWNED = [
  schema.profiles,
  schema.accounts,
  schema.jobMatches,
  schema.applications,
  schema.dismissedRoles,
  schema.aiUsage,
  schema.targetCompanies,
  schema.emailLog,
  schema.searchRuns,
] as const;

describe("delete my account", () => {
  it("removes everything the user owns and nothing anyone else does; shared postings stay", async () => {
    const db = await createPglite("memory://");
    const [job] = await db
      .insert(schema.jobs)
      .values({ source: "greenhouse", externalId: "1", dedupeKey: "k1", title: "Analyst", company: "Acme", applyUrl: "https://example.com/1" })
      .returning();
    const me = await seedUser(db, "me@example.com", job.id);
    const other = await seedUser(db, "other@example.com", job.id);

    expect(await deleteAccount(me.userId, db)).toBe(true);

    expect(await db.select().from(schema.users).where(eq(schema.users.id, me.userId))).toEqual([]);
    for (const table of OWNED) {
      const rows = (await db.select().from(table)) as { userId: string }[];
      expect(rows.some((r) => r.userId === me.userId), "a row was left behind").toBe(false);
      expect(rows.some((r) => r.userId === other.userId), "another user's row was removed").toBe(true);
    }
    expect(await db.select().from(schema.jobs)).toHaveLength(1);
    expect(await deleteAccount(me.userId, db)).toBe(false);
  });

  it("deletes along with the user in every table that has a user id, so nothing personal is left", () => {
    const tables = (Object.values(schema) as unknown[]).filter((t): t is PgTable => is(t, PgTable));
    const owned = tables.filter((t) => getTableConfig(t).columns.some((c) => c.name === "user_id" || c.name === "userId"));
    expect(owned.length).toBeGreaterThanOrEqual(15);
    for (const t of owned) {
      const toUsers = getTableConfig(t).foreignKeys.filter((fk) => getTableName(fk.reference().foreignTable) === "users");
      expect(toUsers.map((fk) => fk.onDelete), getTableName(t)).toEqual(["cascade"]);
    }
  });

  it("revokes the app's Google access first, and deletes even when Google can't be reached", async () => {
    const db = await createPglite("memory://");
    const [u] = await db.insert(schema.users).values({ email: "me@example.com" }).returning();
    await db.insert(schema.accounts).values({ userId: u.id, type: "oauth", provider: "google", providerAccountId: "g1", refresh_token: "rt-123" });
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
    expect(await deleteAccount(u.id, db, { fetchImpl })).toBe(true);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/revoke");
    expect(String(init.body)).toBe("token=rt-123");

    const [v] = await db.insert(schema.users).values({ email: "you@example.com" }).returning();
    await db.insert(schema.accounts).values({ userId: v.id, type: "oauth", provider: "google", providerAccountId: "g2", refresh_token: "rt-456" });
    const offline = vi.fn(async () => Promise.reject(new Error("network down"))) as unknown as typeof fetch;
    expect(await deleteAccount(v.id, db, { fetchImpl: offline })).toBe(true);
    expect(await db.select().from(schema.users)).toEqual([]);
  });

  it("needs the account's email typed exactly (case and spaces aside)", () => {
    expect(confirmsEmail("  Me@Example.com ", "me@example.com")).toBe(true);
    expect(confirmsEmail("me@example.co", "me@example.com")).toBe(false);
    expect(confirmsEmail("", null)).toBe(false);
    expect(confirmsEmail("", "   ")).toBe(false);
  });
});
