import { describe, expect, it } from "vitest";
import { extractSignals } from "./signals";

const companyStory = "Acme is the leading platform for widgets, trusted by thousands of companies worldwide. ".repeat(30);

const posting = `About Acme

${companyStory}

What you'll do

- Build weekly operations dashboards in Power BI for the support team
- Answer ad-hoc data requests from finance and operations

What we're looking for

- 1-2 years of experience writing SQL against a production database
- Bachelor's degree in Information Systems or a related field
- Comfortable presenting findings to non-technical stakeholders

Nice to have

- Experience with dbt or Airflow

Benefits

- Unlimited PTO, 401(k) match, free lunch

Acme is an equal opportunity employer and considers applicants without regard to race, color, religion or sex.`;

describe("extractSignals", () => {
  it("keeps the requirements even when they sit past the old 2,500-character cut", () => {
    expect(posting.indexOf("1-2 years")).toBeGreaterThan(2_000);
    const { text } = extractSignals(posting, { budget: 1_200 });
    expect(text).toContain("1-2 years of experience writing SQL");
    expect(text).toContain("Power BI");
  });

  it("drops benefits, equal-opportunity text and the company story", () => {
    const { text } = extractSignals(posting);
    expect(text).not.toMatch(/Unlimited PTO|equal opportunity|leading platform for widgets/);
  });

  it("orders required qualifications before responsibilities and preferred ones", () => {
    const { text, sections } = extractSignals(posting);
    expect(sections.map((s) => s.kind)).toEqual(["required", "duties", "preferred"]);
    expect(text.indexOf("What we're looking for")).toBeLessThan(text.indexOf("What you'll do"));
  });

  it("states hard facts up front", () => {
    const { facts, text } = extractSignals(posting);
    expect(facts).toEqual(expect.arrayContaining(["1-2 years of experience writing SQL against a production database"]));
    expect(facts.some((f) => /Bachelor's degree/.test(f))).toBe(true);
    expect(text.startsWith("Key facts:")).toBe(true);
  });

  it("stays within its budget", () => {
    for (const budget of [400, 1_000, 2_400]) {
      expect(extractSignals(posting, { budget }).text.length).toBeLessThanOrEqual(budget + 1);
    }
  });

  it("keeps requirements written one short line per paragraph", () => {
    const perLine = "Qualifications\n\nBachelor's degree in Computer Science\n\nMust hold an active Secret clearance\n\nExperience with Python and SQL\n\nBenefits\n\nDental and vision";
    const { text, facts } = extractSignals(perLine);
    expect(facts).toEqual(expect.arrayContaining(["Bachelor's degree in Computer Science", "Must hold an active Secret clearance"]));
    expect(text).toContain("Experience with Python and SQL");
    expect(text).not.toContain("Dental");
  });

  it("keeps 'About this role' and 'Who we are looking for' sections", () => {
    const p = `${companyStory}\n\nAbout This Role\n\nYou will build reporting in Power BI.\n\nWho We Are Looking For\n\nSomeone who writes SQL daily.`;
    const { text } = extractSignals(p);
    expect(text).toContain("Power BI");
    expect(text).toContain("writes SQL daily");
  });

  it("doesn't spend the budget on fact lines twice", () => {
    const { text } = extractSignals(posting);
    expect(text.split("1-2 years of experience writing SQL").length - 1).toBe(1);
  });

  it("keeps the opening of a posting without headings, plus facts from anywhere in it", () => {
    const federal = `${"Serves as an IT Specialist supporting enterprise systems and help desk operations. ".repeat(40)}Applicants must be U.S. citizens. Travel up to 10% may be required.`;
    const { text, facts } = extractSignals(federal);
    expect(text).toContain("Serves as an IT Specialist");
    expect(facts).toEqual(expect.arrayContaining(["Applicants must be U.S. citizens.", "Travel up to 10% may be required."]));
    expect(text.length).toBeLessThan(2_000);
  });
});
