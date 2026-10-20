import type { AtsType, Profile, SourceRunResult, TargetCompanyRow } from "@/db/schema";
import { buildSearchQueries } from "../queries";
import type { FetchContext, NormalizedJob, SourceTask } from "../types";
import { adzunaConfigured, fetchAdzuna, MAX_ADZUNA_QUERIES } from "./adzuna";
import { fetchAshby } from "./ashby";
import { fetchGreenhouse } from "./greenhouse";
import { fetchLever } from "./lever";
import { mockJobs } from "./mock";
import { fetchUsajobs, usajobsConfigured } from "./usajobs";
import { fetchWorkday, WORKDAY_MAX_QUERIES, type WorkdaySearch } from "./workday";
import { TARGET_COUNTRY } from "../location";

export const SOURCE_TIMEOUT_MS = 12_000;
const MAX_CONCURRENCY = 12;
const MAX_USAJOBS_QUERIES = 2;
/**
 * A Workday site takes 3-11 s per search (listing pages plus up to 25 postings), so searching more
 * than this per run, 12 at a time, could push a run past Vercel's 60 s limit.
 */
export const MAX_WORKDAY_SITES_PER_SEARCH = 12;

export function mockJobsForced() {
  return process.env.MOCK_JOBS === "true";
}

/**
 * At most `max` items. With more, a window that moves by `max` each day, so every item takes its
 * turn every few days (jobs count as closed only after 21 days unseen).
 */
export function takeTurns<T>(items: T[], max: number, now: Date): T[] {
  if (items.length <= max) return items;
  const start = (Math.floor(now.getTime() / 86_400_000) * max) % items.length;
  return Array.from({ length: max }, (_, i) => items[(start + i) % items.length]);
}

/**
 * One task per target company (Workday sites capped per run, see MAX_WORKDAY_SITES_PER_SEARCH),
 * plus one per keyword query for Adzuna/USAJobs.
 */
export function buildSourceTasks(profile: Profile, targets: Pick<TargetCompanyRow, "ats" | "slug">[], now = new Date()): SourceTask[] {
  if (mockJobsForced()) return [{ label: "sample data", source: "mock", run: async () => mockJobs() }];
  const workdayTargets = targets.filter((t) => t.ats === "workday");
  const searched = [
    ...targets.filter((t) => t.ats !== "workday"),
    ...takeTurns(workdayTargets, MAX_WORKDAY_SITES_PER_SEARCH, now),
  ];

  // Workday sites are searched (they have no full feed), using the profile's top titles.
  const workday: WorkdaySearch = { queries: buildSearchQueries(profile, WORKDAY_MAX_QUERIES).map((q) => q.what), profile };
  const fetchBoard: Record<AtsType, (slug: string, signal: AbortSignal) => Promise<NormalizedJob[]>> = {
    greenhouse: (slug, signal) => fetchGreenhouse(slug, signal),
    lever: fetchLever,
    ashby: fetchAshby,
    workday: (slug, signal) => fetchWorkday(slug, workday, signal),
  };
  const tasks: SourceTask[] = searched.map(({ ats, slug }) => ({
    label: `${ats}:${slug}`,
    source: ats,
    run: ({ signal }: FetchContext) => fetchBoard[ats](slug, signal),
  }));

  if (adzunaConfigured()) {
    for (const q of buildSearchQueries(profile, MAX_ADZUNA_QUERIES)) {
      tasks.push({
        label: `adzuna: ${q.what}${q.where ? ` in ${q.where}` : ""}`,
        source: "adzuna",
        // US only (see TARGET_COUNTRY); the old per-profile Adzuna country is ignored.
        run: ({ signal }) => fetchAdzuna(q, TARGET_COUNTRY.toLowerCase(), signal),
      });
    }
  }
  if (usajobsConfigured()) {
    for (const q of buildSearchQueries(profile, MAX_USAJOBS_QUERIES)) {
      tasks.push({
        label: `usajobs: ${q.what}${q.where ? ` in ${q.where}` : ""}`,
        source: "usajobs",
        run: ({ signal }) => fetchUsajobs(q, signal),
      });
    }
  }

  // Nothing real to query: locally, fall back to sample data so the app still does something.
  // Never in production, where made-up jobs would mix into the real user's matches.
  if (tasks.length === 0 && process.env.NODE_ENV !== "production") {
    tasks.push({ label: "sample data", source: "mock", run: async () => mockJobs() });
  }
  return tasks;
}

/**
 * Runs tasks in parallel (bounded) with a per-task timeout. A failing or slow source
 * is recorded in the results and never fails the whole run.
 */
export async function runSourceTasks(
  tasks: SourceTask[],
  profile: FetchContext["profile"],
  timeoutMs = SOURCE_TIMEOUT_MS,
): Promise<{ jobs: NormalizedJob[]; results: SourceRunResult[] }> {
  const results: SourceRunResult[] = new Array(tasks.length);
  const jobs: NormalizedJob[][] = new Array(tasks.length);
  let next = 0;

  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      const task = tasks[i];
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        // Race against the timeout too, in case a task ignores the signal.
        const found = await Promise.race([
          task.run({ signal: controller.signal, profile }),
          new Promise<never>((_, reject) =>
            controller.signal.addEventListener("abort", () => reject(new Error(`Timed out after ${timeoutMs / 1000}s`))),
          ),
        ]);
        jobs[i] = found;
        results[i] = { source: task.label, ok: true, count: found.length, durationMs: Date.now() - started };
      } catch (err) {
        jobs[i] = [];
        results[i] = {
          source: task.label,
          ok: false,
          count: 0,
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - started,
        };
      } finally {
        clearTimeout(timer);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, tasks.length) }, worker));
  return { jobs: jobs.flat(), results };
}
