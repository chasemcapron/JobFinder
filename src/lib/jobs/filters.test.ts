import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  DEFAULT_FILTERS,
  filterMatches,
  filtersToSearchParams,
  locationFacets,
  paginate,
  parseFilters,
  searchTerms,
  type JobFilters,
} from "./filters";
import type { MatchResult } from "./results";

const NOW = new Date("2026-10-15T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

let seq = 0;
function row(job: Partial<MatchResult["job"]> = {}, extra: Partial<MatchResult> = {}): MatchResult {
  seq += 1;
  return {
    job: {
      id: `job-${seq}`,
      source: "greenhouse",
      title: "Backend Engineer",
      company: "Acme",
      locationRaw: "Chicago, IL",
      city: "Chicago",
      state: "IL",
      country: "US",
      remote: false,
      experienceLevel: "senior",
      applyUrl: "https://example.com",
      postedAt: daysAgo(2),
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      firstSeenAt: daysAgo(1),
      description: "Build payment systems with TypeScript.",
      ...job,
    },
    score: 70,
    aiScored: false,
    reasons: "",
    matchedKeywords: [],
    application: null,
    ...extra,
  };
}

const rows = [
  row({ title: "Senior Backend Engineer" }, { score: 90 }),
  row({ title: "Frontend Engineer", city: "Austin", state: "TX", locationRaw: "Austin, TX", experienceLevel: "mid" }, { score: 60 }),
  row({ title: "Platform Engineer", city: null, state: null, remote: true, locationRaw: "Remote", source: "lever" }, { score: 75 }),
  row({ title: "Data Engineer", city: "London", state: "England", country: "GB", locationRaw: "London", postedAt: daysAgo(20) }, { score: 50 }),
  row({ title: "Payments Engineer", experienceLevel: null, source: "adzuna", postedAt: null, firstSeenAt: daysAgo(10) }, {
    score: 80,
    application: { id: "a1", status: "applied", appliedAt: daysAgo(1), sheetSyncStatus: "synced" },
  }),
];

const f = (over: Partial<JobFilters>): JobFilters => ({ ...DEFAULT_FILTERS, ...over });
const titles = (r: MatchResult[]) => r.map((m) => m.job.title);

describe("filterMatches", () => {
  it("returns everything with default filters (applied jobs are dimmed, not hidden)", () => {
    expect(filterMatches(rows, DEFAULT_FILTERS, NOW)).toHaveLength(5);
  });

  it("filters by country, state, and city (case-insensitive)", () => {
    expect(titles(filterMatches(rows, f({ country: "GB" }), NOW))).toEqual(["Data Engineer"]);
    expect(titles(filterMatches(rows, f({ country: "US", state: "tx" }), NOW))).toEqual(["Frontend Engineer"]);
    expect(filterMatches(rows, f({ city: "chicago" }), NOW)).toHaveLength(2);
  });

  it("filters remote vs on-site", () => {
    expect(titles(filterMatches(rows, f({ remote: "remote" }), NOW))).toEqual(["Platform Engineer"]);
    expect(filterMatches(rows, f({ remote: "onsite" }), NOW)).toHaveLength(4);
  });

  it("filters by experience level; unknown levels don't match a level filter", () => {
    expect(titles(filterMatches(rows, f({ levels: ["mid"] }), NOW))).toEqual(["Frontend Engineer"]);
    expect(filterMatches(rows, f({ levels: ["senior", "mid"] }), NOW)).toHaveLength(4);
  });

  it("filters by source", () => {
    expect(titles(filterMatches(rows, f({ sources: ["lever", "adzuna"] }), NOW))).toEqual(["Platform Engineer", "Payments Engineer"]);
  });

  it("filters by date posted, falling back to first-seen when the source has no date", () => {
    expect(filterMatches(rows, f({ posted: "7" }), NOW)).toHaveLength(3);
    expect(filterMatches(rows, f({ posted: "14" }), NOW)).toHaveLength(4);
  });

  it("keyword search matches all terms across title, company, location, and description", () => {
    expect(titles(filterMatches(rows, f({ q: "typescript london" }), NOW))).toEqual(["Data Engineer"]);
    expect(filterMatches(rows, f({ q: "acme" }), NOW)).toHaveLength(5);
    expect(titles(filterMatches(rows, f({ q: '"senior backend"' }), NOW))).toEqual(["Senior Backend Engineer"]);
    expect(filterMatches(rows, f({ q: "rust" }), NOW)).toHaveLength(0);
  });

  it("hides or isolates applied jobs", () => {
    expect(filterMatches(rows, f({ applied: "hide" }), NOW)).toHaveLength(4);
    expect(titles(filterMatches(rows, f({ applied: "only" }), NOW))).toEqual(["Payments Engineer"]);
  });

  it("applies a minimum score and combines filters", () => {
    expect(filterMatches(rows, f({ minScore: 75 }), NOW)).toHaveLength(3);
    expect(titles(filterMatches(rows, f({ minScore: 75, country: "US", remote: "onsite", applied: "hide" }), NOW))).toEqual([
      "Senior Backend Engineer",
    ]);
  });

  it("sorts by date when asked", () => {
    expect(titles(filterMatches(rows, f({ sort: "date" }), NOW))[0]).toBe("Senior Backend Engineer");
    expect(titles(filterMatches(rows, f({ sort: "date" }), NOW)).at(-1)).toBe("Data Engineer");
  });
});

describe("parseFilters / filtersToSearchParams", () => {
  it("round-trips", () => {
    const filters = f({ q: "rust", country: "US", levels: ["senior", "lead"], sources: ["lever"], posted: "7", applied: "hide", minScore: 50, sort: "date", page: 2 });
    const params = Object.fromEntries(
      [...filtersToSearchParams(filters).entries()].reduce((m, [k, v]) => m.set(k, [...(m.get(k) ?? []), v]), new Map<string, string[]>()),
    );
    expect(parseFilters(params)).toEqual(filters);
  });

  it("ignores invalid values", () => {
    expect(parseFilters({ remote: "maybe", level: ["senior", "wizard"], source: "linkedin", posted: "5", minScore: "abc", page: "-3" })).toEqual(
      f({ levels: ["senior"] }),
    );
  });

  it("accepts comma-separated multi values and omits defaults when serializing", () => {
    expect(parseFilters({ level: "entry,mid" }).levels).toEqual(["entry", "mid"]);
    expect(filtersToSearchParams(DEFAULT_FILTERS).toString()).toBe("");
  });
});

describe("helpers", () => {
  it("searchTerms keeps quoted phrases", () => {
    expect(searchTerms('Senior "machine learning"  python')).toEqual(["senior", "machine learning", "python"]);
  });

  it("paginate clamps the page", () => {
    const items = Array.from({ length: 120 }, (_, i) => i);
    expect(paginate(items, 3)).toMatchObject({ page: 3, pages: 3, total: 120 });
    expect(paginate(items, 3).items).toHaveLength(20);
    expect(paginate(items, 99).page).toBe(3);
    expect(paginate([], 1)).toMatchObject({ page: 1, pages: 1, items: [] });
  });

  it("location facets narrow by country then state", () => {
    const all = locationFacets(rows, { country: null, state: null });
    expect(all.countries).toEqual([
      { value: "US", label: "United States", count: 4 },
      { value: "GB", label: "United Kingdom", count: 1 },
    ]);
    const us = locationFacets(rows, { country: "US", state: "IL" });
    expect(us.states.map((s) => s.value)).toEqual(["IL", "TX"]);
    expect(us.cities).toEqual([{ value: "Chicago", label: "Chicago", count: 2 }]);
  });

  it("counts active filters", () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    expect(activeFilterCount(f({ q: "x", levels: ["mid"], applied: "hide" }))).toBe(3);
  });
});
