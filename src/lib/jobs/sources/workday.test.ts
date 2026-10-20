import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseLocation } from "../location";
import {
  fetchWorkday,
  normalizeWorkdayJob,
  parsePostedOn,
  parseWorkdaySlug,
  rankForDetails,
  workdayCompanyName,
  workdayLocation,
  type WorkdaySearch,
} from "./workday";

// Trimmed copies of live CrowdStrike responses captured 2026-10-20: a "security analyst" search
// (US, foreign and multi-location postings) and one posting's details.
const fixture = (name: string) => JSON.parse(readFileSync(path.join(process.cwd(), "tests/fixtures", name), "utf8"));
const listing = fixture("workday-jobs.json") as { total: number; jobPostings: { title: string; externalPath: string; locationsText: string }[] };
const detail = fixture("workday-job.json");

const SLUG = "crowdstrike.wd5/crowdstrikecareers";
const board = parseWorkdaySlug(SLUG);
const US = "bc33aa3152ec42d4995f4791a106ed09";
const signal = () => new AbortController().signal;

afterEach(() => vi.unstubAllGlobals());

describe("parseWorkdaySlug / workdayCompanyName", () => {
  it("splits the slug and rejects anything else", () => {
    expect(board).toEqual({ tenant: "crowdstrike", dataCenter: "wd5", site: "crowdstrikecareers" });
    expect(() => parseWorkdaySlug("crowdstrike")).toThrow(/tenant\.wdN\/site/);
  });

  it.each([
    ["ngc.wd1/Northrop_Grumman_External_Site", "Northrop Grumman"],
    ["globalhr.wd5/REC_RTX_Ext_Gateway", "RTX"],
    ["nvidia.wd5/NVIDIAExternalCareerSite", "NVIDIA"],
    ["capitalone.wd12/Capital_One", "Capital One"],
    ["crowdstrike.wd5/crowdstrikecareers", "Crowdstrike"],
    ["leidos.wd5/External", "Leidos"],
    ["mastercard.wd1/CorporateCareers", "Mastercard"],
    ["boeing.wd1/EXTERNAL_CAREERS", "Boeing"],
  ])("names %s %s", (slug, name) => expect(workdayCompanyName(parseWorkdaySlug(slug))).toBe(name));
});

describe("workdayLocation", () => {
  it.each([
    ["USA - Sunnyvale, CA", "Sunnyvale, CA, USA"],
    ["USA - Remote", "Remote, USA"],
    ["United States-California-Redondo Beach", "Redondo Beach, California, United States"],
    ["United States-Remote", "Remote, United States"],
    ["US-CA-GOLETA-B02 ~ 75 Coromar Dr ~ BLDG B02", "Goleta, CA, US"],
    ["US-PA-WILKES-BARRE-WB1", "Wilkes-Barre, PA, US"],
    ["India - Pune", "Pune, India"],
    ["McLean, VA", "McLean, VA"],
    ["Winston-Salem, NC", "Winston-Salem, NC"],
    ["2 Locations", "2 Locations"],
  ])("rewrites %s", (raw, out) => expect(workdayLocation(raw)).toBe(out));

  it("gives the shared parser something it understands", () => {
    const parse = (raw: string) => {
      const p = parseLocation(workdayLocation(raw));
      return [p.city, p.state, p.country];
    };
    expect(parse("United States-Virginia-Dulles")).toEqual(["Dulles", "VA", "US"]);
    expect(parse("US-VA-ARLINGTON-AR1 ~ 1550 Crystal Dr ~ BLDG AR1")).toEqual(["Arlington", "VA", "US"]);
    expect(parse("Israel - Tel Aviv")[2]).toBe("IL");
  });
});

describe("parsePostedOn", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  it.each([
    ["Posted Today", "2026-10-20"],
    ["Posted Yesterday", "2026-10-19"],
    ["Posted 3 Days Ago", "2026-10-17"],
    ["Posted 30+ Days Ago", "2026-09-20"],
  ])("%s", (text, day) => expect(parsePostedOn(text, now)?.toISOString().slice(0, 10)).toBe(day));
  it("returns null for anything else", () => expect(parsePostedOn("Posted soon", now)).toBeNull());
});

describe("normalizeWorkdayJob", () => {
  it("normalizes a real posting", () => {
    const job = normalizeWorkdayJob(detail.jobPostingInfo, board, "/job/x");
    expect(job).toMatchObject({
      source: "workday",
      externalId: "crowdstrike:719f119d666e1001c0adee45de700000",
      title: "Analyst I, Falcon Complete (Hybrid, San Antonio)",
      company: "Crowdstrike",
      locationRaw: "Remote, USA • San Antonio, TX, USA",
      country: "US",
      remote: true,
      applyUrl: detail.jobPostingInfo.externalUrl,
      salaryMin: 85_000,
      salaryMax: 120_000,
    });
    expect(job.postedAt?.toISOString()).toBe("2026-10-15T00:00:00.000Z");
    expect(job.description).toMatch(/^As a global leader in cybersecurity/);
    expect(job.description).not.toContain("<p>");
  });

  it("lists US places first, uses remoteType, and decodes double-encoded line breaks", () => {
    const job = normalizeWorkdayJob(
      {
        ...detail.jobPostingInfo,
        location: "India - Pune",
        additionalLocations: ["United States-Virginia-Dulles"],
        remoteType: "Hybrid",
        jobDescription: "Date Posted: 2026-10-12&amp;#xa;&amp;#xa;Role",
        externalUrl: null,
      },
      board,
      "/job/Dulles/Analyst_R1",
    );
    expect(job.locationRaw).toBe("Dulles, Virginia, United States • Pune, India");
    expect([job.city, job.state, job.country, job.remote]).toEqual(["Dulles", "VA", "US", false]);
    expect(job.description).toBe("Date Posted: 2026-10-12\n\nRole");
    expect(job.applyUrl).toBe("https://crowdstrike.wd5.myworkdayjobs.com/crowdstrikecareers/job/Dulles/Analyst_R1");
  });
});

describe("rankForDetails", () => {
  it("puts close title matches first and far-too-senior roles last, without dropping loose matches", () => {
    const ranked = rankForDetails(
      [{ title: "Financial Analyst" }, { title: "Senior Security Engineer" }, { title: "Security Analyst I" }, { title: "Analyst I, Falcon Complete" }],
      { titles: ["Security Analyst"], seniority: "entry" },
    );
    expect(ranked.map((p) => p.title)).toEqual(["Security Analyst I", "Financial Analyst", "Analyst I, Falcon Complete", "Senior Security Engineer"]);
  });
});

describe("fetchWorkday", () => {
  type Call = { url: string; body?: { appliedFacets: Record<string, string[]>; limit: number; offset: number; searchText: string } };

  /** A fake Workday site. `countryFilter: false` rejects the country filter like Booz Allen's site does. */
  function site(opts: { countryFilter?: boolean; status?: number; postings?: typeof listing.jobPostings } = {}) {
    const postings = opts.postings ?? listing.jobPostings;
    const calls: Call[] = [];
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const call: Call = { url: String(url), body: init.body ? JSON.parse(String(init.body)) : undefined };
        calls.push(call);
        if (opts.status) return reply({}, opts.status);
        if (call.url.endsWith("/jobs")) {
          if (call.body!.appliedFacets.locationCountry && !opts.countryFilter) return reply({ errorCode: "HTTP_400" }, 400);
          const first = call.body!.searchText === "Security Analyst" && call.body!.offset === 0;
          return reply(first ? { total: listing.total, jobPostings: postings } : { total: 0, jobPostings: [] });
        }
        const externalPath = call.url.split("/crowdstrikecareers")[1];
        const posting = postings.find((p) => p.externalPath === externalPath)!;
        return reply({ jobPostingInfo: { ...detail.jobPostingInfo, id: externalPath, title: posting.title, externalUrl: null } });
      }),
    );
    return calls;
  }
  const search = (queries: string[]): WorkdaySearch => ({ queries, profile: { titles: queries, excludeKeywords: [], seniority: "entry" } });
  const listCalls = (calls: Call[]) => calls.filter((c) => c.url.endsWith("/jobs"));
  const detailCalls = (calls: Call[]) => calls.filter((c) => !c.url.endsWith("/jobs"));

  it("tries the US filter, falls back without it, and fetches details for US postings only, best titles first", async () => {
    const calls = site({ countryFilter: false });
    const jobs = await fetchWorkday(SLUG, search(["Security Analyst"]), signal());

    const lists = listCalls(calls);
    expect(lists[0].url).toBe("https://crowdstrike.wd5.myworkdayjobs.com/wday/cxs/crowdstrike/crowdstrikecareers/jobs");
    expect(lists[0].body).toEqual({ appliedFacets: { locationCountry: [US] }, limit: 20, offset: 0, searchText: "Security Analyst" });
    expect(lists[1].body).toMatchObject({ appliedFacets: {}, offset: 0 });
    expect(lists.slice(2).map((c) => c.body!.offset)).toEqual([20]); // one query gets more pages; the empty page ends it

    // India, Israel and Canada are dropped before their details are fetched; "Staff"/"Sr." roles come last.
    expect(detailCalls(calls).map((c) => listing.jobPostings.find((p) => c.url.endsWith(p.externalPath))!.title)).toEqual([
      "Analyst I, Falcon Complete (Hybrid, San Antonio)",
      "Analyst I, Falcon Complete GovCloud (Hybrid, St. Louis)",
      "Staff Product Marketing Manager, Cloud Risk & Developer Security (Remote)",
      "Sr. Product Manager, Red Teaming AI – AIDR (HYBRID)",
    ]);
    expect(jobs).toHaveLength(4);
    expect(jobs.every((j) => j.source === "workday" && j.company === "Crowdstrike")).toBe(true);
  });

  it("keeps the US filter on sites that have it, and searches each title once", async () => {
    const calls = site({ countryFilter: true });
    await fetchWorkday(SLUG, search(["Security Analyst", "SOC Analyst", "Cybersecurity Analyst"]), signal());
    const lists = listCalls(calls);
    expect(lists.every((c) => c.body!.appliedFacets.locationCountry?.[0] === US)).toBe(true);
    expect(lists.map((c) => c.body!.searchText)).toEqual(["Security Analyst", "SOC Analyst", "Cybersecurity Analyst"]);
  });

  it("fetches at most 25 postings' details", async () => {
    const postings = Array.from({ length: 40 }, (_, i) => ({ title: `Security Analyst ${i}`, externalPath: `/job/McLean-VA/Analyst_R${i}`, locationsText: "McLean, VA" }));
    const calls = site({ countryFilter: true, postings });
    const jobs = await fetchWorkday(SLUG, search(["Security Analyst"]), signal());
    expect(detailCalls(calls)).toHaveLength(25);
    expect(jobs).toHaveLength(25);
  });

  it.each([404, 422])("explains a wrong careers URL (%s)", async (status) => {
    site({ status });
    await expect(fetchWorkday(SLUG, search(["Security Analyst"]), signal())).rejects.toThrow(
      "No Workday career site at https://crowdstrike.wd5.myworkdayjobs.com/crowdstrikecareers",
    );
  });
});
