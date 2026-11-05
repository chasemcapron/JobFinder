/**
 * Read-only: the employers "Recommended for you" would list for each user right now, and whether
 * their starter employers are still to come. Users are numbered (no emails); employer names and job
 * titles are public postings. Changes nothing.
 *
 *   npx tsx --env-file=.env.local scripts/preview-starter-companies.ts
 */
import { getDb } from "@/db";
import { profiles } from "@/db/schema";
import { recommendCompanies, STARTER_COMPANIES } from "@/lib/jobs/recommend-companies";
import { countChosenTargetCompanies } from "@/lib/profile";

(async () => {
  const db = await getDb();
  const users = await db.select({ userId: profiles.userId, titles: profiles.titles, starter: profiles.starterCompaniesAt }).from(profiles).orderBy(profiles.userId);
  let n = 0;
  for (const u of users) {
    n++;
    const chosen = await countChosenTargetCompanies(u.userId, db);
    const recs = await recommendCompanies(u.userId, db, { limit: 15 });
    const status = u.starter
      ? "starter employers already handled"
      : u.titles.length === 0
        ? "no target titles yet: gets employers once the resume is saved"
        : chosen > 0
        ? `has ${chosen} employers of their own: left alone`
        : `gets the top ${Math.min(STARTER_COMPANIES, recs.length)} at their next search or resume save`;
    console.log(`User ${n}: ${u.titles.length} target titles (${u.titles.slice(0, 4).join("; ")}); ${status}`);
    for (const r of recs) console.log(`  ${String(r.matches).padStart(3)}  ${r.name} (${r.ats}) e.g. ${r.sampleTitles.join(" · ")}`);
    if (recs.length === 0) console.log("  (nothing in the pool fits yet)");
    console.log();
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
