import { describe, expect, it } from "vitest";
import { buildSystem } from "./ai-score";
import { finalMatch, rankCandidates, type JobForScoring } from "./rank";
import { bestTitleSimilarity, ownFamily, titleSimilarity, type MatchProfile } from "./scoring";

// Matching isn't tuned to one user's field: profiles outside tech (an invited friend's) rank too.
const nurse: MatchProfile & { excludeKeywords: string[] } = {
  titles: ["Registered Nurse", "Clinical Nurse"],
  skills: ["Patient Care", "BLS", "Epic", "Medication Administration"],
  keywords: [],
  searchKeywords: [],
  preferredLocations: ["Denver, CO"],
  experienceLevels: ["entry"],
  remotePreference: "onsite_only",
  seniority: "entry",
  excludeKeywords: [],
};

const job = (title: string, description: string, over: Partial<JobForScoring> = {}): JobForScoring => ({
  title,
  description,
  company: "Mercy Health",
  source: "greenhouse",
  city: "Denver",
  state: "CO",
  country: "US",
  remote: false,
  locationRaw: "Denver, CO",
  experienceLevel: null,
  ...over,
});

describe("matching outside tech", () => {
  it("treats the user's own title words as related when no built-in family covers them", () => {
    expect([...(ownFamily(nurse.titles) ?? [])].sort()).toEqual(["clinical", "nurse", "registered"]);
    // "Clinical Nurse" now credits "Registered Nurse" for the missing word, not just "nurse".
    expect(titleSimilarity("Clinical Nurse", "Registered Nurse - ICU")).toBe(0.5);
    expect(bestTitleSimilarity(nurse.titles, "Registered Nurse - ICU")).toBe(1);
    expect(titleSimilarity("Clinical Nurse", "Registered Nurse - ICU", ownFamily(nurse.titles))).toBeCloseTo(0.8);
    const marketing = ownFamily(["Marketing Coordinator", "Social Media Specialist"]);
    expect(titleSimilarity("Social Media Specialist", "Social Marketing Manager", marketing)).toBeGreaterThan(
      titleSimilarity("Social Media Specialist", "Social Marketing Manager"),
    );
  });

  it("only refines titles that already share a field word, and never from a word they share", () => {
    // No shared field word: another profession stays near zero.
    expect(titleSimilarity("Registered Nurse", "Clinical Research Coordinator", ownFamily(nurse.titles))).toBeLessThanOrEqual(0.15);
    // "social" already matched: it can't also stand in for "media".
    const marketing = ownFamily(["Marketing Coordinator", "Social Media Specialist"]);
    expect(titleSimilarity("Social Media Specialist", "Social Worker", marketing)).toBe(titleSimilarity("Social Media Specialist", "Social Worker"));
  });

  it("builds the family from titles only: search keywords are free-form interests", () => {
    expect(ownFamily(["Data Analyst"])).toBeUndefined();
    expect(ownFamily(["Data Analyst", "Fintech Analyst"])).toBeUndefined(); // one word isn't a family
  });

  it("leaves tech profiles exactly as before: their words are already in built-in families", () => {
    expect(ownFamily(["IT Project Analyst", "Data Analyst", "Systems Analyst", "Business Systems Analyst", "IT Project Coordinator"])).toBeUndefined();
  });

  it("ranks a nurse's jobs above other fields' and applies the same fixed rules", async () => {
    const all = new Map<string, JobForScoring>([
      ["rn", job("Registered Nurse, Med-Surg", "Provide patient care and medication administration. BLS required. Epic charting.")],
      ["data", job("Data Analyst", "SQL, Tableau and Excel reporting for the finance team.")],
      ["senior", job("Senior Registered Nurse", "Patient care, BLS, Epic. 7+ years of acute care.")],
      ["intern", job("Nursing Intern", "Summer program for nursing students.")],
    ]);
    const { candidates } = await rankCandidates(nurse, all, { isFresh: () => false, cap: 10, useAi: false });
    const by = new Map(candidates.map((c) => [c.id, finalMatch(c, undefined)]));
    expect(by.get("rn")!.score).toBeGreaterThan(by.get("data")!.score + 20);
    expect(by.get("senior")!.verdict).toBe("skip");
    expect(by.get("intern")!.verdict).toBe("skip");
    expect(by.get("rn")!.verdict).toBeNull();
  });

  it("doesn't tell the AI that the user's own field is off target", () => {
    const system = buildSystem(nurse, null);
    expect(system).toContain("Target titles: Registered Nurse; Clinical Nurse");
    expect(system).toContain("Judge this against the candidate's own target titles");
    // The other-profession list applies only to professions outside the candidate's own titles.
    expect(system).toContain("a profession the target titles aren't in (policy, tax, clinical or nursing");
  });
});
