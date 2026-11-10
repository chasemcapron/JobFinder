import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db";
import { ATS_TYPES, jobs, profiles, targetCompanies, type AtsType, type JobSource, type Profile } from "@/db/schema";
import { parseTargetCompany } from "@/lib/parse-input";
import { ensureProfile, listTargetCompanies, SEED_TARGET_COMPANIES } from "@/lib/profile";
import { isMilitaryEmployer } from "./blockers";
import { inferExperienceLevel, isTooSenior } from "./experience";
import { companyKey } from "./hidden";
import { inTargetCountry, STALE_AFTER_DAYS } from "./results";
import { bestTitleSimilarity, isExcludedTitle, matchesPreferredLocation, ownFamily } from "./scoring";
import { findWorkdayEmployer } from "./sources/workday-employers";

/**
 * Employers to start with, from what the app has already seen: every user's searches and the nightly
 * Workday crawl store their postings in one shared table, so it knows which employers have open US
 * roles right now for a given set of titles. No AI and no fetching, so it's instant and free.
 *
 * A posting counts for a profile when its title is close to one of the target titles (0.5+, the same
 * bar as the Workday employer check), it isn't two or more levels above the profile's seniority, no
 * excluded word is in the title, and it's in a preferred place or remote when places are set (remote
 * only, for a remote-only profile). Employers are ranked by how many postings count.
 *
 * The postings are public. The pool holds employers someone here searches and, since the nightly wide
 * sweep, any public Greenhouse, Lever or Ashby board with a posting relevant to someone's titles, so a
 * recommendation can reflect another user's employer list or titles (DECISIONS.md). No personal data is read.
 */

/** How many employers a new account starts with. */
export const STARTER_COMPANIES = 12;
/** Postings seen this recently count as open (the same window as the Jobs page). */
const RECENT_MS = STALE_AFTER_DAYS * 86_400_000;
/** Words that say nothing about the kind of role, left out of the database's title prefilter. */
const FILLER_WORDS = new Set(["and", "of", "the", "for", "to", "a", "in", "junior", "jr", "senior", "sr", "entry", "level", "i", "ii", "iii", "iv"]);

/** "\m(data|analyst|systems)\M": postings whose title shares a word with a target title. The exact similarity is checked in code. */
export function titleWordPattern(titles: string[]): string | null {
  const words = new Set(
    titles
      .flatMap((t) => t.toLowerCase().split(/[^a-z0-9]+/))
      .filter((w) => w.length >= 2 && !FILLER_WORDS.has(w)),
  );
  return words.size ? `\\m(${[...words].join("|")})\\M` : null;
}
/** Job boards a posting can be traced back to (USAJobs and Adzuna are searches, not employers). */
const BOARD_SOURCES = ATS_TYPES;

export type CompanyRecommendation = {
  ats: AtsType;
  slug: string;
  name: string;
  /** Open US postings that fit the profile. */
  matches: number;
  sampleTitles: string[];
};

type PoolJob = {
  source: JobSource;
  externalId: string;
  applyUrl: string;
  title: string;
  company: string;
  city: string | null;
  state: string | null;
  country: string | null;
  remote: boolean;
  locationRaw: string | null;
  experienceLevel: Profile["seniority"];
};

/** The employer's job board for a stored posting: the slug before ":" in its id, or a Workday site from its link. */
export function boardOf(job: Pick<PoolJob, "source" | "externalId" | "applyUrl">): { ats: AtsType; slug: string } | null {
  if (job.source === "workday") {
    try {
      const parsed = parseTargetCompany(job.applyUrl);
      return parsed.ats === "workday" ? parsed : null;
    } catch {
      return null;
    }
  }
  if (!(BOARD_SOURCES as readonly string[]).includes(job.source)) return null;
  // As stored: Lever and Ashby slugs are case-sensitive (comparisons lowercase on their own).
  const slug = job.externalId.split(":")[0];
  return slug ? { ats: job.source as AtsType, slug } : null;
}

type RecommendProfile = Pick<
  Profile,
  "titles" | "seniority" | "excludeKeywords" | "preferredLocations" | "remotePreference" | "avoidMilitary" | "hiddenCompanies"
>;

/** Pure ranking, for tests: pool postings → employers with the most postings that fit. */
export function rankEmployers(
  pool: PoolJob[],
  profile: RecommendProfile,
  existing: { ats: string; slug: string }[],
  limit: number,
): CompanyRecommendation[] {
  if (profile.titles.length === 0) return [];
  const own = ownFamily(profile.titles);
  const taken = new Set(existing.map((t) => `${t.ats}:${t.slug.toLowerCase()}`));
  const hidden = new Set(profile.hiddenCompanies.map(companyKey));
  const byBoard = new Map<string, CompanyRecommendation & { titles: Set<string> }>();
  const boardCache = new Map<string, { ats: AtsType; slug: string } | null>();

  for (const job of pool) {
    if (hidden.has(companyKey(job.company))) continue;
    if (profile.avoidMilitary && isMilitaryEmployer(job.company)) continue;
    if (isExcludedTitle(job.title, profile.excludeKeywords)) continue;
    if (isTooSenior(job.experienceLevel ?? inferExperienceLevel(job.title), profile.seniority)) continue;
    if (profile.remotePreference === "remote_only" && !job.remote) continue;
    if (profile.preferredLocations.length && !job.remote && !matchesPreferredLocation({ ...job, description: "" }, profile.preferredLocations)) continue;
    if (bestTitleSimilarity(profile.titles, job.title, own) < 0.5) continue;

    const cacheKey = job.source === "workday" ? job.applyUrl.split("/job/")[0] : `${job.source}:${job.externalId.split(":")[0]}`;
    if (!boardCache.has(cacheKey)) boardCache.set(cacheKey, boardOf(job));
    const board = boardCache.get(cacheKey);
    if (!board) continue;
    const key = `${board.ats}:${board.slug.toLowerCase()}`;
    if (taken.has(key)) continue;

    const entry = byBoard.get(key) ?? {
      ...board,
      name: (board.ats === "workday" ? findWorkdayEmployer(board.slug)?.name : undefined) ?? job.company,
      matches: 0,
      sampleTitles: [],
      titles: new Set<string>(),
    };
    entry.matches++;
    entry.titles.add(job.title);
    byBoard.set(key, entry);
  }

  return [...byBoard.values()]
    .sort((a, b) => b.matches - a.matches || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({ titles, ...rec }) => ({ ...rec, sampleTitles: [...titles].slice(0, 3) }));
}

/**
 * Employers worth adding for this user, best first, leaving out ones they already have
 * (`countSeedsAsNew`: the old example companies don't count as had, so one that fits can be picked).
 */
export async function recommendCompanies(
  userId: string,
  db?: Db,
  opts: { limit?: number; now?: Date; countSeedsAsNew?: boolean } = {},
): Promise<CompanyRecommendation[]> {
  db ??= await getDb();
  const profile = await ensureProfile(userId, db);
  const pattern = titleWordPattern(profile.titles);
  if (!pattern) return [];
  const now = opts.now ?? new Date();
  const [pool, tracked] = await Promise.all([
    db
      .select({
        source: jobs.source,
        externalId: jobs.externalId,
        applyUrl: jobs.applyUrl,
        title: jobs.title,
        company: jobs.company,
        city: jobs.city,
        state: jobs.state,
        country: jobs.country,
        remote: jobs.remote,
        locationRaw: jobs.locationRaw,
        experienceLevel: jobs.experienceLevel,
      })
      .from(jobs)
      .where(
        and(
          inArray(jobs.source, [...BOARD_SOURCES]),
          isNull(jobs.closedAt),
          gt(jobs.lastSeenAt, new Date(now.getTime() - RECENT_MS)),
          inTargetCountry,
          // Only titles sharing a word with a target title leave the database.
          sql`${jobs.title} ~* ${pattern}`,
        ),
      ),
    listTargetCompanies(userId, db),
  ]);
  const existing = opts.countSeedsAsNew ? tracked.filter((t) => !isSeed(t)) : tracked;
  return rankEmployers(pool, profile, existing, opts.limit ?? STARTER_COMPANIES);
}

const isSeed = (t: { ats: string; slug: string }) => SEED_TARGET_COMPANIES.some((s) => s.ats === t.ats && s.slug === t.slug);

/**
 * Gives an account that hasn't picked employers a starting list, once: when it has target titles and
 * no employers of its own, on or off (the old example companies don't count). Runs when the resume
 * is saved and before each search, so existing accounts get one at their next search. An account
 * with employers is never changed. `starterCompaniesAt` is set only when employers were added, so
 * Settings can say so; with nothing fitting yet it tries again as the pool grows. The old examples
 * are removed then, unless one fits and is among the picks. Returns how many were added.
 */
export async function ensureStarterCompanies(userId: string, db: Db, now = new Date()): Promise<number> {
  const profile = await ensureProfile(userId, db);
  if (profile.starterCompaniesAt || profile.titles.length === 0) return 0;
  const tracked = await db.select({ ats: targetCompanies.ats, slug: targetCompanies.slug }).from(targetCompanies).where(eq(targetCompanies.userId, userId));
  if (tracked.some((t) => !isSeed(t))) return 0;

  const picks = await recommendCompanies(userId, db, { now, countSeedsAsNew: true });
  if (picks.length === 0) return 0;
  const picked = new Set(picks.map((p) => `${p.ats}:${p.slug}`));
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(targetCompanies)
      .values(picks.map((p) => ({ userId, ats: p.ats, slug: p.slug })))
      .onConflictDoNothing()
      .returning({ id: targetCompanies.id });
    for (const seed of SEED_TARGET_COMPANIES.filter((s) => !picked.has(`${s.ats}:${s.slug}`))) {
      await tx
        .delete(targetCompanies)
        .where(and(eq(targetCompanies.userId, userId), eq(targetCompanies.ats, seed.ats), eq(targetCompanies.slug, seed.slug)));
    }
    await tx.update(profiles).set({ starterCompaniesAt: now }).where(eq(profiles.userId, userId));
    // A pick that was already there (a seed that fits) counts too: it's now one of their employers.
    return Math.max(inserted.length, picks.length);
  });
}
