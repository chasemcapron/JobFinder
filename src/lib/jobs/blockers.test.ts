import { describe, expect, it } from "vitest";
import { hardBlockers, isMilitaryEmployer, type BlockerJob, type BlockerProfile } from "./blockers";

const entry: BlockerProfile = { experienceLevels: ["entry"], seniority: "entry", hasClearance: false, avoidMilitary: true };
const job = (over: Partial<BlockerJob> = {}): BlockerJob => ({
  title: "IT Specialist",
  company: "Office of Personnel Management",
  experienceLevel: null,
  minYears: null,
  clearance: null,
  ...over,
});

describe("hardBlockers", () => {
  it("passes an ordinary entry-level job", () => {
    expect(hardBlockers(job(), entry)).toEqual([]);
  });

  it("rules out an active clearance the user doesn't hold, but not one they'll sponsor", () => {
    expect(hardBlockers(job({ clearance: "active" }), entry)).toEqual(["Needs an active clearance"]);
    expect(hardBlockers(job({ clearance: "obtain" }), entry)).toEqual([]);
    expect(hardBlockers(job({ clearance: "active" }), { ...entry, hasClearance: true })).toEqual([]);
  });

  it("rules out internships unless the user wants one", () => {
    expect(hardBlockers(job({ title: "Data Engineer Intern (2027)" }), entry)).toEqual(["Internship"]);
    expect(hardBlockers(job({ title: "Student Trainee (IT)" }), entry)).toEqual(["Internship"]);
    expect(hardBlockers(job({ title: "Data Engineer Intern" }), { ...entry, experienceLevels: ["internship", "entry"] })).toEqual([]);
    // No levels and no seniority: nothing to judge by.
    expect(hardBlockers(job({ title: "Data Engineer Intern" }), { experienceLevels: [], seniority: null })).toEqual([]);
  });

  it("rules out military branches only when the user asked", () => {
    for (const company of ["Army National Guard Units", "U.S. Marine Corps", "Immediate Office of the Chief of Naval Operations", "Air Force Materiel Command", "U.S. Coast Guard", "United States Fleet Forces Command"]) {
      expect(hardBlockers(job({ company }), entry)).toEqual(["Military branch"]);
    }
    expect(hardBlockers(job({ company: "U.S. Marine Corps" }), { ...entry, avoidMilitary: false })).toEqual([]);
  });

  it("keeps civilian defense agencies and look-alike names", () => {
    expect(isMilitaryEmployer("Defense Finance and Accounting Service")).toBe(false);
    expect(isMilitaryEmployer("Defense Information Systems Agency")).toBe(false);
    expect(isMilitaryEmployer("Navy Federal Credit Union")).toBe(false);
    expect(isMilitaryEmployer("The Salvation Army")).toBe(false);
    expect(isMilitaryEmployer("Old Navy")).toBe(false);
    expect(isMilitaryEmployer("U.S. Army Corps of Engineers")).toBe(true);
  });

  it("calls a job too senior from its title or stated years, never from a pay grade alone", () => {
    expect(hardBlockers(job({ title: "Senior Data Analyst" }), entry)).toEqual(["Senior-level title"]);
    expect(hardBlockers(job({ title: "Supervisory IT Specialist (INFOSEC)" }), entry)).toEqual(["Senior-level title"]);
    expect(hardBlockers(job({ title: "Data Analyst", minYears: 5 }), entry)).toEqual(["Asks for 5+ years"]);
    // 3 years is one level up: a stretch, not a blocker.
    expect(hardBlockers(job({ title: "Data Analyst", minYears: 3 }), entry)).toEqual([]);
    // GS-14 reads as "lead", but the title doesn't say so: the user labeled these good.
    expect(hardBlockers(job({ title: "IT Software Engineer (Tech Force)", experienceLevel: "lead" }), entry)).toEqual([]);
    expect(hardBlockers(job({ title: "Associate Product Manager" }), entry)).toEqual([]);
  });

  it("judges seniority against the most senior level wanted", () => {
    const midToo: BlockerProfile = { ...entry, experienceLevels: ["entry", "mid"] };
    expect(hardBlockers(job({ title: "Senior Data Analyst" }), midToo)).toEqual([]);
    expect(hardBlockers(job({ title: "Principal Data Analyst" }), midToo)).toEqual(["Senior-level title"]);
  });
});
