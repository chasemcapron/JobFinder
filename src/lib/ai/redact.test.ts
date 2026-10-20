import { describe, expect, it } from "vitest";
import { redactPersonalInfo } from "./redact";

const RESUME = `Alex Q. Example
Chicago, IL 60601 | (312) 555-0100 | alex.example@mail.com | linkedin.com/in/alex-example
123 N Main Street, Apt 4B
https://alexexample.dev

Security Analyst, Example Corp (2023 - present)
- Triaged 40+ SIEM alerts a day in Splunk; wrote Python playbooks.
References: Alex Q. Example led the NIST CSF audit; alex example signed off.`;

describe("redactPersonalInfo", () => {
  const out = redactPersonalInfo(RESUME, { names: ["Alex Example"] });

  it("removes contact details and links", () => {
    expect(out).not.toMatch(/555-0100|alex\.example@|linkedin|alexexample\.dev|Main Street|60601/);
    expect(out).toContain("[phone]");
    expect(out).toContain("[email]");
    expect(out).toContain("[address]");
  });

  it("removes the name line and the full name anywhere, but keeps the work", () => {
    expect(out.split("\n")[0]).toBe("[name]");
    expect(out).toContain("References: [name] led the NIST CSF audit; [name] signed off.");
    // A surname on its own can be an employer, so it stays.
    expect(out).toContain("Security Analyst, Example Corp");
    expect(out).toContain("Splunk");
    expect(out).toContain("NIST CSF");
  });

  it("keeps city and state, which matter for location fit", () => {
    expect(out).toContain("Chicago, IL");
  });

  it("doesn't treat a job-title first line as a name", () => {
    expect(redactPersonalInfo("Senior Security Analyst\nSkills: Splunk").split("\n")[0]).toBe("Senior Security Analyst");
  });

  it("leaves a first name alone when it could be an employer", () => {
    expect(redactPersonalInfo("Analyst at Wells Fargo", { names: ["Wells Smith"] })).toBe("Analyst at Wells Fargo");
  });
});
