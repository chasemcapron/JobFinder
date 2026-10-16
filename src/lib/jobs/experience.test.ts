import { describe, expect, it } from "vitest";
import { coerceExperienceLevel, inferExperienceLevel } from "./experience";

describe("inferExperienceLevel", () => {
  it.each([
    ["Software Engineering Intern, Summer 2027", "internship"],
    ["Senior Software Engineer", "senior"],
    ["Sr. Data Analyst", "senior"],
    ["Staff Engineer, Payments", "lead"],
    ["Engineering Manager", "lead"],
    ["Director of Product", "executive"],
    ["VP, Engineering", "executive"],
    ["Junior Frontend Developer", "entry"],
    ["Software Engineer II", "mid"],
    ["Software Engineer I", "entry"],
    ["Software Engineer", null],
  ])("%s -> %s", (title, expected) => {
    expect(inferExperienceLevel(title)).toBe(expected);
  });

  it("does not match 'intern' inside 'internal' or 'international'", () => {
    expect(inferExperienceLevel("Internal Tools Engineer")).toBeNull();
    expect(inferExperienceLevel("International Tax Analyst")).toBeNull();
  });
});

describe("coerceExperienceLevel", () => {
  it("maps free-form words", () => {
    expect(coerceExperienceLevel("Mid-Senior")).toBe("mid");
    expect(coerceExperienceLevel("Entry Level")).toBe("entry");
    expect(coerceExperienceLevel("principal")).toBe("lead");
    expect(coerceExperienceLevel("senior")).toBe("senior");
    expect(coerceExperienceLevel("")).toBeNull();
  });
});
