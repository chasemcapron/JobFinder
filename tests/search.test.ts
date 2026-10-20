import { desc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPglite, schema, type Db } from "@/db";
import { mockJobs } from "@/lib/jobs/sources/mock";
import { buildSourceTasks, runSourceTasks } from "@/lib/jobs/sources";
import { listMatches } from "@/lib/jobs/results";
import { rescoreStoredMatches, runJobSearch } from "@/lib/jobs/search";
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
    expect(summary.jobsNew).toBe(10); // the sample data includes 2 non-US jobs, which aren't stored
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
    expect(run).toMatchObject({ status: "partial", jobsFetched: 12, jobsNew: 10 });
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
    expect(first.jobsNew).toBe(10);
    const second = await runJobSearch(userId, { trigger: "manual", db, buildTasks: () => [sampleTask] });
    expect(second.jobsNew).toBe(0);
    expect(second.status).toBe("ok");
    const all = await db.select().from(schema.jobs);
    expect(all).toHaveLength(10);
    // one row per job; the higher-priority source's copy is the one stored
    expect(new Set(all.map((j) => j.dedupeKey)).size).toBe(10);
    expect(all.every((j) => j.source === "adzuna")).toBe(true);
  });

  it("keeps only US jobs (and ones with no parsed country) and hides older non-US rows", async () => {
    const [base] = mockJobs();
    // Sources hand over already-parsed locations, so set the country the parser would produce.
    const at = (externalId: string, locationRaw: string, country: string | null) => ({ ...base, externalId, title: `Senior Backend Engineer ${externalId}`, locationRaw, country, dedupeKey: externalId });
    const world: SourceTask = {
      label: "world",
      source: "mock",
      run: async () => [at("chi", "Chicago, IL", "US"), at("lon", "London, England, United Kingdom", "GB"), at("tor", "Toronto, Ontario, Canada", "CA"), at("na", "N/A", null)],
    };
    const summary = await runJobSearch(userId, { trigger: "manual", db, buildTasks: () => [world] });
    expect(summary.jobsFetched).toBe(4);
    const stored = (await db.select({ externalId: schema.jobs.externalId }).from(schema.jobs)).map((j) => j.externalId).sort();
    expect(stored).toEqual(["chi", "na"]);

    // A non-US job stored before this change is hidden from the list.
    const [old] = await db
      .insert(schema.jobs)
      .values({ ...base, externalId: "old-uk", dedupeKey: "old-uk", locationRaw: "London", country: "GB", city: "London", state: null, remote: false, description: "" })
      .returning();
    await db.insert(schema.jobMatches).values({ userId, jobId: old.id, score: 99, keywordScore: 99, reasons: "old" });
    const listed = await listMatches(userId, db);
    expect(listed.some((m) => m.job.country === "GB")).toBe(false);
    expect(listed.some((m) => m.job.locationRaw === "Chicago, IL")).toBe(true);
  });

  it("reports total failure as an error status", async () => {
    const summary = await runJobSearch(userId, { trigger: "cron", db, buildTasks: () => [brokenTask] });
    expect(summary.status).toBe("error");
    expect(summary.jobsFetched).toBe(0);
  });
});

describe("scoring pipeline", () => {
  const matchTitles = async () =>
    (
      await db
        .select({ title: schema.jobs.title, score: schema.jobMatches.score, aiScored: schema.jobMatches.aiScored })
        .from(schema.jobMatches)
        .innerJoin(schema.jobs, eq(schema.jobs.id, schema.jobMatches.jobId))
        .where(eq(schema.jobMatches.userId, userId))
        .orderBy(desc(schema.jobMatches.score))
    ).map((r) => r);
  const setProfile = (values: Partial<typeof schema.profiles.$inferInsert>) =>
    db
      .update(schema.profiles)
      .set({ ...values, matchingUpdatedAt: new Date(Date.now() + 1_000) })
      .where(eq(schema.profiles.userId, userId));

  it("re-ranks matches already stored when the profile changes, without fetching", async () => {
    await runJobSearch(userId, { trigger: "manual", db, buildTasks: () => [sampleTask] });
    expect((await matchTitles())[0].title).toBe("Senior Backend Engineer");

    await setProfile({ titles: ["Data Analyst"], skills: ["SQL", "Tableau", "Excel"], keywords: [], preferredLocations: [] });
    await rescoreStoredMatches(userId, db);
    const after = await matchTitles();
    // The Data Analyst posting was weak for the old profile but is stored, so it can rise to the top.
    expect(after[0].title).toBe("Data Analyst");
    expect(after[0].score).toBeGreaterThanOrEqual(75);
    expect(after.find((m) => m.title === "Senior Backend Engineer")!.score).toBeLessThan(25);
  });

  it("drops jobs whose title has an excluded word, including ones already stored", async () => {
    await runJobSearch(userId, { trigger: "manual", db, buildTasks: () => [sampleTask] });
    expect((await matchTitles()).some((m) => /backend/i.test(m.title))).toBe(true);
    await setProfile({ excludeKeywords: ["backend"] });
    await rescoreStoredMatches(userId, db);
    expect((await matchTitles()).some((m) => /backend/i.test(m.title))).toBe(false);
  });

  it("never uses or keeps sample jobs in production", async () => {
    await runJobSearch(userId, { trigger: "manual", db, buildTasks: () => [sampleTask] });
    expect((await matchTitles()).length).toBeGreaterThan(0);
    vi.stubEnv("NODE_ENV", "production");
    try {
      const profile = await ensureProfile(userId, db);
      expect(buildSourceTasks(profile, [])).toEqual([]);
      // No target companies or keyed sources: nothing to fetch, and no sample-data fallback.
      const summary = await runJobSearch(userId, { trigger: "manual", db, buildTasks: (p) => buildSourceTasks(p, []) });
      expect(summary.sources).toEqual([]);
      expect(await matchTitles()).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  describe("with Gemini configured", () => {
    let aiCalls = 0;
    beforeEach(() => {
      aiCalls = 0;
      vi.stubEnv("GEMINI_API_KEY", "test-key");
      // Answers every job id in the prompt with a fixed score, like the real batch endpoint would.
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: RequestInit) => {
          aiCalls++;
          const prompt: string = JSON.parse(String(init.body)).contents[0].parts[0].text;
          const ids = [...prompt.matchAll(/<job id="([^"]+)">/g)].map((m) => m[1]);
          const results = ids.map((id) => ({ id, score: 91, reason: "Strong backend payments fit" }));
          return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ results }) }] }, finishReason: "STOP" }] }));
        }),
      );
    });
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    it("AI-scores the top candidates and doesn't re-score them on the next run", async () => {
      const first = await runJobSearch(userId, { trigger: "manual", db, buildTasks: () => [sampleTask], maxAiScores: 3 });
      expect(first.aiScored).toBe(3);
      const rows = await matchTitles();
      expect(rows.filter((r) => r.aiScored)).toHaveLength(3);
      expect(rows[0]).toMatchObject({ score: 91, aiScored: true });

      const callsAfterFirst = aiCalls;
      const second = await runJobSearch(userId, { trigger: "manual", db, buildTasks: () => [sampleTask], maxAiScores: 3 });
      // The 3 fresh AI scores are kept; the next 3 candidates get scored instead.
      expect(second.aiScored).toBe(3);
      expect((await matchTitles()).filter((r) => r.aiScored)).toHaveLength(6);
      expect(aiCalls).toBe(callsAfterFirst + 1);
    });

    it("scores one role posted in several cities once and shares the result", async () => {
      const [base] = mockJobs();
      const cities = ["Chicago, IL", "Austin, TX", "Denver, CO"].map((loc, i) => ({
        ...base,
        externalId: `multi-${i}`,
        dedupeKey: `multi-${i}`,
        locationRaw: loc,
        city: loc.split(",")[0],
        state: loc.split(", ")[1],
      }));
      const fetchSpy = vi.mocked(globalThis.fetch);
      const summary = await runJobSearch(userId, { trigger: "manual", db, buildTasks: () => [{ label: "multi", source: "mock", run: async () => cities }] });
      const prompt: string = JSON.parse(String(fetchSpy.mock.calls[0][1]!.body)).contents[0].parts[0].text;
      expect([...prompt.matchAll(/<job id=/g)]).toHaveLength(1);
      expect(summary.aiScored).toBe(3);
      expect((await matchTitles()).every((m) => m.aiScored && m.score === 91)).toBe(true);
    });

    it("falls back to keyword scores when Gemini is busy", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify({ error: { code: 503, message: "high demand" } }), { status: 503 })),
      );
      const summary = await runJobSearch(userId, { trigger: "manual", db, buildTasks: () => [sampleTask] });
      expect(summary.aiScored).toBe(0);
      expect(summary.status).toBe("partial");
      expect(summary.errors[0]).toMatch(/AI scoring: Gemini is busy/);
      expect((await matchTitles())[0].title).toBe("Senior Backend Engineer");
    });
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
