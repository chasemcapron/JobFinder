/**
 * Workday coverage: how much of what a Workday site has for the user's target titles JobFinder
 * reaches. Read-only; one listing request per site and title (US filter, first page), 300 ms apart.
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/workday-coverage.ts [slug ...] [--titles "Data Analyst;Systems Analyst"]
 *
 * Titles default to the profile frozen by scripts/eval-matching.ts (eval-data/profile.json).
 * Prints counts only (no posting titles), so the output is safe to share.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { and, eq, gt, like } from "drizzle-orm";
import { getDb } from "@/db";
import { jobs } from "@/db/schema";
import { titleSimilarity } from "@/lib/jobs/scoring";
import { fetchJson, parseItems } from "@/lib/jobs/sources/http";
import { Listing, ListingPosting, parseWorkdaySlug, rankForDetails, US_COUNTRY_ID, WORKDAY_MAX_QUERIES, workdayApi } from "@/lib/jobs/sources/workday";
import { SourceError } from "@/lib/jobs/types";

const DEFAULT_SLUGS = [
  "leidos.wd5/External",
  "capitalone.wd12/Capital_One",
  "cdw.wd5/Careers",
  "travelers.wd5/External",
  "transunion.wd5/TransUnion",
];
const SPACING_MS = 300;
/** What today's adapter fetches details for, per site. */
const TODAY_DETAILS = 25;
/** A listing counts as relevant at this title similarity to any target title. */
const RELEVANT = 0.5;


function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function titlesFromSnapshot(): Promise<string[]> {
  const given = arg("titles");
  if (given) return given.split(";").map((t) => t.trim()).filter(Boolean);
  const snap = JSON.parse(await readFile("eval-data/profile.json", "utf8")) as { profile: { titles: string[] } };
  return snap.profile.titles;
}

async function main() {
  const slugs = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--titles");
  const titles = await titlesFromSnapshot();
  const db = await getDb();
  const staleBefore = new Date(Date.now() - 21 * 86_400_000);
  console.log(`Titles (${titles.length}): ${titles.join("; ")}\n`);
  console.log("site | Workday total (sum over titles) | distinct on first pages | relevant | today's reach (details) | relevant in reach | stored (fresh)");

  for (const slug of slugs.length ? slugs : DEFAULT_SLUGS) {
    const b = parseWorkdaySlug(slug);
    const api = `${workdayApi(b)}/jobs`;
    let facets: Record<string, string[]> = { locationCountry: [US_COUNTRY_ID] };
    const perTitle: { title: string; total: number; paths: string[]; titles: string[] }[] = [];
    let error: string | null = null;
    for (const title of titles) {
      try {
        let data;
        try {
          data = await fetchJson(api, Listing, { signal: AbortSignal.timeout(10_000), body: { appliedFacets: facets, limit: 20, offset: 0, searchText: title } });
        } catch (err) {
          if (!(err instanceof SourceError && err.status === 400) || !Object.keys(facets).length) throw err;
          facets = {}; // no country filter on this site
          data = await fetchJson(api, Listing, { signal: AbortSignal.timeout(10_000), body: { appliedFacets: facets, limit: 20, offset: 0, searchText: title } });
        }
        const postings = parseItems(data.jobPostings ?? [], ListingPosting);
        perTitle.push({ title, total: data.total ?? 0, paths: postings.map((p) => p.externalPath), titles: postings.map((p) => p.title) });
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        break;
      }
      await sleep(SPACING_MS);
    }
    const stored = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.source, "workday"), like(jobs.externalId, `${b.tenant}:%`), gt(jobs.lastSeenAt, staleBefore)));
    if (error) {
      console.log(`${slug} | ERROR: ${error} | stored ${stored.length}`);
      continue;
    }
    // Raw listing pages, kept (git-ignored) so the numbers can be re-derived without new requests.
    await mkdir("eval-data/workday", { recursive: true });
    await writeFile(`eval-data/workday/${b.tenant}-${b.site}.json`, JSON.stringify({ at: new Date().toISOString(), facets, perTitle }, null, 2));
    const titleOf = new Map<string, string>();
    for (const t of perTitle) t.paths.forEach((p, i) => titleOf.set(p, t.titles[i]));
    const relevant = (p: string) => titles.some((t) => titleSimilarity(t, titleOf.get(p)!) >= RELEVANT);
    const distinct = [...titleOf.keys()];
    // Today: the first WORKDAY_MAX_QUERIES titles, one page each, details for the 25 best by title (as fetchWorkday ranks them).
    const candidates = [...new Set(perTitle.slice(0, WORKDAY_MAX_QUERIES).flatMap((t) => t.paths))].map((path) => ({ path, title: titleOf.get(path)! }));
    const reach = rankForDetails(candidates, { titles, seniority: "entry" })
      .slice(0, TODAY_DETAILS)
      .map((c) => c.path);
    const sum = perTitle.reduce((n, t) => n + t.total, 0);
    console.log(
      `${slug}${Object.keys(facets).length ? "" : " (no US filter)"} | ${sum} (${perTitle.map((t) => t.total).join("/")}) | ${distinct.length} | ` +
        `${distinct.filter(relevant).length} | ${reach.length} | ${reach.filter(relevant).length} | ${stored.length}`,
    );
    await sleep(1_000);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
