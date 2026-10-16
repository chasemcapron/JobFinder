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
  it("rejects unknown ATS and malformed input", () => {
    expect(() => parseTargetCompany("workday:acme")).toThrow(/Unknown ATS/);
    expect(() => parseTargetCompany("stripe")).toThrow(/ats:slug/);
  });
});

describe("parseColumnLetter", () => {
  it("normalizes letters", () => expect(parseColumnLetter(" b ")).toBe("B"));
  it("allows blank", () => expect(parseColumnLetter("")).toBeNull());
  it("rejects non-letters", () => expect(() => parseColumnLetter("1")).toThrow());
});
