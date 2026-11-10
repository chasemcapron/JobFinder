import { describe, expect, it } from "vitest";
import { finalizeJob } from "../normalize";
import { SourceError, type NormalizedJob } from "../types";
import { parseBoardList, relevanceFilter, runPaced, sweepBoard, type BoardFetchers } from "./sweep";

const job = (title: string, locationRaw = "Austin, TX", id = title): NormalizedJob =>
  finalizeJob({ source: "greenhouse", externalId: `acme:${id}`, title, company: "Acme", locationRaw, description: "", applyUrl: "https://example.com", postedAt: null });

const blockers = { experienceLevels: ["entry" as const], seniority: null, hasClearance: false, avoidMilitary: true };
const profile = { titles: ["IT Support Specialist", "SOC Analyst"], searchKeywords: [], excludeKeywords: ["sales"], ...blockers };

describe("parseBoardList", () => {
  it("keeps valid slugs once, first spelling first, and drops anything else", () => {
    expect(parseBoardList(["Ramp", "ramp", "acme-co", "bad slug", "../x", 42, null, "a.b_c"])).toEqual(["Ramp", "acme-co", "a.b_c"]);
  });
  it("rejects a list that isn't an array", () => {
    expect(() => parseBoardList({ jobs: [] })).toThrow();
  });
});

describe("relevanceFilter", () => {
  const keep = relevanceFilter(profile)!;
  it("keeps US postings with a close title", () => {
    expect(keep(job("IT Support Specialist"))).toBe(true);
    expect(keep(job("Security Operations Center (SOC) Analyst"))).toBe(true);
  });
  it("drops unrelated titles, postings abroad and excluded titles", () => {
    expect(keep(job("Account Executive"))).toBe(false);
    expect(keep(job("IT Support Specialist", "London, UK"))).toBe(false);
    expect(keep(job("IT Support Specialist, Sales Systems"))).toBe(false);
  });
  it("drops what the scorer would rule out anyway: too senior, internships", () => {
    expect(keep(job("Senior SOC Analyst"))).toBe(false);
    expect(keep(job("IT Support Intern"))).toBe(false);
  });
  it("is null for a profile with nothing to match on", () => {
    expect(relevanceFilter({ titles: [], searchKeywords: [" "], excludeKeywords: [], ...blockers })).toBeNull();
  });
});

describe("sweepBoard", () => {
  const keep = relevanceFilter(profile)!;
  const fetchers = (over: Partial<BoardFetchers>): BoardFetchers => ({
    greenhouse: async () => [],
    lever: async () => [],
    ashby: async () => [],
    ...over,
  });

  it("reads a Greenhouse board in full only when something on it is relevant", async () => {
    const calls: boolean[] = [];
    const board = [job("IT Support Specialist", "Austin, TX", "1"), job("Account Executive", "Austin, TX", "2")];
    const r = await sweepBoard("greenhouse", "acme", [keep], {
      fetchers: fetchers({ greenhouse: async (_s, _sig, o) => (calls.push(o.content !== false), board) }),
    });
    expect(calls).toEqual([false, true]);
    expect(r).toMatchObject({ status: "ok", count: 2 });
    expect(r.relevant.map((j) => j.title)).toEqual(["IT Support Specialist"]);
    expect(r.full).toHaveLength(2);

    calls.length = 0;
    const none = await sweepBoard("greenhouse", "acme", [keep], {
      fetchers: fetchers({ greenhouse: async (_s, _sig, o) => (calls.push(o.content !== false), [board[1]]) }),
    });
    expect(calls).toEqual([false]);
    expect(none).toMatchObject({ status: "ok", count: 1, relevant: [], full: null });
  });

  it("reads a board with stored postings in full straight away, and returns it even with nothing relevant", async () => {
    const calls: boolean[] = [];
    const r = await sweepBoard("greenhouse", "acme", [keep], {
      hasStored: true,
      fetchers: fetchers({ greenhouse: async (_s, _sig, o) => (calls.push(o.content !== false), [job("Account Executive")]) }),
    });
    expect(calls).toEqual([true]);
    expect(r).toMatchObject({ status: "ok", count: 1, relevant: [] });
    expect(r.full).toHaveLength(1);
    const lever = await sweepBoard("lever", "x", [keep], { hasStored: true, fetchers: fetchers({ lever: async () => [job("Chef")] }) });
    expect(lever.full).toHaveLength(1);
  });

  it("reports empty, gone (404) and other errors", async () => {
    expect((await sweepBoard("lever", "x", [keep], { fetchers: fetchers({}) })).status).toBe("empty");
    const gone = fetchers({ ashby: async () => Promise.reject(new SourceError("No board", 404)) });
    expect((await sweepBoard("ashby", "x", [keep], { fetchers: gone })).status).toBe("gone");
    const broken = fetchers({ ashby: async () => Promise.reject(new SourceError("Server error", 500)) });
    expect((await sweepBoard("ashby", "x", [keep], { fetchers: broken })).status).toBe("error");
  });

  it("keeps Lever and Ashby postings relevant to any user's filter", async () => {
    const other = relevanceFilter({ titles: ["Network Engineer"], searchKeywords: [], excludeKeywords: [], ...blockers })!;
    const r = await sweepBoard("lever", "x", [keep, other], {
      fetchers: fetchers({ lever: async () => [job("Network Engineer"), job("SOC Analyst"), job("Chef")] }),
    });
    expect(r.relevant.map((j) => j.title)).toEqual(["Network Engineer", "SOC Analyst"]);
    expect(r.full).toHaveLength(3);
  });
});

describe("runPaced", () => {
  it("works through items in order and starts none after the deadline", async () => {
    let clock = 0;
    const seen: number[] = [];
    const started = await runPaced([1, 2, 3, 4, 5], { concurrency: 1, gapMs: 10, deadline: 25 }, async (n) => void seen.push(n), {
      now: () => clock,
      sleep: async (ms) => void (clock += ms),
    });
    expect(seen).toEqual([1, 2, 3]);
    expect(started).toBe(3);
  });
  it("runs up to `concurrency` at once", async () => {
    let running = 0;
    let peak = 0;
    await runPaced([1, 2, 3, 4, 5, 6], { concurrency: 3, gapMs: 0, deadline: Infinity }, async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
    });
    expect(peak).toBe(3);
  });
});
