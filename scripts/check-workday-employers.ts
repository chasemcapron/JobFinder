/**
 * Checks every site in the built-in Workday employer list (src/lib/jobs/sources/workday-employers.ts)
 * with one live search each, 500 ms apart, and lists the broken ones (404 = site renamed, 422 = the
 * tenant moved to another wdN or left Workday). Read-only; prints names and counts, no postings.
 *
 *   npx tsx scripts/check-workday-employers.ts [--q "Data Analyst"] [--json eval-data/workday-employers-check.json]
 */
import { writeFile } from "node:fs/promises";
import { probeWorkdaySite } from "@/lib/jobs/sources/workday";
import { WORKDAY_EMPLOYERS } from "@/lib/jobs/sources/workday-employers";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const q = arg("q") ?? "analyst";
  const results: { name: string; slug: string; ok: boolean; status: number | null; total: number | null; usFilter: boolean | null }[] = [];
  for (const e of WORKDAY_EMPLOYERS) {
    let probe = await probeWorkdaySite(e.slug, q, AbortSignal.timeout(10_000));
    // Once more after a pause if Cloudflare is rate limiting: that's not the site's fault.
    if (!probe.ok && probe.status === 429) {
      await new Promise((r) => setTimeout(r, 5_000));
      probe = await probeWorkdaySite(e.slug, q, AbortSignal.timeout(10_000));
    }
    results.push({
      name: e.name,
      slug: e.slug,
      ok: probe.ok,
      status: probe.ok ? 200 : probe.status,
      total: probe.ok ? probe.total : null,
      usFilter: probe.ok ? probe.usFilter : null,
    });
    console.log(`${probe.ok ? "ok " : "BAD"} ${e.name} (${e.slug})${probe.ok ? `: ${probe.total} for "${q}"${probe.usFilter ? "" : ", no US filter"}` : `: ${probe.message}`}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  const broken = results.filter((r) => !r.ok);
  console.log(`\n${results.length - broken.length} of ${results.length} work; broken: ${broken.map((b) => `${b.name} (${b.status ?? "error"})`).join(", ") || "none"}`);
  const out = arg("json");
  if (out) await writeFile(out, JSON.stringify(results, null, 2));
  process.exit(broken.some((b) => b.status === 404 || b.status === 422) ? 2 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
