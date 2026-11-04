import { and, asc, eq, gt } from "drizzle-orm";
import { getDb, type Db } from "@/db";
import { profiles, targetCompanies, users, workdayCrawlState, type AtsType, type Profile } from "@/db/schema";
import { CRAWLED_RECENTLY_MS } from "@/lib/jobs/sources/workday-crawl";

/** Example target companies (all verified to have live public job boards). Users can edit the list. */
export const SEED_TARGET_COMPANIES: { ats: AtsType; slug: string }[] = [
  { ats: "greenhouse", slug: "stripe" },
  { ats: "greenhouse", slug: "figma" },
  { ats: "lever", slug: "spotify" },
  { ats: "ashby", slug: "ramp" },
  { ats: "ashby", slug: "linear" },
];

/** Creates the profile (and seeds target companies) the first time a user is seen. */
export async function ensureProfile(userId: string, db?: Db): Promise<Profile> {
  db ??= await getDb();
  const existing = await db.query.profiles.findFirst({ where: eq(profiles.userId, userId) });
  if (existing) return existing;
  const [created] = await db.insert(profiles).values({ userId }).onConflictDoNothing().returning();
  if (created) {
    await db
      .insert(targetCompanies)
      .values(SEED_TARGET_COMPANIES.map((c) => ({ ...c, userId })))
      .onConflictDoNothing();
    return created;
  }
  // Lost a race with a concurrent request; read the winner.
  const row = await db.query.profiles.findFirst({ where: eq(profiles.userId, userId) });
  if (!row) throw new Error("Failed to create profile");
  return row;
}

export async function getUser(userId: string, db?: Db) {
  db ??= await getDb();
  return db.query.users.findFirst({ where: eq(users.id, userId) });
}

export async function listTargetCompanies(userId: string, db?: Db) {
  db ??= await getDb();
  return db
    .select()
    .from(targetCompanies)
    .where(eq(targetCompanies.userId, userId))
    .orderBy(asc(targetCompanies.ats), asc(targetCompanies.slug));
}

/** Enabled employers the user chose, not counting the examples every new account starts with. */
export async function countChosenTargetCompanies(userId: string, db?: Db): Promise<number> {
  db ??= await getDb();
  const rows = await db
    .select({ ats: targetCompanies.ats, slug: targetCompanies.slug })
    .from(targetCompanies)
    .where(and(eq(targetCompanies.userId, userId), eq(targetCompanies.enabled, true)));
  const seeded = new Set(SEED_TARGET_COMPANIES.map((c) => `${c.ats}:${c.slug}`));
  return rows.filter((r) => !seeded.has(`${r.ats}:${r.slug}`)).length;
}

export async function listEnabledTargetCompanies(userId: string, db?: Db) {
  db ??= await getDb();
  return db
    .select()
    .from(targetCompanies)
    .where(and(eq(targetCompanies.userId, userId), eq(targetCompanies.enabled, true)))
    // A fixed order keeps the daily Workday rotation (takeTurns) stable.
    .orderBy(asc(targetCompanies.ats), asc(targetCompanies.slug));
}

/**
 * The nightly crawler's recent visits to the user's Workday sites. An older crawl means the
 * crawler stopped, and the Vercel search covers the site again, so it isn't listed.
 */
export async function listWorkdayCrawls(userId: string, db?: Db) {
  db ??= await getDb();
  return db
    .select({
      slug: workdayCrawlState.slug,
      status: workdayCrawlState.status,
      lastCrawledAt: workdayCrawlState.lastCrawledAt,
      listingsSeen: workdayCrawlState.listingsSeen,
      error: workdayCrawlState.error,
    })
    .from(workdayCrawlState)
    .where(and(eq(workdayCrawlState.userId, userId), gt(workdayCrawlState.lastCrawledAt, new Date(Date.now() - CRAWLED_RECENTLY_MS))));
}
