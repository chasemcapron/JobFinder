import { describe, expect, it } from "vitest";
import { createPglite, schema } from "@/db";
import { countChosenTargetCompanies, ensureProfile } from "@/lib/profile";
import { setupComplete, setupSteps, type SetupInput } from "@/lib/setup";

const fresh: SetupInput = {
  resumeText: null,
  titles: [],
  preferredLocations: [],
  experienceLevels: [],
  remotePreference: "any",
  enabledCompanies: 0,
  sheetId: null,
  searched: false,
};

describe("setup guide", () => {
  it("lists every step undone for a new user, and the sheet as optional", () => {
    const steps = setupSteps(fresh);
    expect(steps.map((s) => [s.id, s.done])).toEqual([
      ["resume", false],
      ["titles", false],
      ["preferences", false],
      ["companies", false],
      ["sheet", false],
      ["search", false],
    ]);
    expect(steps.find((s) => s.id === "sheet")?.optional).toBe(true);
    expect(setupComplete(steps)).toBe(false);
  });

  it("is complete once the required steps are done, with or without a sheet", () => {
    const ready: SetupInput = {
      ...fresh,
      resumeText: "Analyst with SQL",
      titles: ["Data Analyst"],
      remotePreference: "remote_only",
      enabledCompanies: 3,
      searched: true,
    };
    expect(setupComplete(setupSteps(ready))).toBe(true);
    expect(setupComplete(setupSteps({ ...ready, searched: false }))).toBe(false);
    // Any one preference counts as set.
    expect(setupSteps({ ...fresh, preferredLocations: ["Austin, TX"] }).find((s) => s.id === "preferences")?.done).toBe(true);
    expect(setupSteps({ ...fresh, resumeText: "   " }).find((s) => s.id === "resume")?.done).toBe(false);
  });
});

describe("setup guide: employers", () => {
  it("doesn't count the example companies every new account starts with", async () => {
    const db = await createPglite("memory://");
    const [u] = await db.insert(schema.users).values({ email: "new@example.com" }).returning();
    await ensureProfile(u.id, db);
    expect(await countChosenTargetCompanies(u.id, db)).toBe(0);
    await db.insert(schema.targetCompanies).values({ userId: u.id, ats: "workday", slug: "leidos.wd5/External" });
    expect(await countChosenTargetCompanies(u.id, db)).toBe(1);
  });
});
