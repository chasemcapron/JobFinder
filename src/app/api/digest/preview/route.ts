import { renderDigest, pickDigestJobs } from "@/lib/email/digest";
import { getDb } from "@/db";
import { formatLocation } from "@/lib/jobs/location";
import { adzunaHomepage } from "@/lib/jobs/sources/adzuna";
import { currentUserId } from "@/lib/session";

/** Renders what tomorrow's digest would contain right now, without sending or logging anything. */
export async function GET() {
  const userId = await currentUserId();
  if (!userId) return new Response("Not signed in", { status: 401 });
  const db = await getDb();
  const picked = await pickDigestJobs(userId, db);
  if (picked.length === 0) {
    return new Response(
      "<!doctype html><meta charset=utf-8><body style='font-family:sans-serif;padding:2rem'>No new matches above the digest threshold yet. Refresh jobs first.</body>",
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
  const { html } = await renderDigest(
    picked.map(({ job, score, reasons }) => ({
      title: job.title,
      company: job.company,
      location: formatLocation(job, job.locationRaw),
      score,
      reason: reasons,
      applyUrl: job.applyUrl,
      adzunaAttributionUrl: job.source === "adzuna" ? adzunaHomepage(job.country) : null,
    })),
    new Date(),
  );
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
