import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAdzuna } from "./adzuna";
import { fetchAshby } from "./ashby";
import { fetchGreenhouse, greenhouseLocation } from "./greenhouse";
import { fetchLever } from "./lever";
import { fetchUsajobs, levelFromGsGrade, levelFromPayPlan } from "./usajobs";

// greenhouse/lever/ashby fixtures are trimmed copies of real responses captured 2026-10-15.
// The adzuna fixture follows the documented response shape; usajobs follows a live response (2026-10-20), trimmed.
const fixture = (name: string) => JSON.parse(readFileSync(path.join(process.cwd(), "tests/fixtures", name), "utf8"));

function mockFetch(body: unknown, status = 200) {
  const spy = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

const signal = () => new AbortController().signal;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("greenhouseLocation", () => {
  // Shapes from Cloudflare's live board (2026-10-19): `location` is only "Hybrid" for ~85% of postings.
  const meta = (value: unknown) => [{ name: "Cost Center", value: "4700 - Security" }, { name: "Job Posting Location", value }];

  it("keeps a real location as-is", () => {
    expect(greenhouseLocation({ location: { name: "Austin, TX" }, metadata: meta(["Singapore"]) })).toBe("Austin, TX");
  });

  it("uses the posting-location field when the location is just a work arrangement, US cities first", () => {
    expect(greenhouseLocation({ location: { name: "Hybrid" }, metadata: meta(["London, UK", "New York, US"]) })).toBe("New York, US; London, UK");
    expect(greenhouseLocation({ location: { name: "In-Office" }, metadata: meta(["Singapore"]) })).toBe("Singapore");
    expect(greenhouseLocation({ location: { name: "Remote" }, metadata: meta("Austin, US") })).toBe("Remote; Austin, US");
  });

  it("falls back to offices, then to the vague value", () => {
    expect(greenhouseLocation({ location: { name: "Hybrid" }, offices: [{ name: "Lisbon", location: "Lisbon, Portugal" }] })).toBe("Lisbon, Portugal");
    expect(greenhouseLocation({ location: { name: "Hybrid" } })).toBe("Hybrid");
  });
});

describe("greenhouse adapter", () => {
  it("normalizes real postings", async () => {
    const spy = mockFetch(fixture("greenhouse.json"));
    const jobs = await fetchGreenhouse("figma", signal());
    expect(String(spy.mock.calls[0][0 as never])).toBe("https://boards-api.greenhouse.io/v1/boards/figma/jobs?content=true");
    expect(jobs).toHaveLength(3);
    const [multi, paid, london] = jobs;
    expect(multi).toMatchObject({
      source: "greenhouse",
      externalId: "figma:5694259004",
      title: "Account Executive, SMB",
      company: "Figma",
      city: "San Francisco",
      state: "CA",
      country: "US",
      remote: false,
      applyUrl: expect.stringContaining("greenhouse.io/figma/jobs/5694259004"),
    });
    expect(multi.postedAt).toBeInstanceOf(Date);
    // content is double-escaped HTML; it should come out as clean text
    expect(multi.description).not.toMatch(/&lt;|<div|&amp;/);
    expect(paid).toMatchObject({ salaryMin: 165000, salaryMax: 190000, salaryCurrency: "USD" });
    expect(london).toMatchObject({ city: "London", country: "GB" });
  });

  it("turns a 404 into a readable error", async () => {
    mockFetch({ status: 404, error: "Job not found" }, 404);
    await expect(fetchGreenhouse("nope", signal())).rejects.toThrow('No Greenhouse board named "nope"');
  });
});

describe("lever adapter", () => {
  it("normalizes real postings", async () => {
    mockFetch(fixture("lever.json"));
    const jobs = await fetchLever("spotify", signal());
    expect(jobs).toHaveLength(3);
    const [remote, hybrid, onsite] = jobs;
    expect(remote).toMatchObject({
      source: "lever",
      externalId: "spotify:4310f31c-90e1-4e8d-bdcf-dce39c145b8c",
      company: "Spotify",
      city: "New York",
      state: "NY",
      country: "US",
      remote: true,
      applyUrl: "https://jobs.lever.co/spotify/4310f31c-90e1-4e8d-bdcf-dce39c145b8c",
    });
    expect(remote.postedAt?.getTime()).toBe(1783608935950);
    expect(hybrid).toMatchObject({ title: "Backend Engineer - Data Platform", city: "Stockholm", country: "SE", remote: false });
    expect(onsite).toMatchObject({ country: "TW", remote: false });
    expect(hybrid.description.length).toBeGreaterThan(50);
  });

  it("annualizes a documented salaryRange", async () => {
    const [job] = fixture("lever.json");
    mockFetch([{ ...job, salaryRange: { min: 50, max: 60, currency: "USD", interval: "per-hour-wage" } }]);
    const [out] = await fetchLever("spotify", signal());
    expect(out).toMatchObject({ salaryMin: 104000, salaryMax: 124800, salaryCurrency: "USD" });
  });
});

describe("ashby adapter", () => {
  it("normalizes real postings", async () => {
    const spy = mockFetch(fixture("ashby.json"));
    const jobs = await fetchAshby("ramp", signal());
    expect(String(spy.mock.calls[0][0 as never])).toContain("includeCompensation=true");
    const [hybrid, intern, remote] = jobs;
    expect(hybrid).toMatchObject({
      source: "ashby",
      title: "Security Engineer, Cloud", // leading space in the real data is trimmed
      company: "Ramp",
      city: "New York",
      state: "NY",
      country: "US",
      remote: false, // isRemote is true in the data, but workplaceType is Hybrid
      salaryMin: 211400,
      salaryMax: 290600,
      salaryCurrency: "USD",
    });
    expect(intern).toMatchObject({ experienceLevel: "internship", salaryMin: 150000 }); // 12,500 / month
    expect(remote).toMatchObject({ remote: true, city: null, salaryMin: null });
  });

  it("skips unlisted postings and malformed items without failing the board", async () => {
    const body = fixture("ashby.json");
    body.jobs[0].isListed = false;
    body.jobs.push({ id: 123, nonsense: true });
    mockFetch(body);
    expect(await fetchAshby("ramp", signal())).toHaveLength(2);
  });
});

describe("adzuna adapter", () => {
  it("builds the request and normalizes the documented shape", async () => {
    vi.stubEnv("ADZUNA_APP_ID", "test-id");
    vi.stubEnv("ADZUNA_APP_KEY", "test-key");
    const spy = mockFetch(fixture("adzuna.json"));
    const jobs = await fetchAdzuna({ what: "backend engineer", where: "Chicago, IL", remoteOnly: false }, "us", signal());
    const url = new URL(String(spy.mock.calls[0][0 as never]));
    expect(url.pathname).toBe("/v1/api/jobs/us/search/1");
    expect(url.searchParams.get("what")).toBe("backend engineer");
    expect(url.searchParams.get("where")).toBe("Chicago, IL");
    expect(url.searchParams.get("app_id")).toBe("test-id");
    const [real, predicted] = jobs;
    expect(real).toMatchObject({
      source: "adzuna",
      externalId: "4801234567",
      title: "Senior Backend Engineer",
      company: "Example Corp",
      city: "Chicago",
      state: "IL",
      country: "US",
      salaryMin: 150000,
      salaryMax: 180000,
      salaryCurrency: "USD",
      applyUrl: "https://www.adzuna.com/land/ad/4801234567",
    });
    expect(predicted).toMatchObject({ salaryMin: null, salaryMax: null, remote: true });
  });

  it("reports bad credentials", async () => {
    mockFetch({ exception: "AUTH_FAIL" }, 401);
    await expect(fetchAdzuna({ what: "x", where: null, remoteOnly: false }, "us", signal())).rejects.toThrow(/Unauthorized/);
  });
});

describe("usajobs adapter", () => {
  it("sends the required headers and normalizes the documented shape", async () => {
    vi.stubEnv("USAJOBS_API_KEY", "test-key");
    vi.stubEnv("USAJOBS_USER_AGENT", "someone@example.com");
    const spy = mockFetch(fixture("usajobs.json"));
    const jobs = await fetchUsajobs({ what: "IT Specialist", where: null, remoteOnly: true }, signal());
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).searchParams.get("RemoteIndicator")).toBe("True");
    expect(new URL(url).searchParams.get("HiringPath")).toBe("public;student;graduates");
    expect(init.headers).toMatchObject({
      Host: "data.usajobs.gov",
      "User-Agent": "someone@example.com",
      "Authorization-Key": "test-key",
    });
    // The Italy-only posting is dropped; the one with Kuwait and US locations stays, listed by its US places.
    expect(jobs.map((j) => j.title)).toEqual(["IT SPECIALIST (INFOSEC/NETWORK)", "IT Specialist (APPSW)", "Cybersecurity Analyst"]);
    const [dc, remote, gg] = jobs;
    expect(dc).toMatchObject({
      source: "usajobs",
      externalId: "ABC-12345",
      title: "IT SPECIALIST (INFOSEC/NETWORK)",
      company: "Defense Information Systems Agency",
      city: "Washington",
      state: "DC",
      country: "US",
      experienceLevel: "senior",
      salaryMin: 99200,
      salaryMax: 128956,
      salaryCurrency: "USD",
      applyUrl: "https://www.usajobs.gov/job/123456789",
    });
    expect(remote).toMatchObject({ remote: true, city: null, country: "US", salaryMin: 104000, experienceLevel: "mid" });
    expect(gg).toMatchObject({
      locationRaw: "St. Louis, Missouri • Springfield, Virginia",
      city: "St. Louis",
      state: "MO",
      country: "US",
      experienceLevel: "entry",
      applyUrl: "https://www.usajobs.gov/job/555000111",
    });
  });

  it("lists the searched city first for multi-location postings", async () => {
    vi.stubEnv("USAJOBS_API_KEY", "test-key");
    vi.stubEnv("USAJOBS_USER_AGENT", "someone@example.com");
    mockFetch(fixture("usajobs.json"));
    const jobs = await fetchUsajobs({ what: "cyber", where: "Springfield, VA", remoteOnly: false }, signal());
    expect(jobs.find((j) => j.title === "Cybersecurity Analyst")).toMatchObject({
      locationRaw: "Springfield, Virginia • St. Louis, Missouri",
      city: "Springfield",
      state: "VA",
    });
  });

  it("maps GS grades to levels", () => {
    expect(levelFromGsGrade(5)).toBe("entry");
    expect(levelFromGsGrade(9)).toBe("mid");
    expect(levelFromGsGrade(13)).toBe("senior");
    expect(levelFromGsGrade(15)).toBe("executive");
    expect(levelFromGsGrade(null)).toBeNull();
  });

  it("maps other pay plans onto the GS scale", () => {
    expect(levelFromPayPlan("GG", "7")).toBe("entry");
    expect(levelFromPayPlan("GL", 9)).toBe("mid");
    expect(levelFromPayPlan("NH", "2")).toBe("entry");
    expect(levelFromPayPlan("NH", "3")).toBe("senior");
    expect(levelFromPayPlan("ES", "00")).toBe("executive");
    expect(levelFromPayPlan("FP", "04")).toBeNull();
    expect(levelFromPayPlan(null, "7")).toBeNull();
  });
});
