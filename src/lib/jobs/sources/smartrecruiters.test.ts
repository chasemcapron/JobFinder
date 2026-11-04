import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseTargetCompany } from "@/lib/parse-input";
import { fetchSmartRecruiters } from "./smartrecruiters";

// Trimmed copies of live ServiceNow responses (2026-11-04): a listing for "analyst" and one posting's details.
const fixture = (name: string) => JSON.parse(readFileSync(path.join(process.cwd(), "tests/fixtures", name), "utf8"));
const LIST = fixture("smartrecruiters-list.json");
const DETAIL = fixture("smartrecruiters-detail.json");
const EMPTY = { offset: 0, limit: 100, totalFound: 0, content: [] };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Routes by URL: listings (with or without a search) and posting details. */
function mockApi(opts: { listing?: (url: URL) => unknown; detail?: (id: string) => unknown } = {}) {
  const spy = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const id = url.pathname.match(/\/postings\/([^/]+)$/)?.[1];
    if (id) return json(opts.detail ? opts.detail(id) : { ...DETAIL, id });
    return json(opts.listing ? opts.listing(url) : LIST);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

const search = { queries: ["Data Analyst", "Systems Analyst"], profile: { titles: ["Data Analyst", "Systems Analyst"], excludeKeywords: [], seniority: "entry" as const } };
const signal = () => new AbortController().signal;

afterEach(() => vi.unstubAllGlobals());

describe("SmartRecruiters adapter", () => {
  it("searches US postings for each title, then reads each posting's details", async () => {
    const spy = mockApi();
    const jobs = await fetchSmartRecruiters("servicenow", search, signal());

    const listings = spy.mock.calls.map(([u]) => new URL(String(u))).filter((u) => !/\/postings\/./.test(u.pathname));
    expect(listings.map((u) => u.searchParams.get("q"))).toEqual(["Data Analyst", "Systems Analyst"]);
    expect(listings.every((u) => u.searchParams.get("country") === "us")).toBe(true);

    // Two distinct postings across both searches: each fetched once.
    expect(jobs).toHaveLength(2);
    const [job] = jobs;
    expect(job).toMatchObject({
      source: "smartrecruiters",
      company: "ServiceNow",
      city: "West Palm Beach",
      state: "FL",
      country: "US",
      remote: false, // hybrid
      applyUrl: "https://jobs.smartrecruiters.com/ServiceNow/744000159668209-ai-solutions-delivery-associate",
    });
    expect(job.externalId).toMatch(/^servicenow:7440001596/);
    expect(job.postedAt?.toISOString()).toBe("2026-11-04T15:43:08.770Z");
    // The role and its requirements, without the company's "about us".
    expect(job.description).toContain("AI-enabled solutions");
    expect(job.description).toContain("1+ years of relevant experience");
    expect(job.description).not.toContain("Fred Luddy");
  });

  it("maps SmartRecruiters' clear levels and leaves the broad ones to the title and description", async () => {
    mockApi({ detail: (id) => ({ ...DETAIL, id, experienceLevel: { id: id.endsWith("209") ? "internship" : "mid_senior_level" } }) });
    const jobs = await fetchSmartRecruiters("servicenow", search, signal());
    expect(jobs.find((j) => j.externalId.endsWith("209"))?.experienceLevel).toBe("internship");
    expect(jobs.find((j) => !j.externalId.endsWith("209"))?.experienceLevel).not.toBe("senior");
  });

  it("skips postings marked inactive and titles the profile excludes", async () => {
    mockApi({ detail: (id) => ({ ...DETAIL, id, active: !id.endsWith("209") }) });
    expect(await fetchSmartRecruiters("servicenow", search, signal())).toHaveLength(1);

    const spy = mockApi();
    const jobs = await fetchSmartRecruiters("servicenow", { ...search, profile: { ...search.profile, excludeKeywords: ["marketing", "delivery"] } }, signal());
    expect(jobs).toEqual([]);
    expect(spy.mock.calls.some(([u]) => /\/postings\/\d+$/.test(new URL(String(u)).pathname))).toBe(false);
  });

  it("reads full-time postings before internships and part-time ones, unless the profile wants internships", async () => {
    const intern = { ...LIST.content[0], id: "1", name: "Data Analyst Intern", experienceLevel: { id: "internship" } };
    const partTime = { ...LIST.content[0], id: "2", name: "Data Analyst", typeOfEmployment: { id: "part_time" } };
    const fullTime = { ...LIST.content[0], id: "3", name: "Data Analyst", typeOfEmployment: { id: "permanent" } };
    const order = async (seniority: "entry" | "internship") => {
      const spy = mockApi({ listing: () => ({ ...LIST, totalFound: 3, content: [intern, partTime, fullTime] }) });
      await fetchSmartRecruiters("servicenow", { queries: ["Data Analyst"], profile: { ...search.profile, seniority } }, signal());
      return spy.mock.calls.map(([u]) => new URL(String(u)).pathname.match(/\/postings\/(\d+)$/)?.[1]).filter(Boolean);
    };
    // Five detail workers start in order, so the request order is the ranking.
    expect(await order("entry")).toEqual(["3", "1", "2"]);
    expect((await order("internship"))[0]).toBe("1");
  });

  it("retries once when rate limited", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (/\/postings\/./.test(url.pathname)) return json({ ...DETAIL, id: url.pathname.split("/").pop() });
        return ++calls === 1 ? json({}, 429) : json(LIST);
      }),
    );
    expect(await fetchSmartRecruiters("servicenow", { ...search, queries: ["Data Analyst"] }, signal())).toHaveLength(2);
  });

  it("says so when the company name is unknown, since SmartRecruiters answers that with zero postings", async () => {
    mockApi({ listing: () => EMPTY });
    await expect(fetchSmartRecruiters("nosuchcompany", search, signal())).rejects.toThrow(/No open postings for a SmartRecruiters company named "nosuchcompany"/);
  });

  it("returns nothing, without an error, when a real company has nothing for these titles", async () => {
    mockApi({ listing: (url) => (url.searchParams.get("q") ? EMPTY : { ...EMPTY, totalFound: 312 }) });
    expect(await fetchSmartRecruiters("nbcuniversal3", search, signal())).toEqual([]);
  });

  it("is added from a board URL or smartrecruiters:company", () => {
    expect(parseTargetCompany("https://jobs.smartrecruiters.com/ServiceNow/744000159668209-ai-solutions-delivery-associate")).toEqual({
      ats: "smartrecruiters",
      slug: "servicenow",
    });
    expect(parseTargetCompany("https://careers.smartrecruiters.com/NBCUniversal3")).toEqual({ ats: "smartrecruiters", slug: "nbcuniversal3" });
    expect(parseTargetCompany("smartrecruiters:WesternDigital")).toEqual({ ats: "smartrecruiters", slug: "westerndigital" });
    // Apply and referral links put a fixed path word before the company.
    expect(parseTargetCompany("https://jobs.smartrecruiters.com/oneclick-ui/company/ServiceNow/publication/3eba1428")).toEqual({
      ats: "smartrecruiters",
      slug: "servicenow",
    });
    expect(parseTargetCompany("https://jobs.smartrecruiters.com/external-referrals/company/ServiceNow/publication/3eba1428?dcr_ci=ServiceNow")).toEqual({
      ats: "smartrecruiters",
      slug: "servicenow",
    });
  });
});
