import { describe, expect, it } from "vitest";
import { parseColumnLetter, parseList, parseSheetId, parseTargetCompany } from "./parse-input";

describe("parseList", () => {
  it("splits on commas and newlines, trims, and dedupes case-insensitively", () => {
    expect(parseList("React, typescript\nReact\n  node.js ,, ")).toEqual(["React", "typescript", "node.js"]);
  });
  it("returns [] for empty input", () => {
    expect(parseList("")).toEqual([]);
    expect(parseList(null)).toEqual([]);
  });
  it("caps the number of items", () => {
    expect(parseList("a,b,c,d", 2)).toEqual(["a", "b"]);
  });
});

describe("parseSheetId", () => {
  const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-xy";
  it("accepts a bare ID", () => expect(parseSheetId(id)).toBe(id));
  it("extracts the ID from a URL", () =>
    expect(parseSheetId(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`)).toBe(id));
  it("returns null for blank", () => expect(parseSheetId("  ")).toBeNull());
  it("rejects junk", () => expect(() => parseSheetId("not a sheet")).toThrow());
});

describe("parseTargetCompany", () => {
  it("parses ats:slug", () => expect(parseTargetCompany("Greenhouse:Stripe")).toEqual({ ats: "greenhouse", slug: "stripe" }));
  it("parses board URLs", () => {
    expect(parseTargetCompany("https://jobs.lever.co/spotify")).toEqual({ ats: "lever", slug: "spotify" });
    expect(parseTargetCompany("https://jobs.ashbyhq.com/linear/abc")).toEqual({ ats: "ashby", slug: "linear" });
    expect(parseTargetCompany("https://job-boards.greenhouse.io/figma")).toEqual({ ats: "greenhouse", slug: "figma" });
  });
  it("parses Workday careers URLs, keeping the site name's case", () => {
    expect(parseTargetCompany("https://crowdstrike.wd5.myworkdayjobs.com/en-US/crowdstrikecareers/job/USA---Remote/Analyst_R1")).toEqual({
      ats: "workday",
      slug: "crowdstrike.wd5/crowdstrikecareers",
    });
    expect(parseTargetCompany("https://NGC.wd1.myworkdayjobs.com/Northrop_Grumman_External_Site")).toEqual({
      ats: "workday",
      slug: "ngc.wd1/Northrop_Grumman_External_Site",
    });
    expect(parseTargetCompany("https://wd1.myworkdaysite.com/en-US/recruiting/bah/BAH_Jobs")).toEqual({ ats: "workday", slug: "bah.wd1/BAH_Jobs" });
    expect(parseTargetCompany("workday: leidos.wd5/External")).toEqual({ ats: "workday", slug: "leidos.wd5/External" });
  });
  it("rejects unknown ATS and malformed input", () => {
    expect(() => parseTargetCompany("taleo:acme")).toThrow(/Unknown ATS/);
    expect(() => parseTargetCompany("workday:acme")).toThrow(/Workday careers page URL/);
    expect(() => parseTargetCompany("https://www.myworkdayjobs.com/")).toThrow(/Workday careers page URL/);
    expect(() => parseTargetCompany("stripe")).toThrow(/ats:slug/);
  });
});

describe("parseColumnLetter", () => {
  it("normalizes letters", () => expect(parseColumnLetter(" b ")).toBe("B"));
  it("allows blank", () => expect(parseColumnLetter("")).toBeNull());
  it("rejects non-letters", () => expect(() => parseColumnLetter("1")).toThrow());
});
