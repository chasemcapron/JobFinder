import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createPglite, schema, type Db } from "@/db";
import { mockJobs } from "@/lib/jobs/sources/mock";
import { runSourceTasks } from "@/lib/jobs/sources";
import { runJobSearch } from "@/lib/jobs/search";
import type { SourceTask } from "@/lib/jobs/types";
import { ensureProfile, SEED_TARGET_COMPANIES } from "@/lib/profile";

let db: Db;
let userId: string;

beforeEach(async () => {
  db = await createPglite("memory://");
  const [u] = await db.insert(schema.users).values({ email: "t@example.com" }).returning();
  userId = u.id;
  await ensureProfile(userId, db);
  await db
    .update(schema.profiles)
    .set({
      titles: ["Senior Backend Engineer"],
      skills: ["TypeScript", "Node.js", "PostgreSQL", "Kafka", "AWS"],
      keywords: ["payments"],
      preferredLocations: ["Chicago, IL"],
    })
    .where(eq(schema.profiles.userId, userId));
});

const sampleTask: SourceTask = { label: "sample", source: "mock", run: async () => mockJobs() };
const brokenTask: SourceTask = { label: "lever:broken", source: "lever", run: async () => Promise.reject(new Error("HTTP 500")) };

describe("ensureProfile", () => {
  it("seeds target companies once", async () => {
    await ensureProfile(userId, db);
    const rows = await db.select().from(schema.targetCompanies).where(eq(schema.targetCompanies.userId, userId));
    expect(rows).toHaveLength(SEED_TARGET_COMPANIES.length);
  });
});

describe("runJobSearch", () => {
  it("stores jobs, saves ranked matches, and records a broken source without failing", async () => {
    const summary = await runJobSearch(userId, { trigger: "manual", db, buildTasks: () => [sampleTask, brokenTask] });
    expect(summary.status).toBe("partial");
    expect(summary.sources).toEqual([
      expect.objectContaining({ source: "sample", ok: true, count: 12 }),
      expect.objectContaining({ source: "lever:broken", ok: false, error: "HTTP 500" }),
    ]);
    expect(summary.jobsFetched).toBe(12);
    expect(summary.jobsNew).toBe(12);
    expect(summary.aiScored).toBe(0); // no ANTHROPIC_API_KEY in tests

    const matches = await db
      .select({ score: schema.jobMatches.score, title: schema.jobs.title, reasons: schema.jobMatches.reasons })
      .from(schema.jobMatches)
      .innerJoin(schema.jobs, eq(schema.jobs.id, schema.jobMatches.jobId))
      .where(eq(schema.jobMatches.userId, userId))
      .orderBy(schema.jobMatches.score);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.length).toBeLessThan(12); // irrelevant ones (e.g. product designer) are filtered out
    expect(matches.at(-1)?.title).toBe("Senior Backend Engineer");
    expect(matches.some((m) => m.title === "Senior Product Designer")).toBe(false);

    const [run] = await db.select().from(schema.searchRuns).where(eq(schema.searchRuns.id, summary.runId));
    expect(run).toMatchObject({ status: "partial", jobsFetched: 12, jobsNew: 12 });
    expect(run.finishedAt).toBeInstanceOf(Date);
  });

  it("dedupes across sources and doesn't re-insert on a second run", async () => {
    const dupe: SourceTask = {
      label: "adzuna: dupe",
      source: "adzuna",
      run: async () => mockJobs().map((j) => ({ ...j, source: "adzuna" as const, externalId: `adz-${j.externalId}` })),
    };
    const first = await runJobSearch(userId, { trigger: "manual", db, buildTasks: () => [sampleTask, dupe] });
    expect(first.jobsFetched).toBe(24);
    expect(first.jobsNew).toBe(12);
    const second = await runJobSearch(userId, { trigger: "manual", db, buildTasks: () => [sampleTask] });
    expect(second.jobsNew).toBe(0);
    expect(second.status).toBe("ok");
    const all = await db.select().from(schema.jobs);
    expect(all).toHaveLength(12);
    // one row per job; the higher-priority source's copy is the one stored
    expect(new Set(all.map((j) => j.dedupeKey)).size).toBe(12);
    expect(all.every((j) => j.source === "adzuna")).toBe(true);
  });

  it("reports total failure as an error status", async () => {
    const summary = await runJobSearch(userId, { trigger: "cron", db, buildTasks: () => [brokenTask] });
    expect(summary.status).toBe("error");
    expect(summary.jobsFetched).toBe(0);
  });
});

describe("runSourceTasks", () => {
  it("times out a hanging source and keeps the others", async () => {
    const hanging: SourceTask = { label: "slow", source: "greenhouse", run: () => new Promise(() => {}) };
    const { jobs, results } = await runSourceTasks([hanging, sampleTask], { adzunaCountry: "us", remotePreference: "any" }, 200);
    expect(jobs).toHaveLength(12);
    expect(results[0]).toMatchObject({ source: "slow", ok: false, error: "Timed out after 0.2s" });
    expect(results[1]).toMatchObject({ ok: true });
  });
});
