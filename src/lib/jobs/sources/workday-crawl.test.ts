import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCrawlQueries, crawlWorkdaySite, MAX_OFFSET, MAX_PAGES_PER_SITE, type CrawlOptions } from "./workday-crawl";

const detail = JSON.parse(readFileSync(path.join(process.cwd(), "tests/fixtures/workday-job.json"), "utf8"));
const SLUG = "acme.wd5/Careers";
const noWait = async () => {};

afterEach(() => vi.unstubAllGlobals());

type Posting = { title: string; externalPath: string; locationsText: string };
type Call = { url: string; body?: { appliedFacets: Record<string, string[]>; offset: number; searchText: string } };

/** A fake site: `pages[term]` is that term's listing, served 20 at a time. */
function site(pages: Record<string, Posting[]>, opts: { status?: number; rateLimited?: number; countryFilter?: boolean } = {}) {
  const calls: Call[] = [];
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const call: Call = { url: String(url), body: init.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(call);
      if (opts.status) return reply({}, opts.status);
      if (calls.length <= (opts.rateLimited ?? 0)) return reply({}, 429);
      if (call.url.endsWith("/jobs")) {
        if (opts.countryFilter === false && call.body!.appliedFacets.locationCountry) return reply({}, 400);
        const all = pages[call.body!.searchText] ?? [];
        const slice = all.slice(call.body!.offset, call.body!.offset + 20);
        return reply({ total: call.body!.offset === 0 ? all.length : 0, jobPostings: slice });
      }
      const externalPath = call.url.split("/Careers")[1];
      const posting = Object.values(pages).flat().find((p) => p.externalPath === externalPath)!;
      return reply({ jobPostingInfo: { ...detail.jobPostingInfo, id: externalPath, title: posting.title, externalUrl: null } });
    }),
  );
  return calls;
}

const posting = (title: string, i: number, locationsText = "McLean, VA"): Posting => ({ title, externalPath: `/job/x/${title.replace(/\W+/g, "-")}_R${i}`, locationsText });
const options = (over: Partial<CrawlOptions> = {}): CrawlOptions => ({
  queries: ["Data Analyst"],
  profile: { titles: ["Data Analyst"], searchKeywords: [], excludeKeywords: [], seniority: "entry" },
  knownKeys: async () => new Set(),
  sleep: noWait,
  ...over,
});

describe("buildCrawlQueries", () => {
  it("drops seniority words, de-duplicates, and adds synonyms", () => {
    expect(buildCrawlQueries({ titles: ["Junior Data Analyst", "Data Analyst", "Systems Analyst"], searchKeywords: [] })).toEqual([
      "Data Analyst",
      "Systems Analyst",
      "reporting analyst",
      "business intelligence analyst",
      "it specialist",
      "systems administrator",
    ]);
  });
});

describe("crawlWorkdaySite", () => {
  it("pages past the first page while results stay relevant, and fetches each new posting once", async () => {
    const list = Array.from({ length: 50 }, (_, i) => posting(`Data Analyst ${i}`, i));
    const calls = site({ "Data Analyst": list });
    const r = await crawlWorkdaySite(SLUG, options());
    const offsets = calls.filter((c) => c.url.endsWith("/jobs")).map((c) => c.body!.offset);
    expect(offsets).toEqual([0, 20, 40]);
    expect(r).toMatchObject({ status: "ok", listingsSeen: 50, detailsFetched: 50, totals: { "Data Analyst": 50 } });
    expect(r.jobs[0].listingKey).toMatch(/^acme\/Careers\/job\/x\//);
    expect(r.seenKeys).toHaveLength(50);
  });

  it("stops a term after two pages in a row with nothing relevant, and never goes past MAX_OFFSET", async () => {
    const relevantThenNot = [
      ...Array.from({ length: 20 }, (_, i) => posting(`Data Analyst ${i}`, i)),
      ...Array.from({ length: 60 }, (_, i) => posting(`Nurse Practitioner ${i}`, 100 + i)),
    ];
    const calls = site({ "Data Analyst": relevantThenNot });
    await crawlWorkdaySite(SLUG, options());
    expect(calls.filter((c) => c.url.endsWith("/jobs")).map((c) => c.body!.offset)).toEqual([0, 20, 40]);

    const endless = Array.from({ length: 1_000 }, (_, i) => posting(`Data Analyst ${i}`, i));
    const deep = site({ "Data Analyst": endless });
    await crawlWorkdaySite(SLUG, options({ maxDetails: 0 }));
    expect(Math.max(...deep.filter((c) => c.url.endsWith("/jobs")).map((c) => c.body!.offset))).toBe(MAX_OFFSET - 20);
  });

  it("shares the site's page budget between its search terms", async () => {
    const terms = Array.from({ length: 10 }, (_, i) => `Data Analyst ${i}`);
    const pages = Object.fromEntries(terms.map((t) => [t, Array.from({ length: 1_000 }, (_, i) => posting(`${t} Role`, i))]));
    const calls = site(pages);
    await crawlWorkdaySite(SLUG, options({ queries: terms, maxDetails: 0 }));
    const lists = calls.filter((c) => c.url.endsWith("/jobs"));
    expect(lists).toHaveLength(MAX_PAGES_PER_SITE);
    expect(Math.max(...lists.map((c) => c.body!.offset))).toBe((MAX_PAGES_PER_SITE / 10 - 1) * 20);
  });

  it("skips details for postings already stored but still reports them as seen", async () => {
    const list = [posting("Data Analyst", 1), posting("Data Analyst II", 2)];
    const calls = site({ "Data Analyst": list });
    const r = await crawlWorkdaySite(SLUG, options({ knownKeys: async (keys) => new Set(keys.slice(0, 1)) }));
    expect(calls.filter((c) => !c.url.endsWith("/jobs"))).toHaveLength(1);
    expect(r.seenKeys).toHaveLength(2);
    expect(r.detailsFetched).toBe(1);
  });

  it("drops foreign and excluded postings, and reads irrelevant ones only from a first page", async () => {
    const list = [posting("Data Analyst", 1), posting("Data Analyst", 2, "Bangalore, India"), posting("Credit Data Analyst", 3), posting("Warehouse Associate", 4)];
    site({ "Data Analyst": list }, { countryFilter: false });
    const r = await crawlWorkdaySite(SLUG, options({ profile: { titles: ["Data Analyst"], searchKeywords: [], excludeKeywords: ["credit"], seniority: "entry" } }));
    expect(r.listingsSeen).toBe(2);
    // "Warehouse Associate" is on the first page (Workday's own best match), so it's read too.
    expect(r.jobs.map((j) => j.title).sort()).toEqual(["Data Analyst", "Warehouse Associate"]);
  });

  it("backs off and retries when rate limited", async () => {
    const sleeps: number[] = [];
    site({ "Data Analyst": [posting("Data Analyst", 1)] }, { rateLimited: 2 });
    const r = await crawlWorkdaySite(SLUG, options({ sleep: async (ms) => void sleeps.push(ms) }));
    expect(r.status).toBe("ok");
    expect(sleeps.filter((ms) => ms >= 2_000)).toHaveLength(2);
  });

  it("reports a site that stays rate limited, and one that doesn't exist", async () => {
    site({}, { rateLimited: Infinity });
    expect((await crawlWorkdaySite(SLUG, options())).status).toBe("rate_limited");
    site({}, { status: 422 });
    expect(await crawlWorkdaySite(SLUG, options())).toMatchObject({ status: "not_found", jobs: [] });
  });
});
