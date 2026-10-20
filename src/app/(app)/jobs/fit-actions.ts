"use server";

import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { applications, fitChecks, jobMatches, jobs } from "@/db/schema";
import { checkFit } from "@/lib/ai/fit-check";
import { AiRequestError, AiUnavailableError } from "@/lib/ai/gemini";
import { aiProvider } from "@/lib/ai/provider";
import type { FitCheckView } from "@/lib/jobs/fit-checks";
import { ensureProfile, getUser } from "@/lib/profile";
import { currentUserId } from "@/lib/session";

export type FitCheckState = { ok: true; view: FitCheckView } | { ok: false; message: string };

/**
 * "Check my fit": compares the saved resume with one posting. Cached per job until the
 * profile changes; `force` re-runs it anyway. Also stores this deeper read as the job's match
 * score. The page isn't revalidated: re-sorting the list would move the card (and its open
 * result) out from under the user; the new score shows on the next load.
 */
export async function checkFitAction(jobId: string, force = false): Promise<FitCheckState> {
  try {
    const userId = await currentUserId();
    if (!userId) return { ok: false, message: "You're signed out. Sign in again." };
    if (!aiProvider()) return { ok: false, message: "AI isn't set up on this deployment (GEMINI_API_KEY)." };
    const db = await getDb();
    const profile = await ensureProfile(userId, db);
    if (!profile.resumeText?.trim()) return { ok: false, message: "Add your resume on the Resume page first." };

    // Only jobs this user has a match or an application for.
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    const [match] = job
      ? await db.select({ id: jobMatches.id }).from(jobMatches).where(and(eq(jobMatches.userId, userId), eq(jobMatches.jobId, jobId))).limit(1)
      : [];
    const [application] =
      job && !match
        ? await db.select({ id: applications.id }).from(applications).where(and(eq(applications.userId, userId), eq(applications.jobId, jobId))).limit(1)
        : [];
    if (!job || (!match && !application)) return { ok: false, message: "That job isn't in your list anymore." };

    if (!force) {
      const cached = await db.query.fitChecks.findFirst({ where: and(eq(fitChecks.userId, userId), eq(fitChecks.jobId, jobId)) });
      if (cached && cached.createdAt >= profile.matchingUpdatedAt) {
        return { ok: true, view: { result: cached.result, model: cached.model, checkedAt: cached.createdAt.toISOString(), stale: false } };
      }
    }

    const user = await getUser(userId, db);
    const { result, model } = await checkFit({ resumeText: profile.resumeText, names: [user?.name], profile, job });
    const now = new Date();
    await db
      .insert(fitChecks)
      .values({ userId, jobId, result, model, createdAt: now })
      .onConflictDoUpdate({ target: [fitChecks.userId, fitChecks.jobId], set: { result, model, createdAt: now } });
    if (match) {
      await db
        .update(jobMatches)
        .set({ score: result.fitScore, aiScored: true, reasons: result.summary.split(/(?<=[.!?])\s/)[0].slice(0, 200), scoredAt: now })
        .where(eq(jobMatches.id, match.id));
    }
    return { ok: true, view: { result, model, checkedAt: now.toISOString(), stale: false } };
  } catch (err) {
    if (err instanceof AiUnavailableError || err instanceof AiRequestError) return { ok: false, message: err.message };
    console.error("Fit check failed", err);
    return { ok: false, message: "Couldn't check this job right now. Try again in a minute." };
  }
}
