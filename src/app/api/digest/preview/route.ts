import { pickDigestJobs, pickFollowUps, renderDigest, toDigestFollowUp, toDigestJob } from "@/lib/email/digest";
import { getDb } from "@/db";
import { currentUserId } from "@/lib/session";

/** Renders what tomorrow's digest would contain right now, without sending or logging anything. */
export async function GET() {
  const userId = await currentUserId();
  if (!userId) return new Response("Not signed in", { status: 401 });
  const db = await getDb();
  const now = new Date();
  const [picked, followUps] = await Promise.all([pickDigestJobs(userId, db, undefined, now), pickFollowUps(userId, db, now)]);
  if (picked.length === 0 && followUps.length === 0) {
    return new Response(
      "<!doctype html><meta charset=utf-8><body style='font-family:sans-serif;padding:2rem'>No new matches above the digest threshold and no applications to follow up on yet. Refresh jobs first.</body>",
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
  const { html } = await renderDigest(
    picked.map(toDigestJob),
    now,
    followUps.map((f) => toDigestFollowUp(f, now)),
  );
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
