/**
 * Nightly wide sweep, run by GitHub Actions (.github/workflows/crawl-workday.yml) before the Workday
 * crawl: reads every known public Greenhouse, Lever and Ashby board (src/lib/jobs/sources/sweep.ts),
 * stores US postings relevant to some user's target titles, closes stored ones that left their board,
 * and saves keyword-scored matches. The Workday crawl's AI step (or the 10:00 score cron) then has
 * the AI evaluate the best of them.
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/sweep-boards.ts [--dry-run] [--ats greenhouse,ashby] [--limit 200]
 *
 * --dry-run reads the board lists and boards but writes nothing. --limit caps boards per source (for trying it out).
 * Prints counts only (no company names or titles): Actions logs on a public repo are public.
 * Needs DATABASE_URL.
 */
import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { SWEEP_ATS, sweepBoards, type Profile, type SweepAts } from "@/db/schema";
import { dedupeJobs, dedupeKey } from "@/lib/jobs/normalize";
import type { JobForScoring } from "@/lib/jobs/rank";
import { closeMissingOnBoard, scoreAndSaveMatches, searchInFlight, storeJobs } from "@/lib/jobs/search";
import {
  BOARD_LIST_REFRESH_MS,
  BOARD_LIST_URLS,
  MAX_MISSES,
  parseBoardList,
  relevanceFilter,
  RETRY_GONE_MS,
  runPaced,
  SWEEP_PACE,
  SWEEP_RUN_MS,
  sweepBoard,
  type BoardSweep,
} from "@/lib/jobs/sources/sweep";
import type { NormalizedJob } from "@/lib/jobs/types";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const arg = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const onlyAts = arg("--ats")?.split(",").filter((a): a is SweepAts => (SWEEP_ATS as readonly string[]).includes(a));
const limit = Number(arg("--limit")) || Infinity;
const atsList = onlyAts?.length ? onlyAts : [...SWEEP_ATS];

type Db = Awaited<ReturnType<typeof getDb>>;

async function fetchBoardList(ats: SweepAts): Promise<string[]> {
  const res = await fetch(BOARD_LIST_URLS[ats], { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseBoardList(await res.json());
}

/**
 * Adds boards from the public lists, each at most weekly (a list that failed is tried again the next
 * night). Known boards stay even if a list drops them.
 */
async function refreshBoardLists(db: Db, now: Date) {
  const latest = new Map(
    (await db
      .select({ ats: sweepBoards.ats, at: sql<string | null>`max(${sweepBoards.listedAt})` })
      .from(sweepBoards)
      .groupBy(sweepBoards.ats)).map((r) => [r.ats, r.at ? new Date(r.at).getTime() : 0]),
  );
  for (const ats of SWEEP_ATS) {
    if (now.getTime() - (latest.get(ats) ?? 0) < BOARD_LIST_REFRESH_MS) continue;
    try {
      const slugs = await fetchBoardList(ats);
      for (let i = 0; i < slugs.length; i += 1_000) {
        await db
          .insert(sweepBoards)
          .values(slugs.slice(i, i + 1_000).map((slug) => ({ ats, slug, listedAt: now })))
          .onConflictDoUpdate({ target: [sweepBoards.ats, sweepBoards.slug], set: { listedAt: now } });
      }
      console.log(`board list ${ats}: ${slugs.length} boards`);
    } catch (err) {
      console.log(`board list ${ats}: unavailable (${err instanceof Error ? err.message : "error"}); using boards already known`);
    }
  }
}

/** Boards due tonight: least recently swept first; boards gone MAX_MISSES nights running only monthly. */
async function dueBoards(db: Db, ats: SweepAts, now: Date): Promise<{ slug: string; hasStored: boolean }[]> {
  return db
    .select({ slug: sweepBoards.slug, hasStored: sweepBoards.hasStored })
    .from(sweepBoards)
    .where(
      and(
        eq(sweepBoards.ats, ats),
        or(lt(sweepBoards.misses, MAX_MISSES), isNull(sweepBoards.lastSweptAt), lt(sweepBoards.lastSweptAt, new Date(now.getTime() - RETRY_GONE_MS))),
      ),
    )
    .orderBy(sql`${sweepBoards.lastSweptAt} asc nulls first`, asc(sweepBoards.slug));
}

type BoardResult = { slug: string; r: BoardSweep; hasStored: boolean };

/**
 * Records boards' answers. `misses` is sent as a code (1 gone, -1 error or empty, 0 ok) and resolved
 * against the stored row: a "not found" adds one; an error or an empty answer (maybe a hiccup) leaves
 * the row's counts and `hasStored` alone.
 */
async function saveBoardStates(db: Db, ats: SweepAts, results: BoardResult[], now: Date) {
  for (let i = 0; i < results.length; i += 1_000) {
    const rows = results.slice(i, i + 1_000).map(({ slug, r, hasStored }) => ({
      ats,
      slug,
      listedAt: now,
      lastSweptAt: now,
      lastJobs: r.count,
      misses: r.status === "gone" ? 1 : r.status === "ok" ? 0 : -1,
      hasStored,
    }));
    await db
      .insert(sweepBoards)
      .values(rows)
      .onConflictDoUpdate({
        target: [sweepBoards.ats, sweepBoards.slug],
        set: {
          lastSweptAt: now,
          lastJobs: sql`case when excluded.misses = -1 then ${sweepBoards.lastJobs} else excluded.last_jobs end`,
          misses: sql`case excluded.misses when 1 then ${sweepBoards.misses} + 1 when -1 then ${sweepBoards.misses} else 0 end`,
          hasStored: sql`case when excluded.misses = 0 then excluded.has_stored else ${sweepBoards.hasStored} end`,
        },
      });
  }
}

async function main() {
  const started = Date.now();
  const deadline = started + SWEEP_RUN_MS;
  const now = new Date();
  const db = await getDb();

  const users = (await db.query.profiles.findMany())
    .map((profile: Profile) => ({ profile, keep: relevanceFilter(profile), fetched: new Map<string, JobForScoring>() }))
    .filter((u): u is typeof u & { keep: (j: NormalizedJob) => boolean } => u.keep !== null);
  if (users.length === 0) {
    console.log("No profiles with target titles; nothing to sweep for.");
    process.exit(0);
  }
  const filters = users.map((u) => u.keep);

  if (!dryRun) await refreshBoardLists(db, now);

  let stored = 0;
  await Promise.all(
    atsList.map(async (ats) => {
      const boards = (
        dryRun ? (await fetchBoardList(ats).catch(() => [] as string[])).map((slug) => ({ slug, hasStored: false })) : await dueBoards(db, ats, now)
      ).slice(0, limit);
      // Board states are saved as the sweep goes, so a crash or timeout keeps the night's progress (and Lever's rotation).
      let pending: BoardResult[] = [];
      let saving = Promise.resolve();
      const save = (all = false) => {
        if (dryRun || (!all && pending.length < 200)) return saving;
        const batch = pending;
        pending = [];
        saving = saving
          .then(() => saveBoardStates(db, ats, batch, now))
          .catch((err) => console.log(`  ${ats}: saving board states failed (${err instanceof Error ? err.message.slice(0, 120) : "error"})`));
        return saving;
      };
      const counts: Record<BoardSweep["status"], number> = { ok: 0, empty: 0, gone: 0, error: 0 };
      let postings = 0;
      let relevant = 0;
      const t0 = Date.now();
      const swept = await runPaced(boards, { ...SWEEP_PACE[ats], deadline }, async ({ slug, hasStored }) => {
        const r = await sweepBoard(ats, slug, filters, { hasStored });
        counts[r.status]++;
        postings += r.count;
        relevant += r.relevant.length;
        // Unchanged unless the board answered with postings; stays true if storing fails, so it's read in full again.
        let stillStored = hasStored;
        if (!dryRun && r.status === "ok") {
          try {
            if (r.relevant.length) {
              const unique = dedupeJobs(r.relevant);
              const { idByKey } = await storeJobs(db, unique, now);
              stored += unique.length;
              for (const j of unique) {
                const id = idByKey.get(j.dedupeKey);
                if (!id) continue;
                for (const u of users) if (u.keep(j)) u.fetched.set(id, j);
              }
            }
            // The board's whole list: stored postings from it no longer on it have closed.
            if (r.full) await closeMissingOnBoard(db, { source: ats, slug }, r.full.map(dedupeKey), now);
            stillStored = r.relevant.length > 0;
          } catch (err) {
            stillStored = true;
            console.log(`  ${ats}: storing a board's postings failed (${err instanceof Error ? err.message.slice(0, 120) : "error"})`);
          }
        }
        pending.push({ slug, r, hasStored: stillStored });
        await save();
      });
      await save(true);
      console.log(
        `${ats}: ${swept}/${boards.length} boards in ${Math.round((Date.now() - t0) / 1000)} s (${counts.ok} ok, ${counts.empty} empty, ${counts.gone} gone, ${counts.error} errors); ${postings} postings, ${relevant} relevant${swept < boards.length ? `; ${boards.length - swept} left for next night` : ""}`,
      );
    }),
  );

  if (!dryRun) {
    let userNo = 0;
    for (const u of users) {
      userNo++;
      // A late night can meet a Vercel search for this user, whose AI evaluations this keyword-only
      // save would overwrite. The postings are stored; tomorrow's sweep finds them again.
      if (await searchInFlight(u.profile.userId, db)) {
        console.log(`user ${userNo}: a search is running; matches left for the next sweep`);
        continue;
      }
      const scored = await scoreAndSaveMatches(u.profile.userId, u.profile, db, { fetched: u.fetched, useAi: false, now: new Date() });
      console.log(`user ${userNo}: ${u.fetched.size} swept postings; ${scored.saved} matches saved (keyword scores; the AI step follows)`);
    }
  }
  console.log(`Done in ${Math.round((Date.now() - started) / 1000)} s${dryRun ? " (dry run, nothing written)" : `; ${stored} postings stored or refreshed`}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
