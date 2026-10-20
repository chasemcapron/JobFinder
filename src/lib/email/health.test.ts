import { describe, expect, it } from "vitest";
import { morningRunStatus, type MorningRunInput } from "./health";

// July: Chicago is UTC-5, so 12:04 UTC is 7:04 AM CDT.
const at = (utc: string) => new Date(`2026-07-01T${utc}Z`);
const run = (utc: string, status = "ok"): MorningRunInput["lastRun"] => ({ startedAt: at(utc), status, jobsFetched: 1145, error: null });
const base: MorningRunInput = { now: at("15:00:00"), emailEnabled: true, lastDigestDate: null, lastRun: null, lastEmail: null };

describe("morningRunStatus", () => {
  it("reports today's run: when, how much it searched, and what it emailed", () => {
    const s = morningRunStatus({ ...base, lastDigestDate: "2026-07-01", lastRun: run("12:04:00"), lastEmail: { sentAt: at("12:05:00"), jobs: 10 } });
    expect(s.state).toBe("ran");
    expect(s.note).toMatch(/^Ran Jul 1, 7:04\sAM CDT: searched 1,145 postings, emailed 10 matches\.$/);
  });

  it("says so when the run found nothing new to email, or had errors", () => {
    // The last email went out yesterday, so today's run had nothing new.
    const s = morningRunStatus({
      ...base,
      lastDigestDate: "2026-07-01",
      lastRun: run("12:04:00", "partial"),
      lastEmail: { sentAt: new Date("2026-06-30T12:05:00Z"), jobs: 3 },
    });
    expect(s.note).toMatch(/with errors: searched 1,145 postings, no new matches to email\.$/);
  });

  it("shows a run in progress", () => {
    const s = morningRunStatus({ ...base, now: at("12:04:30"), lastDigestDate: "2026-07-01", lastRun: run("12:04:00", "running") });
    expect(s).toMatchObject({ state: "ran" });
    expect(s.note).toMatch(/^Running now/);
  });

  it("waits until the 7 AM hour is over", () => {
    expect(morningRunStatus({ ...base, now: at("11:30:00") }).state).toBe("scheduled"); // 6:30 AM
    expect(morningRunStatus({ ...base, now: at("12:59:00") }).state).toBe("scheduled"); // 7:59 AM
  });

  it("flags a missed morning from 8 AM, naming the last automatic run", () => {
    const yesterday = { startedAt: new Date("2026-06-30T12:04:00Z"), status: "ok", jobsFetched: 900, error: null };
    const s = morningRunStatus({ ...base, now: at("13:00:00"), lastDigestDate: "2026-06-30", lastRun: yesterday });
    expect(s.state).toBe("missed");
    expect(s.note).toMatch(/^This morning's run didn't happen \(last automatic run Jun 30, 7:04\sAM CDT\)\.$/);
    expect(morningRunStatus({ ...base, now: at("13:00:00") }).note).toContain("no automatic run yet");
  });

  it("is off when the email is turned off", () => {
    expect(morningRunStatus({ ...base, emailEnabled: false }).state).toBe("off");
  });
});
