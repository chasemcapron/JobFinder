import { and, eq, gt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { searchRuns } from "@/db/schema";
import { runJobSearch } from "@/lib/jobs/search";
import { currentUserId } from "@/lib/session";

// Sources are fetched in parallel with 12s timeouts, then the AI scores a capped batch (finishing by ~42s).
export const maxDuration = 60;

export async function POST() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  // Don't start a second run while one is in flight (double clicks, cron overlap).
  const db = await getDb();
  const running = await db.query.searchRuns.findFirst({
    where: and(
      eq(searchRuns.userId, userId),
      eq(searchRuns.status, "running"),
      gt(searchRuns.startedAt, new Date(Date.now() - maxDuration * 1000)),
    ),
  });
  if (running) return NextResponse.json({ error: "A search is already running. Try again in a minute." }, { status: 409 });

  try {
    const summary = await runJobSearch(userId, { trigger: "manual" });
    return NextResponse.json(summary);
  } catch (err) {
    console.error("runJobSearch failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Search failed" }, { status: 500 });
  }
}
