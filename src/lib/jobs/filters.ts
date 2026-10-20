import { HIDE_BELOW_SCORE } from "@/components/ui";
import { EXPERIENCE_LEVELS, JOB_SOURCES, type ExperienceLevel, type JobSource } from "@/db/schema";
import { normalizeForKey } from "@/lib/text";
import { countryName } from "./location";
import type { MatchResult } from "./results";

export const POSTED_WITHIN = ["any", "1", "3", "7", "14", "30"] as const;
export type PostedWithin = (typeof POSTED_WITHIN)[number];

export type JobFilters = {
  q: string;
  country: string | null;
  state: string | null;
  city: string | null;
  remote: "any" | "remote" | "onsite";
  levels: ExperienceLevel[];
  sources: JobSource[];
  posted: PostedWithin;
  applied: "dim" | "hide" | "only";
  minScore: number;
  sort: "score" | "date";
  page: number;
};

/**
 * Matches under this score are hidden unless the user asks for them ("Any"). They're kept in
 * the database (and re-ranked as the profile changes) but they're noise, e.g. a credit analyst
 * role for a security analyst.
 */
export const DEFAULT_MIN_SCORE = HIDE_BELOW_SCORE;

export const DEFAULT_FILTERS: JobFilters = {
  q: "",
  country: null,
  state: null,
  city: null,
  remote: "any",
  levels: [],
  sources: [],
  posted: "any",
  applied: "dim",
  minScore: DEFAULT_MIN_SCORE,
  sort: "score",
  page: 1,
};

export const PAGE_SIZE = 50;

type Params = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
function many(v: string | string[] | undefined): string[] {
  if (v == null) return [];
  return (Array.isArray(v) ? v : [v]).flatMap((s) => s.split(",")).filter(Boolean);
}
function pick<T extends string>(v: string | undefined, allowed: readonly T[], fallback: T): T {
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** Parses URL search params into filters, ignoring anything invalid. */
export function parseFilters(params: Params): JobFilters {
  const rawMin = one(params.minScore);
  const minScore = rawMin == null || rawMin === "" ? DEFAULT_MIN_SCORE : Number(rawMin);
  const page = Number(one(params.page));
  return {
    q: (one(params.q) ?? "").trim().slice(0, 200),
    country: one(params.country)?.toUpperCase() || null,
    state: one(params.state) || null,
    city: one(params.city) || null,
    remote: pick(one(params.remote), ["any", "remote", "onsite"] as const, "any"),
    levels: many(params.level).filter((l): l is ExperienceLevel => (EXPERIENCE_LEVELS as readonly string[]).includes(l)),
    sources: many(params.source).filter((s): s is JobSource => (JOB_SOURCES as readonly string[]).includes(s)),
    posted: pick(one(params.posted), POSTED_WITHIN, "any"),
    applied: pick(one(params.applied), ["dim", "hide", "only"] as const, "dim"),
    minScore: Number.isFinite(minScore) ? Math.max(0, Math.min(100, Math.round(minScore))) : DEFAULT_MIN_SCORE,
    sort: pick(one(params.sort), ["score", "date"] as const, "score"),
    page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1,
  };
}

/** The inverse of parseFilters; omits defaults so URLs stay short. */
export function filtersToSearchParams(f: Partial<JobFilters>): URLSearchParams {
  const p = new URLSearchParams();
  const full = { ...DEFAULT_FILTERS, ...f };
  if (full.q) p.set("q", full.q);
  if (full.country) p.set("country", full.country);
  if (full.state) p.set("state", full.state);
  if (full.city) p.set("city", full.city);
  if (full.remote !== "any") p.set("remote", full.remote);
  for (const l of full.levels) p.append("level", l);
  for (const s of full.sources) p.append("source", s);
  if (full.posted !== "any") p.set("posted", full.posted);
  if (full.applied !== "dim") p.set("applied", full.applied);
  if (full.minScore !== DEFAULT_MIN_SCORE) p.set("minScore", String(full.minScore));
  if (full.sort !== "score") p.set("sort", full.sort);
  if (full.page > 1) p.set("page", String(full.page));
  return p;
}

/** Splits a search box value into terms; "quoted phrases" stay together. */
export function searchTerms(q: string): string[] {
  const terms: string[] = [];
  for (const m of q.matchAll(/"([^"]+)"|(\S+)/g)) {
    const t = (m[1] ?? m[2]).trim().toLowerCase();
    if (t) terms.push(t);
  }
  return terms;
}

const eqi = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").toLowerCase() === (b ?? "").toLowerCase();

function postedDate(m: MatchResult): Date {
  return m.job.postedAt ?? m.job.firstSeenAt;
}

/** Applies every filter except pagination. Pure, so it's unit-tested directly. */
export function filterMatches(rows: MatchResult[], f: JobFilters, now = new Date()): MatchResult[] {
  const terms = searchTerms(f.q);
  const postedCutoff = f.posted === "any" ? null : now.getTime() - Number(f.posted) * 86_400_000;
  const out = rows.filter((m) => {
    const j = m.job;
    if (f.applied === "hide" && m.application) return false;
    if (f.applied === "only" && !m.application) return false;
    if (m.score < f.minScore) return false;
    if (f.country && !eqi(j.country, f.country)) return false;
    if (f.state && !eqi(j.state, f.state)) return false;
    if (f.city && !eqi(j.city, f.city)) return false;
    if (f.remote === "remote" && !j.remote) return false;
    if (f.remote === "onsite" && j.remote) return false;
    if (f.levels.length && (!j.experienceLevel || !f.levels.includes(j.experienceLevel))) return false;
    if (f.sources.length && !f.sources.includes(j.source)) return false;
    if (postedCutoff != null && postedDate(m).getTime() < postedCutoff) return false;
    if (terms.length) {
      const hay = `${j.title}\n${j.company}\n${j.locationRaw ?? ""}\n${j.city ?? ""} ${j.state ?? ""} ${countryName(j.country) ?? ""}\n${j.description}`.toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });
  if (f.sort === "date") out.sort((a, b) => postedDate(b).getTime() - postedDate(a).getTime() || b.score - a.score);
  // "score" order comes from the query (score desc, then posted desc)
  return out;
}

export type RoleMatch = MatchResult & {
  /** The same company and title elsewhere, in ranked order. */
  others: MatchResult[];
};

/**
 * One card per role: postings with the same company and title (Workday and USAJobs often list a
 * role once per city) collapse into the first one, which is the best ranked. Order is kept.
 */
export function groupByRole(rows: MatchResult[]): RoleMatch[] {
  const groups = new Map<string, RoleMatch>();
  for (const m of rows) {
    const key = `${normalizeForKey(m.job.company)}|${normalizeForKey(m.job.title)}`;
    const group = groups.get(key);
    if (group) group.others.push(m);
    else groups.set(key, { ...m, others: [] });
  }
  return [...groups.values()];
}

/** Postings first seen this recently count as new. */
export const NEW_FOR_MS = 24 * 3_600_000;

export function isNewMatch(m: MatchResult, now = new Date()): boolean {
  return now.getTime() - m.job.firstSeenAt.getTime() < NEW_FOR_MS;
}

/**
 * Numbers for the summary tiles, counted in roles and leaving out jobs already applied to:
 * new ones worth a look, and strong matches. Before a resume exists nothing is strong.
 */
export function summarizeMatches(rows: MatchResult[], opts: { ranked: boolean; strongAt: number }, now = new Date()) {
  const open = rows.filter((m) => !m.application && (!opts.ranked || m.score >= DEFAULT_MIN_SCORE));
  return {
    newToday: groupByRole(open.filter((m) => isNewMatch(m, now))).length,
    strong: opts.ranked ? groupByRole(open.filter((m) => m.score >= opts.strongAt)).length : 0,
  };
}

export function paginate<T>(rows: T[], page: number, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(page, pages);
  return { items: rows.slice((current - 1) * size, current * size), page: current, pages, total: rows.length };
}

export type FacetOption = { value: string; label: string; count: number };

function countBy(rows: MatchResult[], key: (m: MatchResult) => string | null, label: (v: string) => string = (v) => v): FacetOption[] {
  const counts = new Map<string, number>();
  for (const m of rows) {
    const v = key(m);
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: label(value), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * Options for the location dropdowns. States narrow to the chosen country and cities to the
 * chosen state, so the lists stay short and every option leads somewhere.
 */
export function locationFacets(rows: MatchResult[], f: Pick<JobFilters, "country" | "state">) {
  const inCountry = f.country ? rows.filter((m) => eqi(m.job.country, f.country)) : rows;
  const inState = f.state ? inCountry.filter((m) => eqi(m.job.state, f.state)) : inCountry;
  return {
    countries: countBy(rows, (m) => m.job.country, (c) => countryName(c) ?? c),
    states: countBy(inCountry, (m) => m.job.state),
    cities: countBy(inState, (m) => m.job.city),
  };
}

export function activeFilterCount(f: JobFilters): number {
  return (
    (f.q ? 1 : 0) +
    (f.country ? 1 : 0) +
    (f.state ? 1 : 0) +
    (f.city ? 1 : 0) +
    (f.remote !== "any" ? 1 : 0) +
    (f.levels.length ? 1 : 0) +
    (f.sources.length ? 1 : 0) +
    (f.posted !== "any" ? 1 : 0) +
    (f.applied !== "dim" ? 1 : 0) +
    (f.minScore !== DEFAULT_MIN_SCORE ? 1 : 0)
  );
}
