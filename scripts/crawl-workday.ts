/**
 * Nightly Workday crawl, run by GitHub Actions (.github/workflows/crawl-workday.yml) where there's
 * no 60 s function limit. For each user with Workday sites in their target companies:
 * crawl each site deeply (src/lib/jobs/sources/workday-crawl.ts), store new postings, mark every
 * listing seen, record the crawl, check postings unseen for a few days are still open, then score
 * everything (keyword + AI) with a larger AI budget than a Vercel run has.
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/crawl-workday.ts [--sites slug,slug] [--dry-run]
 *
 * Prints counts and statuses only (no site names, titles, error text or resume): Actions logs on a
 * public repo are public, and the list of employers someone follows is personal.
 * Needs DATABASE_URL; GEMINI_API_KEY for the AI step (without it, keyword scores only).
 */
import { and, eq, inArray, isNull, like, lt, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { jobs, profiles, targetCompanies, workdayCrawlState } from "@/db/schema";
import { checkLiveness } from "@/lib/jobs/liveness";
import { isInTargetCountry } from "@/lib/jobs/location";
import { dedupeJobs } from "@/lib/jobs/normalize";
import type { JobForScoring } from "@/lib/jobs/rank";
import { markListingsSeen, scoreAndSaveMatches, searchInFlight, storeJobs } from "@/lib/jobs/search";
import { buildCrawlQueries, crawlWorkdaySite, type CrawlResult } from "@/lib/jobs/sources/workday-crawl";
import { parseWorkdaySlug } from "@/lib/jobs/sources/workday";

/** Sites crawled at once. Each site's requests are 300 ms apart, so ~10 requests a second in all. */
const SITE_CONCURRENCY = 3;
/** Roles the AI evaluates after a crawl: 25 batches, about two minutes at 4.5 s spacing. */
const CRAWL_AI_CAP = 200;
const AI_BUDGET_MS = 10 * 60_000;
/** Workday postings unseen this long get a liveness check (most are just outside the crawl's search). */
const RECHECK_AFTER_MS = 3 * 86_400_000;
const MAX_LIVENESS_CHECKS = 60;
/**
 * No new site is started after this. A site takes up to ~2 minutes (160 requests 300 ms apart plus
 * Workday's response time), so 70 big sites can't all fit one night; with liveness (1 min) and AI
 * scoring (10 min) it stays inside the workflow's 40 minutes. Sites left over go first next night.
 */
const CRAWL_BUDGET_MS = 18 * 60_000;

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const onlySites = argv[argv.indexOf("--sites") + 1]?.split(",").filter(Boolean);

async function main() {
  const started = Date.now();
  const db = await getDb();
  const rows = await db
    .select({ userId: targetCompanies.userId, slug: targetCompanies.slug })
    .from(targetCompanies)
    .where(and(eq(targetCompanies.ats, "workday"), eq(targetCompanies.enabled, true)));
  const sitesByUser = new Map<string, string[]>();
  for (const r of rows) {
    if (argv.includes("--sites") && !onlySites?.includes(r.slug)) continue;
    sitesByUser.set(r.userId, [...(sitesByUser.get(r.userId) ?? []), r.slug]);
  }
  if (sitesByUser.size === 0) console.log("No Workday sites to crawl.");

  let userNo = 0;
  for (const [userId, slugs] of sitesByUser) {
    userNo++;
    const profile = await db.query.profiles.findFirst({ where: eq(profiles.userId, userId) });
    if (!profile || profile.titles.length + profile.searchKeywords.length === 0) {
      console.log(`user ${userNo}: no target titles; skipped`);
      continue;
    }
    const queries = buildCrawlQueries(profile);
    const knownKeys = async (keys: string[]) => {
      const known = new Set<string>();
      for (let i = 0; i < keys.length; i += 500) {
        const found = await db
          .select({ k: jobs.listingKey })
          .from(jobs)
          .where(and(inArray(jobs.listingKey, keys.slice(i, i + 500)), ne(jobs.description, "")));
        for (const f of found) if (f.k) known.add(f.k);
      }
      return known;
    };
    // Least recently crawled first (never crawled before all), so sites a short night left out go first.
    const lastCrawl = new Map(
      (await db
        .select({ slug: workdayCrawlState.slug, at: workdayCrawlState.lastCrawledAt })
        .from(workdayCrawlState)
        .where(eq(workdayCrawlState.userId, userId))).map((c) => [c.slug, c.at.getTime()]),
    );
    slugs.sort((a, b) => (lastCrawl.get(a) ?? 0) - (lastCrawl.get(b) ?? 0) || a.localeCompare(b));
    console.log(`user ${userNo}: ${slugs.length} site(s), ${queries.length} search terms${dryRun ? " (dry run)" : ""}`);

    // Crawl sites a few at a time; store each site's results as it finishes.
    const now = new Date();
    const fetched = new Map<string, JobForScoring>();
    const statusCount: Record<string, number> = {};
    let next = 0;
    const crawlOne = async (slug: string, siteNo: number) => {
      let r: CrawlResult;
      try {
        r = await crawlWorkdaySite(slug, { queries, profile, knownKeys });
      } catch (err) {
        r = { status: "error", jobs: [], seenKeys: [], totals: {}, listingsSeen: 0, detailsFetched: 0, error: err instanceof Error ? err.message : String(err) };
      }
      statusCount[r.status] = (statusCount[r.status] ?? 0) + 1;
      console.log(`  site ${siteNo}/${slugs.length}: ${r.status}, ${r.listingsSeen} listings, ${r.detailsFetched} new`);
      if (dryRun) return;
      const unique = dedupeJobs(r.jobs).filter(isInTargetCountry);
      const { idByKey } = await storeJobs(db, unique, now);
      for (const j of unique) {
        const id = idByKey.get(j.dedupeKey);
        if (id) fetched.set(id, j);
      }
      await markListingsSeen(db, r.seenKeys, now);
      // Postings stored earlier (by an earlier crawl, or another user's) are scored for this user too.
      for (let i = 0; i < r.seenKeys.length; i += 500) {
        const known = await db
          .select({
            id: jobs.id,
            title: jobs.title,
            company: jobs.company,
            source: jobs.source,
            description: jobs.description,
            city: jobs.city,
            state: jobs.state,
            country: jobs.country,
            remote: jobs.remote,
            locationRaw: jobs.locationRaw,
            experienceLevel: jobs.experienceLevel,
            minYears: jobs.minYears,
            clearance: jobs.clearance,
          })
          .from(jobs)
          .where(and(inArray(jobs.listingKey, r.seenKeys.slice(i, i + 500)), isNull(jobs.closedAt)));
        for (const k of known) if (!fetched.has(k.id)) fetched.set(k.id, k);
      }
      const state = {
        lastCrawledAt: now,
        status: r.status,
        listingsSeen: r.listingsSeen,
        detailsFetched: r.detailsFetched,
        totals: r.totals,
        error: r.error?.slice(0, 500) ?? null,
      };
      await db
        .insert(workdayCrawlState)
        .values({ userId, slug, ...state })
        .onConflictDoUpdate({ target: [workdayCrawlState.userId, workdayCrawlState.slug], set: state });
    };
    await Promise.all(
      Array.from({ length: Math.min(SITE_CONCURRENCY, slugs.length) }, async () => {
        while (next < slugs.length && Date.now() - started < CRAWL_BUDGET_MS) {
          const i = next++;
          await crawlOne(slugs[i], i + 1);
        }
      }),
    );
    const left = slugs.length - next;
    console.log(
      `  sites: ${Object.entries(statusCount).map(([s, n]) => `${n} ${s}`).join(", ")}${left ? `, ${left} left for next night (time budget)` : ""}; ${fetched.size} postings to score`,
    );
    if (dryRun) continue;

    // Postings the crawl didn't list for a few days: still open? (Most are; they're just outside the search.)
    const prefixes = slugs.map((s) => {
      const b = parseWorkdaySlug(s);
      return `${b.tenant}/${b.site}/%`;
    });
    // A random sample across all sites, so postings that keep answering "uncertain" don't take every slot.
    const stale = await db
      .select({ id: jobs.id, source: jobs.source, applyUrl: jobs.applyUrl })
      .from(jobs)
      .where(
        and(
          or(...prefixes.map((p) => like(jobs.listingKey, p))),
          isNull(jobs.closedAt),
          lt(jobs.lastSeenAt, new Date(now.getTime() - RECHECK_AFTER_MS)),
        ),
      )
      .orderBy(sql`random()`)
      .limit(MAX_LIVENESS_CHECKS);
    const liveness = await checkLiveness(stale, { budgetMs: 60_000, concurrency: 3 });
    const closed = [...liveness].filter(([, s]) => s === "closed").map(([id]) => id);
    const live = [...liveness].filter(([, s]) => s === "live").map(([id]) => id);
    if (closed.length) await db.update(jobs).set({ closedAt: now }).where(inArray(jobs.id, closed));
    if (live.length) await db.update(jobs).set({ lastSeenAt: now }).where(inArray(jobs.id, live));
    console.log(`  liveness: ${stale.length} checked, ${closed.length} closed, ${live.length} still open`);

    // A late-starting run can meet a Vercel search for this user: leave the AI step to it then
    // (both would evaluate the same roles on the one free Gemini quota); keyword scores still save.
    const searching = await searchInFlight(userId, db);
    if (searching) console.log("  a search is running for this user: keyword scores only");
    const scored = await scoreAndSaveMatches(userId, profile, db, {
      fetched,
      useAi: !searching,
      maxAiScores: CRAWL_AI_CAP,
      deadline: Date.now() + AI_BUDGET_MS,
      now: new Date(),
    });
    console.log(`  scored: ${scored.saved} matches saved, ${scored.aiScored} AI-evaluated${scored.errors.length ? `; ${scored.errors.length} AI error(s)` : ""}`);
  }
  console.log(`Done in ${Math.round((Date.now() - started) / 1000)} s.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
