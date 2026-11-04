"use server";

import { getDb } from "@/db";
import type { TailoredResume } from "@/db/schema";
import { AiRequestError, AiUnavailableError } from "@/lib/ai/gemini";
import { AiLimitError, assertAllowance, withAllowance, type Who } from "@/lib/ai/limits";
import { aiProvider } from "@/lib/ai/provider";
import { currentUser, currentUserId } from "@/lib/session";
import { addCoverLetter, createTailoredResume, currentStructure, ensureStructure, jobForUser, saveEdits, TailorError } from "@/lib/tailor/service";
import { toVersionView, type VersionView } from "./view";

/**
 * The tailoring steps, one Server Action each so each fits a 60 s function: read the resume into
 * sections (only when it changed), tailor the resume, write the cover letter. Each saves its
 * result, so a failed step can be retried on its own. Every action resolves the signed-in user and
 * passes their id to queries scoped by it.
 */

export type StepResult<T = null> = { ok: true; data: T } | { ok: false; message: string };

async function run<T>(fn: (userId: string, who: Who) => Promise<T>): Promise<StepResult<T>> {
  try {
    const who = await currentUser();
    if (!who) return { ok: false, message: "You're signed out. Sign in again." };
    if (!aiProvider()) return { ok: false, message: "AI isn't set up on this deployment (GEMINI_API_KEY)." };
    return { ok: true, data: await fn(who.userId, who) };
  } catch (err) {
    if (err instanceof TailorError || err instanceof AiUnavailableError || err instanceof AiRequestError || err instanceof AiLimitError) {
      return { ok: false, message: err.message };
    }
    console.error("Tailoring failed", err);
    return { ok: false, message: "Something went wrong. Try again in a minute." };
  }
}

export async function prepareResumeAction(jobId: string): Promise<StepResult> {
  return run(async (userId, who) => {
    const db = await getDb();
    if (!(await jobForUser(userId, jobId, db))) throw new TailorError("That job isn't in your list anymore.");
    // At the tailoring limit, stop before any AI call.
    await assertAllowance(who, "tailor", db);
    // Reading the resume into sections is an AI call only when the resume changed; it counts as an
    // AI resume reading then, so editing the resume and re-running this can't bypass the limits.
    if (await currentStructure(userId, db)) return null;
    await withAllowance(who, "resume", db, () => ensureStructure(userId, { db }));
    return null;
  });
}

export async function tailorResumeAction(jobId: string): Promise<StepResult<number>> {
  // Each tailored resume counts once toward the daily limit (reading the resume is part of it).
  return run(async (userId, who) => {
    const db = await getDb();
    return (await withAllowance(who, "tailor", db, () => createTailoredResume(userId, jobId, { db }))).version;
  });
}

export async function coverLetterAction(jobId: string, version: number): Promise<StepResult<VersionView>> {
  // Cover letters have their own daily limit, so rewriting one again and again can't drain the shared quota.
  return run(async (userId, who) => {
    const db = await getDb();
    return toVersionView(await withAllowance(who, "letter", db, () => addCoverLetter(userId, jobId, version, { db })));
  });
}

/** Saving edits needs no AI, so it skips `run`'s AI check. */
export async function saveEditsAction(jobId: string, version: number, resume: TailoredResume, paragraphs: string[] | null): Promise<StepResult<VersionView>> {
  try {
    const userId = await currentUserId();
    if (!userId) return { ok: false, message: "You're signed out. Sign in again." };
    return { ok: true, data: toVersionView(await saveEdits(userId, jobId, version, { resume, paragraphs }, await getDb())) };
  } catch (err) {
    if (err instanceof TailorError) return { ok: false, message: err.message };
    console.error("Saving tailored edits failed", err);
    return { ok: false, message: "Couldn't save your edits. Try again." };
  }
}
