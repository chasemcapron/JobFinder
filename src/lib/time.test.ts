import { describe, expect, it } from "vitest";
import { atLocalHour, localDate, localHour } from "./time";

describe("atLocalHour", () => {
  it("finds 7 AM Chicago time in summer and winter", () => {
    expect(atLocalHour("2026-07-01", 7)).toEqual(new Date("2026-07-01T12:00:00Z")); // CDT, UTC-5
    expect(atLocalHour("2026-12-01", 7)).toEqual(new Date("2026-12-01T13:00:00Z")); // CST, UTC-6
  });

  it("is right on the days daylight saving starts and ends (the switch is at 2 AM)", () => {
    expect(atLocalHour("2026-11-01", 7)).toEqual(new Date("2026-11-01T13:00:00Z")); // fell back overnight
    expect(atLocalHour("2027-03-14", 7)).toEqual(new Date("2027-03-14T12:00:00Z")); // sprang forward overnight
  });

  it("round-trips through localDate and localHour, in other zones too", () => {
    for (const date of ["2026-01-15", "2026-03-08", "2026-06-30", "2026-11-01"]) {
      for (const tz of ["America/Chicago", "America/New_York", "America/Los_Angeles", "UTC"]) {
        const at = atLocalHour(date, 7, tz);
        expect(localDate(at, tz)).toBe(date);
        expect(localHour(at, tz)).toBe(7);
        expect(at.getUTCMinutes()).toBe(0);
      }
    }
  });
});
