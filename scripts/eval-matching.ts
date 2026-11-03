/**
 * Matching eval: measures how well the ranking puts the jobs the user would apply to on top.
 * Everything it writes goes to eval-data/ (git-ignored: it holds the user's resume and labels).
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/eval-matching.ts sample [--email you@x.com] [--seed 7]
 *     Freezes the profile, every current match (the "pool") and ~45 sampled roles (the "fixture").
 *   ... show                       Prints the fixture as a numbered list to label.
 *   ... label "1g 2b 3m 4-6 b"     Saves labels (g good, m maybe, b bad) by the shown numbers.
 *   ... run --mode baseline|keyword|pipeline [--tag name] [--cap 40] [--score holistic] [--explain]
 *     baseline: the scores stored when sampled. keyword: today's keyword matcher.
 *     pipeline: today's full ranking (rankCandidates) over the frozen pool, AI answers cached on
 *     disk so re-runs are free and repeatable.
 *   ... report                     Compares saved runs.
 *
 * Runs on the frozen pool, so later searches, pruning and profile edits don't move the numbers.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, count, eq, gt, isNotNull } from "drizzle-orm";
import { getDb } from "@/db";
import { applications, jobMatches, jobs, profiles, users, type Profile } from "@/db/schema";
import { toGeminiSchema } from "@/lib/ai/gemini";
import { aiJson } from "@/lib/ai/provider";
import { redactPersonalInfo } from "@/lib/ai/redact";
import { parseLabelInput, rankingMetrics, recall, type Label, type RankingMetrics } from "@/lib/eval/metrics";
import type { AiJsonFn } from "@/lib/jobs/ai-score";
import { DEFAULT_MIN_SCORE } from "@/lib/jobs/filters";
import { formatLocation, isInTargetCountry } from "@/lib/jobs/location";
import { roleKey } from "@/lib/jobs/normalize";
import { finalMatch, rankCandidates, type JobForScoring } from "@/lib/jobs/rank";
import { STALE_AFTER_DAYS } from "@/lib/jobs/results";
import { titleSimilarity } from "@/lib/jobs/scoring";

const DIR = path.join(process.cwd(), "eval-data");
const FILES = {
  profile: path.join(DIR, "profile.json"),
  pool: path.join(DIR, "pool.json"),
  fixture: path.join(DIR, "fixture.json"),
  order: path.join(DIR, "label-order.json"),
  labels: path.join(DIR, "labels.json"),
  aiCache: path.join(DIR, "ai-cache"),
  runs: path.join(DIR, "runs"),
};
/** The Jobs page hides scores under this by default. */
const VISIBLE_FROM = DEFAULT_MIN_SCORE;
/**
 * Roles the AI evaluates: by default one search's cap (production's default with a Gemini key).
 * `--cap 120` matches what's evaluated by the morning email: the 09:00 search (40) plus the
 * 10:00 backlog run (BACKLOG_CAP, 80). Fixed rather than read from env, so a re-run builds the
 * same batches and hits the cache.
 */
const EVAL_AI_CAP = 40;
/** Free-tier Gemini allows a handful of requests a minute: one new call per 4.5 s stays well under. */
const AI_SPACING_MS = 4_500;
/** Titles in the user's current field (entry-level IT, data, systems), used to find likely misses. */
const FIELD_HINT = /(\bit\b|data|system|help ?desk|service desk|desktop|technical support|reporting|business intelligence|\bbi\b|database|network)/i;

type PoolJob = JobForScoring & {
  id: string;
  key: string;
  dedupeKey: string;
  applyUrl: string;
  postedAt: string | null;
  stored: { score: number; keywordScore: number; aiScored: boolean; reasons: string };
  applied: boolean;
};
type Snapshot = { sampledAt: string; userName: string | null; profile: Profile };
type FixtureItem = { key: string; jobId: string; bucket: "top20" | "mid" | "dropped" | "applied"; baselineRank: number };
type RunFile = {
  tag: string;
  mode: string;
  at: string;
  metrics: RankingMetrics;
  prefilterRecall: number | null;
  /** Labeled roles the Jobs page shows by default (not skipped, not under the weak cut-off). */
  visible?: Record<Label, number>;
  /** The same metrics over only what's shown, in order. */
  shownMetrics?: RankingMetrics;
  aiCalls: number;
  /** AI errors (rate limit, out of time): the run is partial and its numbers aren't comparable. */
  errors: string[];
  ranking: { key: string; score: number; ai: boolean; skip?: boolean; label: Label | null }[];
};

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}
async function writeJson(file: string, data: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2));
}
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/** Small seeded RNG (mulberry32), so a sample can be redrawn exactly. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(items: T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------------------------------------------------------------- sample

async function sample() {
  const db = await getDb();
  const email = arg("email");
  const seed = Number(arg("seed") ?? 7);
  const rand = rng(seed);

  // The user: by email, else the one with a resume and the most matches.
  const candidates = await db
    .select({ id: users.id, name: users.name, email: users.email, matches: count(jobMatches.id) })
    .from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .leftJoin(jobMatches, eq(jobMatches.userId, users.id))
    .where(isNotNull(profiles.resumeText))
    .groupBy(users.id, users.name, users.email);
  const user = email
    ? candidates.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    : candidates.sort((a, b) => b.matches - a.matches)[0];
  if (!user) throw new Error(email ? `No user ${email} with a saved resume.` : "No user with a saved resume found.");
  const profile = await db.query.profiles.findFirst({ where: eq(profiles.userId, user.id) });
  if (!profile?.resumeText) throw new Error("That user has no saved resume.");

  const staleBefore = new Date(Date.now() - STALE_AFTER_DAYS * 86_400_000);
  const rows = await db
    .select({
      id: jobs.id,
      dedupeKey: jobs.dedupeKey,
      source: jobs.source,
      title: jobs.title,
      company: jobs.company,
      description: jobs.description,
      city: jobs.city,
      state: jobs.state,
      country: jobs.country,
      remote: jobs.remote,
      locationRaw: jobs.locationRaw,
      experienceLevel: jobs.experienceLevel,
      minYears: jobs.minYears,
      clearance: jobs.clearance,
      applyUrl: jobs.applyUrl,
      postedAt: jobs.postedAt,
      score: jobMatches.score,
      keywordScore: jobMatches.keywordScore,
      aiScored: jobMatches.aiScored,
      reasons: jobMatches.reasons,
      applicationId: applications.id,
    })
    .from(jobMatches)
    .innerJoin(jobs, eq(jobs.id, jobMatches.jobId))
    .leftJoin(applications, and(eq(applications.jobId, jobs.id), eq(applications.userId, user.id)))
    .where(and(eq(jobMatches.userId, user.id), gt(jobs.lastSeenAt, staleBefore)));

  const pool: PoolJob[] = rows.filter(isInTargetCountry).map((r) => ({
    id: r.id,
    key: roleKey(r),
    dedupeKey: r.dedupeKey,
    source: r.source,
    title: r.title,
    company: r.company,
    description: r.description,
    city: r.city,
    state: r.state,
    country: r.country,
    remote: r.remote,
    locationRaw: r.locationRaw,
    experienceLevel: r.experienceLevel,
    minYears: r.minYears,
    clearance: r.clearance,
    applyUrl: r.applyUrl,
    postedAt: r.postedAt?.toISOString() ?? null,
    stored: { score: r.score, keywordScore: r.keywordScore, aiScored: r.aiScored, reasons: r.reasons },
    applied: Boolean(r.applicationId),
  }));

  // Roles in the order the Jobs page shows them (score, then newest; Postgres puts a missing
  // date first when sorting descending), one card per role.
  const sorted = [...pool].sort(
    (a, b) => b.stored.score - a.stored.score || (b.postedAt ?? "\uffff").localeCompare(a.postedAt ?? "\uffff"),
  );
  const roles: PoolJob[] = [];
  const seen = new Set<string>();
  for (const j of sorted) {
    if (seen.has(j.key)) continue;
    seen.add(j.key);
    roles.push(j);
  }
  const rankOf = new Map(roles.map((r, i) => [r.key, i + 1]));
  const visible = roles.filter((r) => r.stored.score >= VISIBLE_FROM);

  const picked = new Map<string, FixtureItem>();
  const perCompany = new Map<string, number>();
  const take = (r: PoolJob, bucket: FixtureItem["bucket"], cap: boolean) => {
    if (picked.has(r.key)) return false;
    // At most 3 per company outside the top 20 (top-20 picks don't count against it).
    const n = perCompany.get(r.company) ?? 0;
    if (cap && n >= 3) return false;
    if (cap) perCompany.set(r.company, n + 1);
    picked.set(r.key, { key: r.key, jobId: r.id, bucket, baselineRank: rankOf.get(r.key)! });
    return true;
  };
  // 1. Exactly what the user sees on top today: where "bad in the top 20" is measured.
  for (const r of visible.slice(0, 20)) take(r, "top20", false);
  // 2. The middle of the list.
  let n = 0;
  for (const r of shuffle(visible.slice(20, 100), rand)) if (n < 10 && take(r, "mid", true)) n++;
  // 3. Likely good jobs ranked low or hidden: the matcher's misses.
  const terms = [...profile.titles, ...profile.searchKeywords];
  const dropped = roles.filter(
    (r) =>
      (rankOf.get(r.key)! > 100 || r.stored.score < VISIBLE_FROM) &&
      (FIELD_HINT.test(r.title) || terms.some((t) => titleSimilarity(t, r.title) >= 0.3)),
  );
  n = 0;
  for (const r of shuffle(dropped, rand)) if (n < 10 && take(r, "dropped", true)) n++;
  // 4. Jobs already applied to.
  n = 0;
  for (const r of roles.filter((r) => r.applied)) if (n < 5 && take(r, "applied", false)) n++;

  const fixture = [...picked.values()];
  const order = shuffle(fixture.map((f) => f.key), rand);
  await writeJson(FILES.profile, { sampledAt: new Date().toISOString(), userName: user.name, profile } satisfies Snapshot);
  await writeJson(FILES.pool, pool);
  await writeJson(FILES.fixture, fixture);
  await writeJson(FILES.order, order);
  console.log(
    `Pool: ${pool.length} postings in ${roles.length} roles (${visible.length} visible). Fixture: ${fixture.length} roles ` +
      `(${["top20", "mid", "dropped", "applied"].map((b) => `${b} ${fixture.filter((f) => f.bucket === b).length}`).join(", ")}).`,
  );
  process.exit(0);
}

// ---------------------------------------------------------------- show / label

/** One line on what the job is: the first sentence that describes the role, not the company. */
function oneLine(description: string): string {
  const sentences = description
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 40 && s.length <= 400);
  const role = sentences.find((s) =>
    /\b(you will|you'll|will be|responsible for|this role|the role|this position|the position|we are seeking|looking for|seeking an?|is seeking|provides?|supports?)\b/i.test(s),
  );
  const line = role ?? sentences[0] ?? description.slice(0, 160);
  return line.length > 170 ? `${line.slice(0, 167)}…` : line;
}

async function show() {
  const pool = await readJson<PoolJob[]>(FILES.pool);
  const order = await readJson<string[]>(FILES.order);
  const labels = await readLabels();
  const byKey = new Map<string, PoolJob>();
  for (const j of pool) if (!byKey.has(j.key)) byKey.set(j.key, j);
  order.forEach((key, i) => {
    const j = byKey.get(key)!;
    const facts = [
      formatLocation(j, j.locationRaw),
      j.experienceLevel,
      j.minYears ? `${j.minYears}+ yrs` : null,
      j.clearance ? `clearance: ${j.clearance}` : null,
    ].filter(Boolean);
    const label = labels[key] ? ` [${labels[key]}]` : "";
    console.log(`${i + 1}. ${j.title} — ${j.company} (${facts.join(", ")})${label}\n   ${oneLine(j.description)}`);
  });
  process.exit(0);
}

async function readLabels(): Promise<Record<string, Label>> {
  try {
    return (await readJson<{ labels: Record<string, Label> }>(FILES.labels)).labels;
  } catch {
    return {};
  }
}

async function label() {
  const input = process.argv.slice(3).join(" ");
  const order = await readJson<string[]>(FILES.order);
  const labels = await readLabels();
  for (const [n, l] of parseLabelInput(input)) {
    const key = order[n - 1];
    if (!key) throw new Error(`There is no posting #${n} (1-${order.length}).`);
    labels[key] = l;
  }
  await writeJson(FILES.labels, { version: 1, labels });
  const missing = order.map((k, i) => (labels[k] ? null : i + 1)).filter(Boolean);
  console.log(`Saved ${Object.keys(labels).length}/${order.length} labels.${missing.length ? ` Unlabeled: ${missing.join(", ")}` : ""}`);
  process.exit(0);
}

// ---------------------------------------------------------------- run / report

/** aiJson with answers cached on disk (keyed by the exact request) and calls spaced out. */
function cachedAi(stats: { calls: number; hits: number; prompt: number; cached: number }): AiJsonFn {
  let nextSlot = 0;
  const fn = async (opts: Parameters<AiJsonFn>[0]) => {
    const hash = createHash("sha256")
      .update(JSON.stringify({ system: opts.system, prompt: opts.prompt, schema: toGeminiSchema(opts.schema), tier: opts.tier }))
      .digest("hex");
    const file = path.join(FILES.aiCache, `${hash}.json`);
    try {
      const hit = await readJson<Awaited<ReturnType<AiJsonFn>>>(file);
      const data = opts.schema.parse(hit.data);
      stats.hits++;
      return { ...hit, data };
    } catch {
      // not cached yet
    }
    const wait = Math.max(0, nextSlot - Date.now());
    nextSlot = Math.max(Date.now(), nextSlot) + AI_SPACING_MS;
    await new Promise((r) => setTimeout(r, wait));
    const res = await aiJson({ ...opts, deadline: Date.now() + 90_000 });
    stats.calls++;
    stats.prompt += res.usage?.prompt ?? 0;
    stats.cached += res.usage?.cached ?? 0;
    await writeJson(file, res);
    return res;
  };
  return fn as AiJsonFn;
}

async function run() {
  const mode = arg("mode") ?? "pipeline";
  const tag = arg("tag") ?? mode;
  const { profile, userName } = await readJson<Snapshot>(FILES.profile);
  profile.matchingUpdatedAt = new Date(profile.matchingUpdatedAt);
  // Settings added after the snapshot was taken (set them in profile.json to match the user's).
  profile.avoidMilitary ??= false;
  const pool = await readJson<PoolJob[]>(FILES.pool);
  const labels = await readLabels();
  if (Object.keys(labels).length === 0) throw new Error("No labels yet: run `show`, then `label`.");

  // Score per posting; a role's score is its best posting's, as on the Jobs page.
  const scored = new Map<string, { score: number; ai: boolean; skip: boolean }>();
  const aiIds = new Set<string>();
  const stats = { calls: 0, hits: 0, prompt: 0, cached: 0 };
  let selectedKeys: Set<string> | null = null;
  const errors: string[] = [];
  const byHolistic = arg("score") === "holistic";
  if (mode === "baseline") {
    for (const j of pool) scored.set(j.id, { score: j.stored.score, ai: j.stored.aiScored, skip: false });
  } else if (mode === "keyword" || mode === "pipeline") {
    // As after a profile change: nothing is fresh. Keyword mode is the same pipeline without AI
    // (the fixed rules still apply), so both drop excluded titles the way production does.
    const all = new Map(pool.map((j) => [j.id, j as JobForScoring]));
    const result = await rankCandidates(profile, all, {
      isFresh: () => false,
      cap: Number(arg("cap") ?? EVAL_AI_CAP),
      useAi: mode === "pipeline",
      deadline: Date.now() + 15 * 60_000,
      resume: profile.resumeText ? redactPersonalInfo(profile.resumeText, { names: [userName] }) : null,
      ai: cachedAi(stats),
      // cachedAi spaces real calls itself; cache hits needn't wait.
      spacingMs: 0,
    });
    errors.push(...result.errors);
    if (process.argv.includes("--explain")) {
      // Why each labeled role got its verdict (cached answers, so free to repeat).
      const shown = new Set<string>();
      for (const c of result.candidates) {
        const key = roleKey(c.job);
        const ai = result.aiScores.get(c.id);
        if (!labels[key] || shown.has(key) || (!ai && !c.blockers.length)) continue;
        shown.add(key);
        const e = ai?.evaluation;
        console.log(
          `[${labels[key]}] ${c.job.title} — ${c.job.company}\n   ` +
            (e
              ? `${ai.verdict} ${ai.score} | role ${e.roleFit}, level ${e.seniorityFit}, skills ${e.skillsCoverage}, location ${e.locationFit} | holistic ${e.holistic}` +
                `${e.blockers.length ? ` | blockers: ${e.blockers.join("; ")}` : ""}\n   ${ai.reason}`
              : `rule skip: ${c.blockers.join("; ")}`),
        );
      }
    }
    for (const c of result.candidates) {
      const ai = result.aiScores.get(c.id);
      const final = finalMatch(c, ai);
      // --score holistic: the model's own number; --score keyword: AI verdicts (skips hide) but keyword order.
      const score =
        byHolistic && ai?.evaluation.holistic !== undefined ? ai.evaluation.holistic : arg("score") === "keyword" ? c.kw.score : final.score;
      scored.set(c.id, { score, ai: final.aiScored, skip: final.verdict === "skip" });
      if (ai) aiIds.add(c.id);
    }
    if (mode === "pipeline") selectedKeys = new Set(pool.filter((j) => aiIds.has(j.id)).map((j) => j.key));
  } else {
    throw new Error(`Unknown mode "${mode}"`);
  }

  // Jobs marked "do not apply" are hidden on the Jobs page, so they rank below everything shown.
  const roleScore = new Map<string, { score: number; ai: boolean; skip: boolean }>();
  for (const j of pool) {
    const s = scored.get(j.id);
    if (!s) continue; // excluded by the profile
    const prev = roleScore.get(j.key);
    if (!prev || (prev.skip && !s.skip) || (prev.skip === s.skip && s.score > prev.score)) roleScore.set(j.key, s);
  }
  const ranking = [...roleScore.entries()]
    .sort((a, b) => Number(a[1].skip) - Number(b[1].skip) || b[1].score - a[1].score || a[0].localeCompare(b[0]))
    .map(([key, s]) => ({ key, score: s.score, ai: s.ai, skip: s.skip, label: labels[key] ?? null }));
  const metrics = rankingMetrics(
    ranking.map((r) => r.key),
    labels,
  );
  // What the Jobs page shows by default: not marked do-not-apply, and not under the weak cut-off.
  const shown = ranking.filter((r) => r.label && !r.skip && r.score >= VISIBLE_FROM);
  const visible = { good: 0, maybe: 0, bad: 0 };
  for (const r of shown) visible[r.label!]++;
  const shownMetrics = rankingMetrics(
    shown.map((r) => r.key),
    labels,
  );
  const out: RunFile = {
    tag,
    mode,
    at: new Date().toISOString(),
    metrics,
    visible,
    shownMetrics,
    prefilterRecall: selectedKeys ? recall(selectedKeys, labels) : null,
    aiCalls: stats.calls,
    errors,
    ranking: ranking.filter((r) => r.label),
  };
  await writeJson(path.join(FILES.runs, `${out.at.replace(/[:.]/g, "-")}-${tag}.json`), out);
  printRun(out);
  if (mode === "pipeline") {
    console.log(
      `AI: ${stats.calls} new call(s), ${stats.hits} cached; prompt tokens ${stats.prompt}, of which Gemini-cached ${stats.cached}.`,
    );
  }
  process.exit(0);
}

function printRun(r: RunFile) {
  const m = r.metrics;
  if (r.errors?.length) console.log(`PARTIAL (not comparable): ${r.errors.join("; ")}`);
  console.log(
    `${r.tag} (${r.mode}): labeled ${m.labeled} (good ${m.good}, maybe ${m.maybe}, bad ${m.bad}) | ` +
      `P@10 ${m.p10} (lenient ${m.p10Lenient}) | P@20 ${m.p20} (lenient ${m.p20Lenient}) | ` +
      `bad in top 10 ${m.badInTop10}, top 20 ${m.badInTop20} | nDCG@20 ${m.ndcg20}` +
      (r.prefilterRecall === null ? "" : ` | good roles AI-scored ${r.prefilterRecall}`) +
      (r.visible ? `
   shown by default: good ${r.visible.good}, maybe ${r.visible.maybe}, bad ${r.visible.bad}` : "") +
      (r.shownMetrics
        ? ` | top 10 shown: P@10 ${r.shownMetrics.p10} (lenient ${r.shownMetrics.p10Lenient}), bad ${r.shownMetrics.badInTop10}`
        : ""),
  );
}

async function report() {
  const files = (await readdir(FILES.runs).catch(() => [] as string[])).filter((f) => f.endsWith(".json")).sort();
  for (const f of files) printRun(await readJson<RunFile>(path.join(FILES.runs, f)));
  process.exit(0);
}

const commands: Record<string, () => Promise<void>> = { sample, show, label, run, report };
const command = commands[process.argv[2] ?? ""];
if (!command) {
  console.error(`Usage: eval-matching.ts ${Object.keys(commands).join("|")}`);
  process.exit(1);
}
command().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
