import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPglite, schema, type Db } from "@/db";
import { AiUnavailableError } from "@/lib/ai/gemini";
import { AiLimitError, assertAllowance, DAILY_LIMITS, isUnlimited, takeAllowance, usageToday, withAllowance, withAllowanceOr } from "@/lib/ai/limits";
import { pruneOldData } from "@/lib/maintenance";

let db: Db;
let owner: string;
let friend: string;
// 15:00 UTC is 10 AM in Chicago; the next Chicago day starts at 05:00 UTC on the 2nd.
const DAY1 = new Date("2026-07-01T15:00:00Z");
const DAY1_LATE = new Date("2026-07-02T04:30:00Z"); // 11:30 PM in Chicago, still July 1
const DAY2 = new Date("2026-07-02T05:30:00Z");

beforeEach(async () => {
  vi.stubEnv("ALLOWED_EMAILS", "Owner@Example.com, friend@example.com");
  db = await createPglite("memory://");
  [{ id: owner }] = await db.insert(schema.users).values({ email: "owner@example.com" }).returning();
  [{ id: friend }] = await db.insert(schema.users).values({ email: "friend@example.com" }).returning();
});
afterEach(() => vi.unstubAllEnvs());

describe("daily AI limits", () => {
  it("stops an invited user at the limit, for that Chicago day only", async () => {
    for (let i = 0; i < DAILY_LIMITS.tailor; i++) await takeAllowance({ userId: friend }, "tailor", db, DAY1);
    await expect(takeAllowance({ userId: friend }, "tailor", db, DAY1_LATE)).rejects.toThrow(AiLimitError);
    await expect(takeAllowance({ userId: friend }, "tailor", db, DAY1)).rejects.toThrow("You've used today's 10 tailored resumes. It resets at midnight Central.");
    // Other kinds have their own count, and the next day starts over.
    await takeAllowance({ userId: friend }, "fit", db, DAY1);
    await takeAllowance({ userId: friend }, "tailor", db, DAY2);
  });

  it("can't be slipped past by many requests at once", async () => {
    const results = await Promise.allSettled(Array.from({ length: 15 }, () => takeAllowance({ userId: friend }, "refresh", db, DAY1)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(DAILY_LIMITS.refresh);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(15 - DAILY_LIMITS.refresh);
  });

  it("never limits the owner (the first allowed email), or anyone when there's no allowlist", async () => {
    for (let i = 0; i < 30; i++) await takeAllowance({ userId: owner }, "tailor", db, DAY1);
    expect(await db.select().from(schema.aiUsage)).toEqual([]);
    expect(await usageToday({ userId: owner }, db, DAY1)).toBeNull();
    expect(isUnlimited("OWNER@example.com")).toBe(true);
    expect(isUnlimited("friend@example.com")).toBe(false);
    vi.stubEnv("ALLOWED_EMAILS", "");
    expect(isUnlimited("friend@example.com")).toBe(true);
  });

  it("gives a use back when the AI itself failed, not when its answer was rejected afterwards", async () => {
    const busy = new AiUnavailableError("Gemini is busy", [{ model: "gemini-3.8-flash", status: 503, message: "busy" }]);
    await expect(withAllowance({ userId: friend }, "fit", db, async () => Promise.reject(busy))).rejects.toThrow(AiUnavailableError);
    expect(await withAllowance({ userId: friend }, "fit", db, async () => "ok")).toBe("ok");
    // The AI answered, then the fact check threw it out: the call still counts.
    await expect(withAllowance({ userId: friend }, "fit", db, async () => Promise.reject(new Error("none was kept")))).rejects.toThrow("none was kept");
    const usage = await usageToday({ userId: friend }, db);
    expect(usage?.find((u) => u.kind === "fit")).toEqual({ kind: "fit", used: 2, limit: DAILY_LIMITS.fit });
  });

  it("falls back to the work without AI once the limit is reached", async () => {
    for (let i = 0; i < DAILY_LIMITS.refresh; i++) await takeAllowance({ userId: friend }, "refresh", db);
    const r = await withAllowanceOr({ userId: friend }, "refresh", db, async () => "ai", async (notice) => `keywords: ${notice}`);
    expect(r).toBe("keywords: You've used today's 6 AI-scored refreshes. It resets at midnight Central.");
  });

  it("drops usage rows older than a week", async () => {
    await takeAllowance({ userId: friend }, "fit", db, new Date("2026-06-01T15:00:00Z"));
    await takeAllowance({ userId: friend }, "fit", db, DAY1);
    await pruneOldData(db, DAY1);
    expect((await db.select().from(schema.aiUsage)).map((r) => r.day)).toEqual(["2026-07-01"]);
  });

  it("gives a use back when the AI didn't do the work, and can check the limit without counting", async () => {
    // A company suggestion that found no readable boards.
    expect(await withAllowance({ userId: friend }, "suggest", db, async () => [] as string[], (found) => found.length > 0)).toEqual([]);
    expect((await usageToday({ userId: friend }, db))?.find((u) => u.kind === "suggest")?.used).toBe(0);
    await assertAllowance({ userId: friend }, "tailor", db, DAY1);
    for (let i = 0; i < DAILY_LIMITS.tailor; i++) await takeAllowance({ userId: friend }, "tailor", db, DAY1);
    await expect(assertAllowance({ userId: friend }, "tailor", db, DAY1)).rejects.toThrow(AiLimitError);
    // An email the caller already has skips the lookup and gives the same answer.
    await expect(assertAllowance({ userId: friend, email: "friend@example.com" }, "tailor", db, DAY1)).rejects.toThrow(AiLimitError);
    await assertAllowance({ userId: friend, email: "owner@example.com" }, "tailor", db, DAY1);
  });

  it("reports today's use per kind", async () => {
    await takeAllowance({ userId: friend }, "suggest", db, DAY1);
    await takeAllowance({ userId: friend }, "suggest", db, DAY1);
    const usage = await usageToday({ userId: friend }, db, DAY1);
    expect(usage?.find((u) => u.kind === "suggest")).toEqual({ kind: "suggest", used: 2, limit: 5 });
    expect(usage?.find((u) => u.kind === "tailor")).toEqual({ kind: "tailor", used: 0, limit: 10 });
  });
});
