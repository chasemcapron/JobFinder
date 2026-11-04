import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createPglite, schema, type Db } from "@/db";
import { pickDigestJobs } from "@/lib/email/digest";
import { dismissJob, restoreJob, setCompanyHidden } from "@/lib/jobs/dismissals";
import { DEFAULT_FILTERS, filterMatches, groupByRole } from "@/lib/jobs/filters";
import { listMatches } from "@/lib/jobs/results";
import { ensureProfile } from "@/lib/profile";

let db: Db;
let me: string;
let other: string;

async function addJob(userId: string, company: string, title: string, city: string, score = 80) {
  const [job] = await db
    .insert(schema.jobs)
    .values({
      source: "workday",
      externalId: `${company}-${title}-${city}`,
      dedupeKey: `${company}|${title}|${city}`,
      title,
      company,
      city,
      state: "VA",
      country: "US",
      applyUrl: `https://example.com/${encodeURIComponent(`${company}-${title}-${city}`)}`,
    })
    .returning();
  await db.insert(schema.jobMatches).values({ userId, jobId: job.id, score, keywordScore: score, reasons: "Fits" });
  return job.id;
}

beforeEach(async () => {
  db = await createPglite("memory://");
  [{ id: me }] = await db.insert(schema.users).values({ email: "me@example.com" }).returning();
  [{ id: other }] = await db.insert(schema.users).values({ email: "other@example.com" }).returning();
  await ensureProfile(me, db);
  await ensureProfile(other, db);
});

const visibleTitles = async (userId: string) =>
  groupByRole(filterMatches(await listMatches(userId, db), DEFAULT_FILTERS)).map((r) => `${r.job.company}: ${r.job.title}`);

describe("Not interested", () => {
  it("hides every copy of a role, including copies posted later, and only for this user", async () => {
    const reston = await addJob(me, "Leidos", "IT Analyst", "Reston");
    await addJob(me, "Leidos", "IT Analyst", "Chantilly");
    await addJob(me, "Leidos", "Data Analyst", "Reston");
    // Postings are shared: the other user has the same one in their matches.
    await db.insert(schema.jobMatches).values({ userId: other, jobId: reston, score: 80, keywordScore: 80, reasons: "Fits" });
    expect(await dismissJob(me, reston, "not_relevant", db)).toBe(true);
    await addJob(me, "Leidos", "IT Analyst", "Herndon"); // a new city, the next night
    expect(await visibleTitles(me)).toEqual(["Leidos: Data Analyst"]);
    expect(await visibleTitles(other)).toEqual(["Leidos: IT Analyst"]);
    // Left out by the query itself, so hidden copies can't take the row limit.
    expect((await listMatches(me, db)).map((m) => m.job.title)).toEqual(["Data Analyst"]);

    const hidden = groupByRole(filterMatches(await listMatches(me, db, { hidden: "only" }), { ...DEFAULT_FILTERS, hidden: "only" }));
    expect(hidden.map((r) => [r.job.title, r.hidden])).toEqual([["IT Analyst", { by: "role", reason: "not_relevant" }]]);
    expect(hidden[0].others).toHaveLength(2);

    expect(await restoreJob(me, reston, db)).toBe(true);
    expect(await visibleTitles(me)).toHaveLength(2);
  });

  it("hides a whole company by name, whatever its case or punctuation, and shows it again", async () => {
    const a = await addJob(me, "Booz Allen Hamilton", "Analyst", "McLean");
    await addJob(me, "BOOZ ALLEN HAMILTON", "Engineer", "Arlington");
    await addJob(me, "CACI", "Analyst", "Reston");
    await dismissJob(me, a, "company", db);
    expect(await visibleTitles(me)).toEqual(["CACI: Analyst"]);
    const profile = await db.query.profiles.findFirst({ where: eq(schema.profiles.userId, me) });
    expect(profile?.hiddenCompanies).toEqual(["Booz Allen Hamilton"]);
    // Hiding it twice doesn't list it twice; Settings' "Show again" undoes it.
    await setCompanyHidden(me, "booz allen hamilton", true, db);
    await setCompanyHidden(me, "Booz Allen Hamilton", false, db);
    expect(await visibleTitles(me)).toHaveLength(3);
  });

  it("won't hide or restore a job that isn't in the user's own list", async () => {
    const theirs = await addJob(other, "SAIC", "Analyst", "Reston");
    expect(await dismissJob(me, theirs, "not_relevant", db)).toBe(false);
    expect(await dismissJob(me, theirs, "company", db)).toBe(false);
    expect(await restoreJob(me, theirs, db)).toBe(false);
    expect(await db.select().from(schema.dismissedRoles)).toEqual([]);
  });

  it("keeps an applied job in the list even after hiding its role", async () => {
    const id = await addJob(me, "MITRE", "Analyst", "McLean");
    await db.insert(schema.applications).values({ userId: me, jobId: id });
    await dismissJob(me, id, "too_senior", db);
    expect(await visibleTitles(me)).toEqual(["MITRE: Analyst"]);
  });

  it("leaves hidden roles and companies out of the morning email", async () => {
    const role = await addJob(me, "Leidos", "IT Analyst", "Reston", 90);
    const company = await addJob(me, "CACI", "Analyst", "Reston", 85);
    await addJob(me, "CACI", "Engineer", "Reston", 84);
    await addJob(me, "MITRE", "Analyst", "McLean", 70);
    await dismissJob(me, role, "location", db);
    await dismissJob(me, company, "company", db);
    expect((await pickDigestJobs(me, db)).map((r) => `${r.job.company}: ${r.job.title}`)).toEqual(["MITRE: Analyst"]);
  });
});
