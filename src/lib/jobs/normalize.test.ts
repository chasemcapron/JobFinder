import { describe, expect, it } from "vitest";
import { companyFromSlug, dedupeJobs, dedupeKey, finalizeJob } from "./normalize";
import { annualize, parseSalaryFromText } from "./salary";
import type { NormalizedJob } from "./types";

function job(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return finalizeJob({
    source: "greenhouse",
    externalId: "x:1",
    title: "Senior Backend Engineer",
    company: "Acme",
    locationRaw: "Chicago, IL",
    description: "Build APIs",
    applyUrl: "https://example.com/1",
    postedAt: null,
    ...overrides,
  });
}

describe("finalizeJob", () => {
  it("fills location, level, and trims text", () => {
    const j = job({ title: "  Senior   Backend Engineer ", company: " Acme " });
    expect(j).toMatchObject({
      title: "Senior Backend Engineer",
      company: "Acme",
      city: "Chicago",
      state: "IL",
      country: "US",
      remote: false,
      experienceLevel: "senior",
      salaryMin: null,
    });
  });

  it("parses salary from the description when the source has none", () => {
    expect(job({ description: "Pay: $120,000 - $150,000 per year" })).toMatchObject({ salaryMin: 120000, salaryMax: 150000 });
  });

  it("keeps explicit adapter values over parsed ones", () => {
    expect(job({ remote: true, experienceLevel: "lead", salaryMin: 1, salaryMax: 2 })).toMatchObject({
      remote: true,
      experienceLevel: "lead",
      salaryMin: 1,
    });
  });
});

describe("dedupe", () => {
  it("treats the same company/title/location as one job regardless of formatting", () => {
    expect(dedupeKey(job({ company: "ACME", title: "Senior Backend Engineer!" }))).toBe(dedupeKey(job()));
    expect(dedupeKey(job({ locationRaw: "Austin, TX" }))).not.toBe(dedupeKey(job()));
  });

  it("prefers direct ATS postings over aggregator copies", () => {
    const fromAdzuna = job({ source: "adzuna", externalId: "a1", description: "a much longer description".repeat(10) });
    const fromAts = job({ source: "greenhouse", externalId: "g1" });
    const out = dedupeJobs([fromAdzuna, fromAts]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("greenhouse");
  });

  it("within the same priority keeps the richer description", () => {
    const short = job({ source: "lever", externalId: "l1", description: "short" });
    const long = job({ source: "ashby", externalId: "a1", description: "a much longer description" });
    expect(dedupeJobs([short, long])[0].externalId).toBe("a1");
  });

  it("keeps distinct jobs", () => {
    expect(dedupeJobs([job(), job({ title: "Frontend Engineer" }), job({ company: "Other" })])).toHaveLength(3);
  });
});

describe("salary parsing", () => {
  it.each([
    ["$165,000—$190,000 USD", { min: 165000, max: 190000, currency: "USD" }],
    ["$211.4K – $290.6K", { min: 211400, max: 290600, currency: "USD" }],
    ["£50,000 to £60,000", { min: 50000, max: 60000, currency: "GBP" }],
    ["$45 - $60/hr", { min: 93600, max: 124800, currency: "USD" }],
    ["We raised $20 - $30 million", { min: null, max: null, currency: null }],
    ["no salary here", { min: null, max: null, currency: null }],
  ])("%s", (text, expected) => {
    expect(parseSalaryFromText(text)).toEqual(expected);
  });

  it("annualizes intervals", () => {
    expect(annualize(100000, "1 YEAR")).toBe(100000);
    expect(annualize(12500, "1 MONTH")).toBe(150000);
    expect(annualize(50, "PH")).toBe(104000);
    expect(annualize(50, "per-hour-wage")).toBe(104000);
    expect(annualize(1, "NONE")).toBeNull();
    expect(annualize(null, "PA")).toBeNull();
  });
});

describe("companyFromSlug", () => {
  it("title-cases slugs", () => {
    expect(companyFromSlug("spotify")).toBe("Spotify");
    expect(companyFromSlug("my-big_company")).toBe("My Big Company");
  });
});
