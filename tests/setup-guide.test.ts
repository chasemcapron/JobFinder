import { describe, expect, it } from "vitest";
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
