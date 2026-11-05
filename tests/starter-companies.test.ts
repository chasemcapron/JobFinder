import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createPglite, schema, type Db } from "@/db";
import { boardOf, ensureStarterCompanies, rankEmployers, recommendCompanies, titleWordPattern } from "@/lib/jobs/recommend-companies";
import { ensureProfile, SEED_TARGET_COMPANIES } from "@/lib/profile";

const profile = {
  titles: ["Data Analyst", "Systems Analyst"],
  seniority: "entry" as const,
  excludeKeywords: ["sales"],
  preferredLocations: [] as string[],
  remotePreference: "any" as const,
  avoidMilitary: false,
  hiddenCompanies: [] as string[],
};

let n = 0;
function posting(over: Partial<Parameters<typeof rankEmployers>[0][number]> = {}) {
  n++;
  return {
    source: "greenhouse" as const,
    externalId: `acme:${n}`,
    applyUrl: `https://job-boards.greenhouse.io/acme/jobs/${n}`,
    title: "Data Analyst",
    company: "Acme",
    city: "Chicago",
    state: "IL",
    country: "US",
    remote: false,
    locationRaw: "Chicago, IL",
    experienceLevel: null,
    ...over,
  };
}

describe("rankEmployers", () => {
  it("ranks employers by open roles that fit the titles and level, leaving out ones that don't", () => {
    const pool = [
      posting(),
      posting({ title: "Systems Analyst I" }),
      posting({ externalId: "globex:1", company: "Globex", title: "Junior Data Analyst" }),
      posting({ externalId: "initech:1", company: "Initech", title: "Senior Director of Data Analytics" }), // too senior
      posting({ externalId: "umbrella:1", company: "Umbrella", title: "Software Engineer" }), // not their titles
      posting({ externalId: "hooli:1", company: "Hooli", title: "Data Analyst, Sales" }), // excluded word
      posting({ source: "usajobs", externalId: "123", company: "Dept. of Energy" }), // a search, not an employer board
    ];
    expect(rankEmployers(pool, profile, [], 10)).toEqual([
      { ats: "greenhouse", slug: "acme", name: "Acme", matches: 2, sampleTitles: ["Data Analyst", "Systems Analyst I"] },
      { ats: "greenhouse", slug: "globex", name: "Globex", matches: 1, sampleTitles: ["Junior Data Analyst"] },
    ]);
  });

  it("leaves out employers already tracked, hidden, or military when the profile skips those", () => {
    const pool = [posting(), posting({ externalId: "navy:1", company: "U.S. Navy" }), posting({ externalId: "globex:1", company: "Globex" })];
    expect(rankEmployers(pool, profile, [{ ats: "greenhouse", slug: "ACME" }], 10).map((r) => r.slug)).toEqual(["globex", "navy"]);
    expect(rankEmployers(pool, { ...profile, avoidMilitary: true, hiddenCompanies: ["globex"] }, [], 10).map((r) => r.slug)).toEqual(["acme"]);
    // Hidden names match the way "Not interested" does, punctuation and case aside.
    expect(rankEmployers([posting({ company: "Acme, Inc." })], { ...profile, hiddenCompanies: ["ACME INC"] }, [], 10)).toEqual([]);
  });

  it("keeps to the preferred places (remote counts) and to remote roles for a remote-only profile", () => {
    const pool = [
      posting({ externalId: "austin:1", city: "Austin", state: "TX", locationRaw: "Austin, TX" }),
      posting({ externalId: "chicago:1" }),
      posting({ externalId: "anywhere:1", city: null, state: null, locationRaw: "Remote", remote: true }),
    ];
    expect(rankEmployers(pool, { ...profile, preferredLocations: ["Chicago, IL"] }, [], 10).map((r) => r.slug).sort()).toEqual(["anywhere", "chicago"]);
    expect(rankEmployers(pool, { ...profile, remotePreference: "remote_only" }, [], 10).map((r) => r.slug)).toEqual(["anywhere"]);
  });

  it("traces Workday postings to their career site, with the checked list's name", () => {
    const job = posting({
      source: "workday",
      externalId: "bah:R1",
      company: "Booz Allen Hamilton Inc.",
      applyUrl: "https://bah.wd1.myworkdayjobs.com/en-US/BAH_Jobs/job/McLean-VA/Data-Analyst_R1",
    });
    expect(boardOf(job)).toEqual({ ats: "workday", slug: "bah.wd1/BAH_Jobs" });
    expect(rankEmployers([job], profile, [], 10)[0]).toMatchObject({ ats: "workday", slug: "bah.wd1/BAH_Jobs", name: "Booz Allen Hamilton" });
  });

  it("suggests nothing without target titles", () => {
    expect(rankEmployers([posting()], { ...profile, titles: [] }, [], 10)).toEqual([]);
  });

  it("lets the database send only titles sharing a word with a target title", () => {
    expect(titleWordPattern(["Junior Data Analyst", "IT Project Coordinator"])).toBe(String.raw`\m(data|analyst|it|project|coordinator)\M`);
    expect(titleWordPattern([])).toBeNull();
  });
});

async function setup() {
  const db = await createPglite("memory://");
  const [u] = await db.insert(schema.users).values({ email: "new@example.com" }).returning();
  await ensureProfile(u.id, db);
  return { db, userId: u.id };
}

async function addJobs(db: Db, rows: { slug: string; title: string; n: number }[]) {
  await db.insert(schema.jobs).values(
    rows.flatMap((r) =>
      Array.from({ length: r.n }, (_, i) => ({
        source: "greenhouse" as const,
        externalId: `${r.slug}:${i}`,
        dedupeKey: `${r.slug}|${r.title}|${i}`,
        title: r.title,
        company: r.slug[0].toUpperCase() + r.slug.slice(1),
        country: "US",
        city: "Chicago",
        state: "IL",
        applyUrl: `https://job-boards.greenhouse.io/${r.slug}/jobs/${i}`,
      })),
    ),
  );
}

const targets = async (db: Db, userId: string) =>
  (await db.select().from(schema.targetCompanies).where(eq(schema.targetCompanies.userId, userId))).map((t) => `${t.ats}:${t.slug}`).sort();

describe("starter employers", () => {
  it("new accounts start with no example companies", async () => {
    const { db, userId } = await setup();
    expect(await targets(db, userId)).toEqual([]);
  });

  it("an account without employers of its own gets the best fits once, and loses the old examples", async () => {
    const { db, userId } = await setup();
    await db.insert(schema.targetCompanies).values(SEED_TARGET_COMPANIES.map((c) => ({ ...c, userId })));
    await addJobs(db, [
      { slug: "acme", title: "Data Analyst", n: 3 },
      { slug: "globex", title: "Systems Analyst", n: 1 },
      { slug: "umbrella", title: "Nurse", n: 5 },
    ]);
    // No titles yet: nothing to go on.
    expect(await ensureStarterCompanies(userId, db)).toBe(0);
    await db.update(schema.profiles).set({ titles: ["Data Analyst", "Systems Analyst"], seniority: "entry" }).where(eq(schema.profiles.userId, userId));

    expect(await ensureStarterCompanies(userId, db)).toBe(2);
    expect(await targets(db, userId)).toEqual(["greenhouse:acme", "greenhouse:globex"]);
    const after = await db.query.profiles.findFirst({ where: eq(schema.profiles.userId, userId) });
    expect(after?.starterCompaniesAt).toBeInstanceOf(Date);

    // Once only: removing one later doesn't bring it back.
    await db.delete(schema.targetCompanies).where(eq(schema.targetCompanies.slug, "globex"));
    expect(await ensureStarterCompanies(userId, db)).toBe(0);
    expect(await targets(db, userId)).toEqual(["greenhouse:acme"]);
    // It still shows under "Recommended for you".
    expect((await recommendCompanies(userId, db)).map((r) => r.slug)).toEqual(["globex"]);
  });

  it("leaves an account that picked its own employers alone, even with all of them turned off", async () => {
    const { db, userId } = await setup();
    await db.update(schema.profiles).set({ titles: ["Data Analyst"] }).where(eq(schema.profiles.userId, userId));
    await db.insert(schema.targetCompanies).values({ userId, ats: "workday", slug: "leidos.wd5/External", enabled: false });
    await addJobs(db, [{ slug: "acme", title: "Data Analyst", n: 2 }]);
    expect(await ensureStarterCompanies(userId, db)).toBe(0);
    expect(await targets(db, userId)).toEqual(["workday:leidos.wd5/External"]);
    // Nothing was added, so Settings doesn't claim it was.
    expect((await db.query.profiles.findFirst({ where: eq(schema.profiles.userId, userId) }))?.starterCompaniesAt).toBeNull();
  });

  it("keeps an old example company when it's one of the best fits", async () => {
    const { db, userId } = await setup();
    await db.insert(schema.targetCompanies).values(SEED_TARGET_COMPANIES.map((c) => ({ ...c, userId })));
    await db.update(schema.profiles).set({ titles: ["Data Analyst"] }).where(eq(schema.profiles.userId, userId));
    await addJobs(db, [
      { slug: "stripe", title: "Data Analyst", n: 2 },
      { slug: "acme", title: "Data Analyst", n: 1 },
    ]);
    expect(await ensureStarterCompanies(userId, db)).toBe(2);
    expect(await targets(db, userId)).toEqual(["greenhouse:acme", "greenhouse:stripe"]);
  });

  it("tries again later when nothing fits yet", async () => {
    const { db, userId } = await setup();
    await db.update(schema.profiles).set({ titles: ["Registered Nurse"] }).where(eq(schema.profiles.userId, userId));
    await addJobs(db, [{ slug: "acme", title: "Data Analyst", n: 2 }]);
    expect(await ensureStarterCompanies(userId, db)).toBe(0);
    expect((await db.query.profiles.findFirst({ where: eq(schema.profiles.userId, userId) }))?.starterCompaniesAt).toBeNull();
    await addJobs(db, [{ slug: "mercy", title: "Registered Nurse", n: 1 }]);
    expect(await ensureStarterCompanies(userId, db)).toBe(1);
  });
});
