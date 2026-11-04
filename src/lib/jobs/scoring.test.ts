import { describe, expect, it } from "vitest";
import { buildSearchQueries } from "./queries";
import { calibrateKeywordScore, isExcludedTitle, keywordScore, matchesPreferredLocation, titleSimilarity, type MatchProfile, type ScoredJob } from "./scoring";

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

  it("doesn't let a shared generic word like 'analyst' make a different field look like a match", () => {
    expect(titleSimilarity("Cybersecurity Analyst", "Credit Risk Analyst")).toBeLessThanOrEqual(0.15);
    expect(titleSimilarity("Security Engineer", "Software Engineer, Credit")).toBeLessThanOrEqual(0.15);
    expect(titleSimilarity("Security Analyst", "Securities Analyst")).toBeLessThanOrEqual(0.15);
  });

  it("treats cybersecurity and cyber security alike, and still matches the field word", () => {
    expect(titleSimilarity("Cybersecurity Analyst", "Cyber Security Analyst")).toBe(1);
    expect(titleSimilarity("Cybersecurity Analyst", "Security Analyst")).toBeGreaterThanOrEqual(0.5);
  });

  it("reads security acronyms and gives related security words partial credit", () => {
    expect(titleSimilarity("SOC Analyst", "Security Operations Center Analyst")).toBe(1);
    expect(titleSimilarity("Security Analyst", "SOC Analyst")).toBe(1);
    expect(titleSimilarity("GRC Analyst", "Governance, Risk & Compliance Analyst")).toBe(1);
    expect(titleSimilarity("IAM Engineer", "Identity and Access Management Engineer")).toBe(1);
    const related = titleSimilarity("SOC Analyst", "Cyber Defense Analyst");
    expect(related).toBeGreaterThan(0.4);
    expect(related).toBeLessThan(0.6);
    // Related credit is only for security words: other fields still get the 0.15 cap.
    expect(titleSimilarity("SOC Analyst", "Credit Analyst")).toBeLessThanOrEqual(0.15);
  });

  it("gives IT, data and systems titles credit for related words in the same field", () => {
    // Federal "IT Specialist" roles were labeled good for a systems/IT analyst profile (2026-11-03).
    expect(titleSimilarity("Systems Analyst", "IT Specialist (Systems Admin)")).toBeGreaterThanOrEqual(0.5);
    expect(titleSimilarity("Systems Analyst", "Information Technology Specialist")).toBeCloseTo(0.4);
    expect(titleSimilarity("IT Project Analyst", "Help Desk Technician")).toBeGreaterThan(0.25);
    expect(titleSimilarity("Help Desk Technician", "Service Desk Analyst")).toBeGreaterThanOrEqual(0.5);
    expect(titleSimilarity("Data Analyst", "Business Intelligence Analyst")).toBeGreaterThanOrEqual(0.5);
    // A different profession still barely registers.
    expect(titleSimilarity("Data Analyst", "Financial Analyst")).toBeLessThanOrEqual(0.15);
    expect(titleSimilarity("Business Systems Analyst", "Budget Analyst")).toBeLessThanOrEqual(0.15);
    // Broad words don't count as the field: they name other professions too.
    expect(titleSimilarity("Data Analyst", "Financial Reporting Analyst")).toBeLessThanOrEqual(0.15);
    expect(titleSimilarity("IT Specialist", "Customer Support Specialist")).toBeLessThanOrEqual(0.15);
  });

  it("still scores a generic-only profile title by its words", () => {
    expect(titleSimilarity("Engineer", "Software Engineer")).toBe(1);
  });
});

describe("isExcludedTitle", () => {
  it("matches whole words, case-insensitively", () => {
    expect(isExcludedTitle("Credit Risk Analyst", ["credit"])).toBe(true);
    expect(isExcludedTitle("Physical Security Lead", ["physical security"])).toBe(true);
    expect(isExcludedTitle("Accreditation Specialist", ["credit"])).toBe(false);
    expect(isExcludedTitle("Security Analyst", [])).toBe(false);
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

  describe("for an entry-level security candidate", () => {
    const entry: MatchProfile = {
      titles: ["SOC Analyst"],
      skills: ["Splunk", "CompTIA Security+", "Wireshark", "Incident Response"],
      keywords: [],
      searchKeywords: [],
      preferredLocations: [],
      experienceLevels: [],
      remotePreference: "any",
      seniority: "entry",
      hasClearance: false,
    };
    const soc = (overrides: Partial<ScoredJob> = {}) =>
      job({
        title: "SOC Analyst",
        description: "Triage alerts in Splunk, follow incident handling runbooks. Sec+ required.",
        experienceLevel: "entry",
        ...overrides,
      });

    it("matches certifications and skills written differently", () => {
      expect(keywordScore(soc(), entry).matched).toEqual(expect.arrayContaining(["Splunk", "CompTIA Security+", "Incident Response"]));
    });

    it("marks down roles two or more levels up, and says why first", () => {
      const fit = keywordScore(soc(), entry).score;
      const mid = keywordScore(soc({ experienceLevel: "mid", minYears: 3 }), entry).score;
      const senior = keywordScore(soc({ experienceLevel: "senior", minYears: 5 }), entry);
      expect(mid).toBeLessThan(fit);
      expect(fit - mid).toBeLessThan(15); // one step up is a stretch, not a wall
      expect(fit - senior.score).toBeGreaterThan(25);
      expect(senior.reason).toMatch(/^Asks for 5\+ years/);
    });

    it("drops roles needing an active clearance into the red, unless you hold one", () => {
      const needs = keywordScore(soc({ clearance: "active" }), entry);
      expect(needs.score).toBeLessThan(50);
      expect(needs.reason).toMatch(/^Needs an active clearance/);
      expect(keywordScore(soc({ clearance: "obtain" }), entry).score).toBe(keywordScore(soc(), entry).score);
      const held = keywordScore(soc({ clearance: "active" }), { ...entry, hasClearance: true });
      expect(held.score).toBeGreaterThan(keywordScore(soc(), entry).score);
      expect(held.reason).toContain("Uses your clearance");
    });
  });

  it("doesn't mark a federal job down for a level that comes only from its pay grade", () => {
    const itProfile: MatchProfile = { ...profile, titles: ["Systems Analyst"], experienceLevels: ["entry"], seniority: "entry" };
    const federal = job({ title: "IT Specialist (Systems Admin)", experienceLevel: "lead", source: "usajobs" });
    const fromGrade = keywordScore(federal, itProfile).score;
    expect(fromGrade).toBe(keywordScore({ ...federal, experienceLevel: null }, itProfile).score);
    // The title or stated years still count, federal or not.
    expect(keywordScore({ ...federal, title: "Supervisory IT Specialist" }, itProfile).score).toBeLessThan(fromGrade);
    expect(keywordScore({ ...federal, source: "greenhouse" }, itProfile).score).toBeLessThan(fromGrade);
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
