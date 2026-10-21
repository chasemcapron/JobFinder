import { describe, expect, it } from "vitest";
import { inferExperienceLevel } from "./experience";
import { finalizeJob } from "./normalize";
import { clearanceRequirement, levelFromYears, requiredYears } from "./requirements";

describe("requiredYears", () => {
  it.each([
    ["3+ years of experience working in a SOC", 3],
    ["Minimum of 5 years' relevant experience in incident response", 5],
    ["Two (2) years of experience with SIEM tools such as Splunk", 2],
    ["2-4 years of hands-on experience", 2],
    ["0-2 years of experience; new grads welcome", 0],
    ["5+ yrs experience with firewalls", 5],
    ["One year of specialized experience at the GS-07 level", 1],
    ["Bachelor's degree and 4 years of experience, or a Master's degree and 2 years of experience", 2],
  ])("reads %j as %d", (text, years) => {
    expect(requiredYears(text)).toBe(years);
  });

  it.each([
    "For over 25 years, Acme has protected the world's largest companies.",
    "Applicants must be at least 18 years old.",
    "We offer 4 weeks of PTO and a great team.",
  ])("finds no requirement in %j", (text) => {
    expect(requiredYears(text)).toBeNull();
  });

  it("maps years to levels", () => {
    expect([0, 2, 3, 5, 8].map(levelFromYears)).toEqual(["entry", "entry", "mid", "senior", "lead"]);
  });
});

describe("clearanceRequirement", () => {
  it.each([
    "Active TS/SCI clearance required.",
    "Must hold an active Secret clearance.",
    "TS/SCI with Full Scope Poly required",
    "Clearance: Active Secret",
    "Requirements:\n- Current Top Secret clearance\n- Security+ certification",
    // Live phrasings (Leidos, GDIT), where an "eligible"/"ability" clause is about an add-on
    "• Active DoD TS/SCI Clearance and eligible for polygraph",
    "• Clearance: Active DoD Secret clearance, with the ability to obtain and maintain a TS/SCI.",
    "Active Top Secret clearance with SCI eligibility (TS/SCI) is REQUIRED to be considered for this opportunity.",
    "Clearance: U.S. Citizenship with an active TS/SCI with SAP Eligibility",
    "• Current DoD TS/SCI clearance, and ability to pass additional customer suitability screening prior to start",
    "Clearance Level Must Currently Possess:\nInterim Secret\nClearance Level Must Be Able to Obtain:\nTop Secret/SCI",
  ])("needs an active clearance: %j", (text) => {
    expect(clearanceRequirement(text)).toBe("active");
  });

  it.each([
    "Must be able to obtain and maintain a Secret clearance.",
    "Candidates must be eligible for a security clearance.",
    "This position requires a Top Secret clearance, which the company will sponsor.",
    "Secret clearance preferred.",
    "Must be able to obtain an active Secret clearance.",
    "Clearance Level Must Currently Possess:\nNone\nClearance Level Must Be Able to Obtain:\nTop Secret",
  ])("can get one after hire: %j", (text) => {
    expect(clearanceRequirement(text)).toBe("obtain");
  });

  it.each([
    "No clearance required.",
    "We protect our clients' trade secrets.",
    "Experience with secrets management (HashiCorp Vault) and secret rotation.",
    "Join our SOC team monitoring alerts in Splunk.",
    "Clearance Level Must Currently Possess:\nNone\nClearance Level Must Be Able to Obtain:\nNone",
  ])("doesn't need one: %j", (text) => {
    expect(clearanceRequirement(text)).toBeNull();
  });

  it("lets one 'active' sentence outweigh an 'obtain' one", () => {
    expect(clearanceRequirement("Ability to obtain a clearance is a plus. Active Secret clearance required to start.")).toBe("active");
  });
});

describe("finalizeJob", () => {
  const base = { source: "greenhouse" as const, externalId: "1", company: "Acme", locationRaw: "Austin, TX", applyUrl: "https://x.test", postedAt: null };

  it("uses the years asked for when the title gives no level, and the more senior of the two otherwise", () => {
    expect(finalizeJob({ ...base, title: "Security Analyst", description: "5+ years of experience in a SOC." })).toMatchObject({ experienceLevel: "senior", minYears: 5 });
    expect(finalizeJob({ ...base, title: "Security Analyst I", description: "0-1 years of experience." })).toMatchObject({ experienceLevel: "entry", minYears: 0 });
    expect(finalizeJob({ ...base, title: "Junior Security Analyst", description: "3+ years of experience." }).experienceLevel).toBe("mid");
    expect(finalizeJob({ ...base, title: "Security Intern", description: "2+ years of coursework experience." }).experienceLevel).toBe("internship");
  });

  it("keeps an internship title an internship whatever level the source gave it", () => {
    // DFAS posts "INFORMATION TECHNOLOGY INTERN" at GS-4/5, which the USAJobs adapter grades as entry.
    const usajobs = { ...base, source: "usajobs" as const, description: "", experienceLevel: "entry" as const };
    expect(finalizeJob({ ...usajobs, title: "INFORMATION TECHNOLOGY INTERN" }).experienceLevel).toBe("internship");
    expect(finalizeJob({ ...usajobs, title: "Student Trainee (Information Technology)" }).experienceLevel).toBe("internship");
    expect(finalizeJob({ ...usajobs, title: "IT Specialist (INFOSEC)" }).experienceLevel).toBe("entry");
  });

  it("records the clearance requirement unless the adapter already decided it", () => {
    const description = "Must hold an active Secret clearance.";
    expect(finalizeJob({ ...base, title: "SOC Analyst", description }).clearance).toBe("active");
    expect(finalizeJob({ ...base, title: "SOC Analyst", description, clearance: null }).clearance).toBeNull();
  });
});

describe("SOC tier titles", () => {
  it.each([
    ["SOC Analyst Tier 1", "entry"],
    ["Cyber Security Analyst I - Night Shift", "entry"],
    ["SOC Analyst Level 2", "mid"],
    ["Tier 3 Cyber Threat Intelligence Analyst", "senior"],
    ["Cyber Security Engineer Journeyman", "mid"],
    ["Cyber Security Engineer (SME)", "lead"],
    ["Supervisory IT Cybersecurity Specialist (Directorate)", "lead"],
    ["Cyber Threat Intelligence Analyst, Mid", "mid"],
  ])("%s -> %s", (title, level) => {
    expect(inferExperienceLevel(title)).toBe(level);
  });
});
