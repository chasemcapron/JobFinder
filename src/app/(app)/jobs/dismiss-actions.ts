"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { DISMISS_REASONS, type DismissReason } from "@/db/schema";
import { dismissJob, restoreJob, setCompanyHidden } from "@/lib/jobs/dismissals";
import { currentUserId } from "@/lib/session";

export type DismissResult = { ok: true } | { ok: false; message: string };

const SIGNED_OUT: DismissResult = { ok: false, message: "You're signed out. Sign in again." };
const NOT_YOURS: DismissResult = { ok: false, message: "That job isn't in your list anymore." };

/**
 * "Not interested" on a job card. The page isn't revalidated: the card collapses to "Hidden ·
 * Undo" where it is, and the job is gone from the list on the next load.
 */
export async function dismissJobAction(jobId: string, reason: DismissReason | "company"): Promise<DismissResult> {
  const userId = await currentUserId();
  if (!userId) return SIGNED_OUT;
  if (reason !== "company" && !DISMISS_REASONS.includes(reason)) return { ok: false, message: "Pick a reason." };
  return (await dismissJob(userId, jobId, reason, await getDb())) ? { ok: true } : NOT_YOURS;
}

export async function restoreJobAction(jobId: string): Promise<DismissResult> {
  const userId = await currentUserId();
  if (!userId) return SIGNED_OUT;
  return (await restoreJob(userId, jobId, await getDb())) ? { ok: true } : NOT_YOURS;
}

/** Settings → Hidden companies → Show again. */
export async function unhideCompanyAction(company: string): Promise<DismissResult> {
  const userId = await currentUserId();
  if (!userId) return SIGNED_OUT;
  await setCompanyHidden(userId, String(company).slice(0, 200), false, await getDb());
  revalidatePath("/settings");
  revalidatePath("/jobs");
  return { ok: true };
}
