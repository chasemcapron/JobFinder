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
