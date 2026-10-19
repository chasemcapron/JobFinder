import { describe, expect, it } from "vitest";
import { buildSearchQueries } from "./queries";
import { calibrateKeywordScore, keywordScore, matchesPreferredLocation, titleSimilarity, type MatchProfile, type ScoredJob } from "./scoring";

const profile: MatchProfile = {
  titles: ["Senior Backend Engineer", "Platform Engineer"],
  skills: ["TypeScript", "Node.js", "PostgreSQL", "Kafka", "AWS", "Kubernetes"],
  keywords: ["payments"],
  searchKeywords: [],
  preferredLocations: ["Chicago, IL"],
  experienceLevels: [],
  remotePreference: "any",
  seniority: "senior",
};

function job(overrides: Partial<ScoredJob> = {}): ScoredJob {
  return {
    title: "Senior Backend Engineer, Payments",
    description: "We use TypeScript, Node.js, PostgreSQL and Kafka on AWS to move payments.",
    city: "Chicago",
    state: "IL",
    country: "US",
    remote: false,
    locationRaw: "Chicago, IL",
    experienceLevel: "senior",
    ...overrides,
  };
}

describe("titleSimilarity", () => {
  it("ignores seniority words and treats developer as engineer", () => {
    expect(titleSimilarity("Senior Backend Engineer", "Backend Engineer II")).toBe(1);
    expect(titleSimilarity("Backend Engineer", "Backend Developer")).toBe(1);
    expect(titleSimilarity("Backend Engineer", "Account Executive")).toBe(0);
  });
});

describe("keywordScore", () => {
  it("scores a strong match highly with a readable reason", () => {
    const r = keywordScore(job(), profile);
    expect(r.score).toBeGreaterThanOrEqual(85);
    expect(r.reason).toContain('Title matches "Senior Backend Engineer"');
    expect(r.reason).toContain("Skills: TypeScript, Node.js, PostgreSQL");
    expect(r.reason).toContain("In Chicago");
    expect(r.matched).toEqual(expect.arrayContaining(["TypeScript", "Kafka", "payments"]));
  });

  it("ranks an unrelated job far lower", () => {
    const r = keywordScore(job({ title: "Account Executive", description: "Sell to enterprises." }), profile);
    expect(r.score).toBeLessThan(15);
  });

  it("penalizes on-site jobs outside preferred locations, but not remote ones", () => {
    const strong = keywordScore(job(), profile).score;
    const elsewhere = keywordScore(job({ city: "Austin", state: "TX", locationRaw: "Austin, TX" }), profile).score;
    const remote = keywordScore(job({ city: null, state: null, locationRaw: "Remote", remote: true }), profile).score;
    expect(elsewhere).toBeLessThan(strong);
    expect(remote).toBeGreaterThan(elsewhere);
  });

  it("applies remote-only and experience-level preferences", () => {
    const remoteOnly = { ...profile, remotePreference: "remote_only" as const };
    expect(keywordScore(job(), remoteOnly).score).toBeLessThan(keywordScore(job({ remote: true }), remoteOnly).score);
    const entryOnly = { ...profile, experienceLevels: ["entry" as const] };
    expect(keywordScore(job(), entryOnly).score).toBeLessThan(keywordScore(job({ experienceLevel: "entry" }), entryOnly).score);
  });

  it("penalizes levels far from the profile's seniority", () => {
    expect(keywordScore(job({ experienceLevel: "internship" }), profile).score).toBeLessThan(keywordScore(job(), profile).score);
  });

  it("returns 0 with guidance when the profile is empty", () => {
    const empty = { ...profile, titles: [], skills: [], keywords: [], searchKeywords: [] };
    expect(keywordScore(job(), empty)).toEqual({ score: 0, matched: [], reason: "Add your resume or keywords to rank this job." });
  });

  it("stays within 0-100", () => {
    const loaded = { ...profile, searchKeywords: ["backend"], experienceLevels: ["senior" as const] };
    const r = keywordScore(job({ remote: true }), loaded);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(keywordScore(job({ title: "Nurse", description: "", experienceLevel: "internship" }), { ...profile, remotePreference: "remote_only" }).score).toBe(0);
  });
});

describe("matchesPreferredLocation", () => {
  it("matches city and checks the state when given", () => {
    expect(matchesPreferredLocation(job(), ["Chicago, IL"])).toBe(true);
    expect(matchesPreferredLocation(job({ city: "Portland", state: "ME", locationRaw: "Portland, ME" }), ["Portland, OR"])).toBe(false);
    expect(matchesPreferredLocation(job({ city: "Berlin", state: null, country: "DE", locationRaw: "Berlin" }), ["Germany"])).toBe(true);
    expect(matchesPreferredLocation(job(), [])).toBe(false);
  });
});

describe("buildSearchQueries", () => {
  it("uses titles first, then keywords, paired with the first location", () => {
    expect(buildSearchQueries({ ...profile, searchKeywords: ["fintech"] }, 3)).toEqual([
      { what: "Senior Backend Engineer", where: "Chicago, IL", remoteOnly: false },
      { what: "Platform Engineer", where: "Chicago, IL", remoteOnly: false },
      { what: "fintech", where: "Chicago, IL", remoteOnly: false },
    ]);
  });

  it("drops the location for remote-only searches and falls back to skills", () => {
    expect(buildSearchQueries({ ...profile, titles: [], remotePreference: "remote_only" }, 2)).toEqual([
      { what: "TypeScript Node.js PostgreSQL", where: null, remoteOnly: true },
    ]);
  });
});

describe("calibrateKeywordScore", () => {
  it("stretches raw points so strong fits land in the 75+ band", () => {
    expect(calibrateKeywordScore(0)).toBe(0);
    expect(calibrateKeywordScore(40)).toBe(51);
    expect(calibrateKeywordScore(60)).toBe(76);
    expect(calibrateKeywordScore(75)).toBe(95);
  });

  it("keeps ordering above 75 instead of capping, and never exceeds 100", () => {
    expect(calibrateKeywordScore(90)).toBeGreaterThan(calibrateKeywordScore(80));
    expect(calibrateKeywordScore(110)).toBe(100);
    expect(calibrateKeywordScore(500)).toBe(100);
    expect(calibrateKeywordScore(-20)).toBe(0);
  });
});
