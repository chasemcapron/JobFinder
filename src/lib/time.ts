export const APP_TIME_ZONE = "America/Chicago";

/** YYYY-MM-DD in the given time zone. */
export function localDate(date: Date, timeZone = APP_TIME_ZONE): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** 0-23 hour in the given time zone (handles daylight saving). */
export function localHour(date: Date, timeZone = APP_TIME_ZONE): number {
  const hour = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(date);
  return Number(hour) % 24;
}

/** How far the zone's clock is ahead of UTC at that moment, in ms (-5 h for Chicago in summer). */
function zoneOffsetMs(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(at);
  const n = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour") % 24, n("minute")) - Math.floor(at / 60_000) * 60_000;
}

/**
 * The moment it's `hour`:00 on a YYYY-MM-DD date in the given time zone. The offset is read twice
 * because it can change between midnight and that hour (daylight saving starts and ends at 2 AM).
 */
export function atLocalHour(date: string, hour: number, timeZone = APP_TIME_ZONE): Date {
  const [y, m, d] = date.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, hour);
  let at = wall - zoneOffsetMs(wall, timeZone);
  at = wall - zoneOffsetMs(at, timeZone);
  return new Date(at);
}
