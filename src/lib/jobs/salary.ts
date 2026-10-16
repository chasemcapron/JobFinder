export type SalaryRange = { min: number | null; max: number | null; currency: string | null };

const CURRENCY_SYMBOLS: Record<string, string> = { $: "USD", "£": "GBP", "€": "EUR", "₹": "INR", "¥": "JPY" };
const HOURS_PER_YEAR = 2080;

function toNumber(num: string, suffix: string | undefined): number {
  const n = Number(num.replace(/,/g, ""));
  return /k/i.test(suffix ?? "") ? n * 1000 : n;
}

/** Converts an amount at a given pay interval to annual; null for unknown intervals. */
export function annualize(amount: number | null | undefined, interval: string | null | undefined): number | null {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return null;
  const i = (interval ?? "year").toLowerCase();
  if (/year|annual|\bpa\b|^pa$|per-year/.test(i)) return Math.round(amount);
  if (/month|^pm$/.test(i)) return Math.round(amount * 12);
  if (/hour|^ph$/.test(i)) return Math.round(amount * HOURS_PER_YEAR);
  if (/week|^pw$/.test(i)) return Math.round(amount * 52);
  if (/day|^pd$/.test(i)) return Math.round(amount * 260);
  return null;
}

const RANGE_RE =
  /([$£€₹])\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([kK])?\s*(?:[-–—]|to)\s*(?:[$£€₹]|USD|GBP|EUR)?\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([kK])?(?:\s*(?:USD|CAD|GBP|EUR))?(\s*(?:\/|per)\s*(?:hour|hr|year|yr|annum))?/;

/**
 * Finds a pay range like "$165,000 — $245,000", "$211.4K – $290.6K", or "$45 - $60/hr"
 * in posting text. Returns annual values, or nulls when no plausible range is found.
 */
export function parseSalaryFromText(text: string): SalaryRange {
  const m = text.match(RANGE_RE);
  if (!m) return { min: null, max: null, currency: null };
  const [whole, symbol, a, aK, b, bK, per] = m;
  // "$20 - $30 million" is funding, not pay.
  const after = text.slice((m.index ?? 0) + whole.length, (m.index ?? 0) + whole.length + 12);
  if (/^\s*(m\b|mm\b|million|b\b|bn\b|billion)/i.test(after)) return { min: null, max: null, currency: null };
  const hourly = per ? /hour|hr/i.test(per) : false;
  let min = toNumber(a, aK ?? bK);
  let max = toNumber(b, bK);
  if (hourly) {
    min *= HOURS_PER_YEAR;
    max *= HOURS_PER_YEAR;
  }
  if (min > max) [min, max] = [max, min];
  // Reject numbers that clearly aren't salaries (headcounts, funding, etc.).
  if (min < 10_000 || max > 3_000_000) return { min: null, max: null, currency: null };
  return { min: Math.round(min), max: Math.round(max), currency: CURRENCY_SYMBOLS[symbol] ?? null };
}
