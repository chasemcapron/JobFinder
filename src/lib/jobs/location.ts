import { CITIES, COUNTRIES, COUNTRY_ALIASES, STANDALONE_COUNTRY_CODES, US_STATE_BY_NAME, US_STATES } from "./geo-data";

export type ParsedLocation = {
  city: string | null;
  state: string | null;
  /** ISO 3166-1 alpha-2 */
  country: string | null;
  remote: boolean;
};

const REMOTE_RE = /\bremote\b|\banywhere\b|work from home|\bwfh\b|\bdistributed\b|\btelework\b/i;
const REGION_WORDS = new Set([
  "europe", "emea", "apac", "latam", "americas", "north america", "south america", "asia", "asia pacific",
  "worldwide", "global", "anywhere", "international", "n/a", "na", "tbd", "various", "multiple locations",
  "european union", "eu", "amer", "location", "middle east", "africa", "nordics", "dach", "home mix",
]);

/** Normalizes a country name/alias/code to ISO alpha-2, or null. */
export function normalizeCountry(input: string | null | undefined): string | null {
  if (!input) return null;
  const v = input.trim();
  if (!v) return null;
  const upper = v.toUpperCase();
  if (upper === "UK") return "GB";
  if (upper.length === 2 && COUNTRIES[upper]) return upper;
  if (upper.length === 3 && upper === "USA") return "US";
  return COUNTRY_ALIASES[v.toLowerCase()] ?? null;
}

export function countryName(code: string | null | undefined): string | null {
  return code ? (COUNTRIES[code] ?? code) : null;
}

function usStateCode(token: string): string | null {
  const t = token.trim();
  if (/^[A-Z]{2}$/.test(t) && US_STATES[t]) return t;
  return US_STATE_BY_NAME[t.toLowerCase()] ?? null;
}

function cleanSegment(segment: string): string {
  return segment
    .replace(/\(([^)]*)\)/g, ", $1") // "Remote (Canada)" -> "Remote , Canada"
    .replace(/\b(fully\s+)?(remote|hybrid|on-?site|in[- ]office)\b(\s+(first|friendly|ok|eligible))?/gi, " ")
    .replace(/\b(hq|headquarters|office)\b/gi, " ")
    .replace(/^\s*(greater)\s+/i, "")
    .replace(/\s+(metro(politan)?\s+)?area\b/i, "")
    .replace(/\s*,\s*(,\s*)+/g, ", ")
    .replace(/^[\s,–—-]+|[\s,–—-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSegment(segment: string): Omit<ParsedLocation, "remote"> | null {
  // "US-Chicago", "IN - Bengaluru", "US-SF" -> token "Chicago" with a country prefix
  let prefixCountry: string | null = null;
  const tokens = segment
    .split(",")
    .map((t) => {
      const m = t.trim().match(/^([A-Z]{2})\s*-\s*(.+)$/);
      const code = m ? normalizeCountry(m[1]) : null;
      if (m && code) {
        prefixCountry ??= code;
        return m[2];
      }
      return t;
    })
    .map((t) => t.replace(/^[\s–—-]+|[\s–—-]+$/g, "").trim())
    .filter((t) => t && !REGION_WORDS.has(t.toLowerCase()));
  if (tokens.length === 0) return prefixCountry ? { city: null, state: null, country: prefixCountry } : null;
  if (prefixCountry) {
    // Prefixed tokens are a list of places in that country, not a City/State/Country hierarchy.
    const first = tokens[0];
    const stateCode = prefixCountry === "US" ? usStateCode(first) : null;
    if (stateCode && !CITIES[first.toLowerCase()]) return { city: null, state: stateCode, country: "US" };
    const known = CITIES[first.toLowerCase()];
    if (known && known[2] === prefixCountry) return { city: known[0], state: known[1], country: prefixCountry };
    return { city: first, state: null, country: prefixCountry };
  }
  // "Japan, Tokyo" / "Ireland, Dublin": country first, city second.
  if (tokens.length === 2 && tokens[0].length > 2 && normalizeCountry(tokens[0]) && !normalizeCountry(tokens[1])) {
    tokens.reverse();
  }

  let country: string | null = null;
  let state: string | null = null;

  // Resolve from the most general end: "City, State, Country".
  const last = tokens[tokens.length - 1];
  const lastState = tokens.length > 1 ? usStateCode(last) : null;
  if (lastState) {
    state = lastState;
    country = "US";
    tokens.pop();
  } else {
    const c =
      tokens.length > 1 || last.length > 2 || STANDALONE_COUNTRY_CODES.has(last.toUpperCase())
        ? normalizeCountry(last)
        : null;
    if (c) {
      country = c;
      tokens.pop();
      if (tokens.length >= 2) {
        // "Austin, Texas, US" has a region; "Seattle, Chicago, US" is just a list of cities.
        const region = tokens[tokens.length - 1];
        const isRegion = country === "US" ? Boolean(usStateCode(region)) : !CITIES[region.toLowerCase()];
        if (isRegion) {
          tokens.pop();
          state = country === "US" ? usStateCode(region) : region;
        }
      }
    }
  }

  if (tokens.length === 0) {
    // City-states: "Singapore", "Hong Kong" are both the country and the city.
    const cityState = CITIES[last.toLowerCase()];
    const city = cityState && cityState[2] === country && !state ? cityState[0] : null;
    return { city, state, country };
  }

  let city: string | null = tokens[0];
  // A lone US state name ("California"), or a state code once we know it's the US ("US-CA").
  if (!state && tokens.length === 1 && (!country || country === "US")) {
    const s = US_STATE_BY_NAME[city.toLowerCase()] ?? (country === "US" ? usStateCode(city) : null);
    if (s && !CITIES[city.toLowerCase()]) return { city: null, state: s, country: "US" };
  }

  const known = CITIES[city.toLowerCase()] ?? CITIES[city.toLowerCase().replace(/\s+bay$/, "")];
  if (known && (!country || country === known[2]) && (!state || country !== "US" || state === known[1])) {
    city = known[0];
    state ??= known[1];
    country ??= known[2];
  } else if (city.toLowerCase().includes("bay")) {
    const sf = CITIES["san francisco"];
    if (/san francisco|sf bay|bay area/i.test(city)) [city, state, country] = [sf[0], state ?? sf[1], country ?? sf[2]];
  }
  return { city, state, country };
}

/**
 * Parses free-form posting locations such as "San Francisco, CA • New York, NY",
 * "Remote (Canada)", "US-Remote", "London, England", or "NYC, SF". When a posting
 * lists several places, the first parseable one becomes city/state/country.
 */
export function parseLocation(
  raw: string | null | undefined,
  hints: { country?: string | null; remote?: boolean } = {},
): ParsedLocation {
  const hintCountry = normalizeCountry(hints.country);
  const text = (raw ?? "").trim();
  const remote = Boolean(hints.remote) || REMOTE_RE.test(text);
  if (!text) return { city: null, state: null, country: hintCountry, remote };

  const segments = text.split(/\s*(?:•|·|;|\||\s\/\s|\s+or\s+|\s+and\s+)\s*/i);
  for (const seg of segments) {
    const cleaned = cleanSegment(seg);
    if (!cleaned) continue;
    const parsed = parseSegment(cleaned);
    if (parsed && (parsed.city || parsed.state || parsed.country)) {
      return { ...parsed, country: parsed.country ?? hintCountry, remote };
    }
  }
  return { city: null, state: null, country: hintCountry, remote };
}

/** "Chicago, IL, US" style display string. */
export function formatLocation(loc: { city: string | null; state: string | null; country: string | null; remote: boolean }, raw?: string | null): string {
  const parts = [loc.city, loc.state, loc.country && loc.country !== "US" ? countryName(loc.country) : loc.city || loc.state ? null : countryName(loc.country)].filter(Boolean);
  const place = parts.join(", ");
  if (loc.remote) return place ? `Remote · ${place}` : "Remote";
  return place || raw || "Location not listed";
}

/** The app only looks for jobs in the United States. */
export const TARGET_COUNTRY = "US";

/**
 * True for US jobs and for jobs whose country couldn't be parsed. Unparsed ones are kept on
 * purpose: in practice they are US postings the parser misses ("Remote in the US", "NYC-HQ",
 * "US-Remote, Chicago", or "N/A"), and dropping them would lose real matches.
 */
export function isInTargetCountry(job: { country: string | null }): boolean {
  return job.country === null || job.country === TARGET_COUNTRY;
}
