export function formatSalary(min: number | null, max: number | null, currency: string | null): string | null {
  if (min == null && max == null) return null;
  const fmt = (n: number) => {
    const symbol = currency === "USD" || !currency ? "$" : currency === "GBP" ? "£" : currency === "EUR" ? "€" : `${currency} `;
    return n >= 1000 ? `${symbol}${Math.round(n / 1000)}k` : `${symbol}${n}`;
  };
  if (min != null && max != null && min !== max) return `${fmt(min)}–${fmt(max)}`;
  return fmt((min ?? max)!);
}

/** "today", "3d ago", "2w ago", "Mar 4" */
export function formatRelativeDate(date: Date | null, now = new Date()): string | null {
  if (!date) return null;
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 35) return `${Math.floor(days / 7)}w ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: days > 300 ? "numeric" : undefined });
}

export function formatDateTime(date: Date): string {
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
    timeZoneName: "short",
  });
}
