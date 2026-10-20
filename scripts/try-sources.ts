/**
 * Dev tool: fetch real postings from the given boards and print a parsing summary.
 * Usage: npx tsx scripts/try-sources.ts greenhouse:stripe lever:spotify ashby:ramp
 * Workday sites are searched rather than listed, so pass search terms with --q:
 *   npx tsx scripts/try-sources.ts https://leidos.wd5.myworkdayjobs.com/External --q "security analyst"
 */
import { runSourceTasks } from "@/lib/jobs/sources";
import { fetchAshby } from "@/lib/jobs/sources/ashby";
import { fetchGreenhouse } from "@/lib/jobs/sources/greenhouse";
import { fetchLever } from "@/lib/jobs/sources/lever";
import { fetchWorkday } from "@/lib/jobs/sources/workday";
import { dedupeJobs } from "@/lib/jobs/normalize";
import { parseTargetCompany } from "@/lib/parse-input";
import type { SourceTask } from "@/lib/jobs/types";

async function main() {
  const args = process.argv.slice(2);
  const queries = args.flatMap((a, i) => (args[i - 1] === "--q" ? [a] : []));
  const targets = args.filter((a, i) => a !== "--q" && args[i - 1] !== "--q").map(parseTargetCompany);
  const workday = { queries, profile: { titles: queries, excludeKeywords: [], seniority: null } };
  const fetchers = {
    greenhouse: (slug: string, signal: AbortSignal) => fetchGreenhouse(slug, signal),
    lever: fetchLever,
    ashby: fetchAshby,
    workday: (slug: string, signal: AbortSignal) => fetchWorkday(slug, workday, signal),
  };
  const tasks: SourceTask[] = targets.map((t) => ({
    label: `${t.ats}:${t.slug}`,
    source: t.ats,
    run: ({ signal }) => fetchers[t.ats](t.slug, signal),
  }));
  const { jobs, results } = await runSourceTasks(tasks, { adzunaCountry: "us", remotePreference: "any" });
  console.table(results);
  const pct = (n: number) => `${Math.round((100 * n) / Math.max(1, jobs.length))}%`;
  console.log({
    jobs: jobs.length,
    unique: dedupeJobs(jobs).length,
    withCountry: pct(jobs.filter((j) => j.country).length),
    withCity: pct(jobs.filter((j) => j.city).length),
    remote: pct(jobs.filter((j) => j.remote).length),
    withLevel: pct(jobs.filter((j) => j.experienceLevel).length),
    withSalary: pct(jobs.filter((j) => j.salaryMin).length),
    withPostedAt: pct(jobs.filter((j) => j.postedAt).length),
    emptyDescription: jobs.filter((j) => !j.description).length,
  });
  const noCountry = jobs.filter((j) => !j.country && !j.remote).map((j) => j.locationRaw);
  console.log("unparsed locations:", [...new Set(noCountry)].slice(0, 25));
}

main();
