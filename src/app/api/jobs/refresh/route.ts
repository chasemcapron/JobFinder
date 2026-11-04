import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { withAllowanceOr } from "@/lib/ai/limits";
import { aiProvider } from "@/lib/ai/provider";
import { runJobSearch, searchInFlight } from "@/lib/jobs/search";
import { currentUser } from "@/lib/session";

// Sources are fetched in parallel with 12s timeouts, then the AI scores a capped batch (finishing by ~42s).
export const maxDuration = 60;

export async function POST() {
  const who = await currentUser();
  if (!who) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { userId } = who;

  // Don't start a second run while one is in flight (double clicks, cron overlap).
  const db = await getDb();
  if (await searchInFlight(userId, db)) return NextResponse.json({ error: "A search is already running. Try again in a minute." }, { status: 409 });

  // Only the AI scoring counts toward the daily limit (scheduled searches never do), and a refresh
  // where it scored nothing doesn't count. Past the limit, the refresh still fetches and
  // keyword-ranks new jobs, and says why there are no AI scores.
  try {
    const summary = aiProvider()
      ? await withAllowanceOr(
          who,
          "refresh",
          db,
          () => runJobSearch(userId, { trigger: "manual" }),
          async (notice) => {
            const s = await runJobSearch(userId, { trigger: "manual", useAi: false });
            s.errors.unshift(`${notice} New jobs are ranked by keywords only until then.`);
            return s;
          },
          (s) => s.aiScored > 0,
        )
      : await runJobSearch(userId, { trigger: "manual" });
    return NextResponse.json(summary);
  } catch (err) {
    console.error("runJobSearch failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Search failed" }, { status: 500 });
  }
}
