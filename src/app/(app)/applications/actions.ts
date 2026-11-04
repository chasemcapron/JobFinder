"use server";

import { revalidatePath } from "next/cache";
import { APPLICATION_STATUSES, type ApplicationStatus } from "@/db/schema";
import type { ActionState } from "@/components/action-form";
import {
  deleteApplication,
  markApplied,
  saveApplicationNotes,
  syncApplicationToSheet,
  updateApplicationStatus,
  type SyncResult,
} from "@/lib/applications";
import { currentUserId } from "@/lib/session";
import { atLocalHour } from "@/lib/time";

export type ApplyResult = { ok: true; sync: SyncResult } | { ok: false; message: string };

async function requireUserId() {
  const id = await currentUserId();
  if (!id) throw new Error("You're signed out. Sign in again.");
  return id;
}

function refresh() {
  revalidatePath("/jobs");
  revalidatePath("/applications");
}

export async function markAppliedAction(jobId: string): Promise<ApplyResult> {
  try {
    const { sync } = await markApplied(await requireUserId(), jobId);
    refresh();
    return { ok: true, sync };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't save." };
  }
}

export async function retrySyncAction(applicationId: string): Promise<ApplyResult> {
  try {
    const sync = await syncApplicationToSheet(await requireUserId(), applicationId);
    refresh();
    return { ok: true, sync };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Retry failed." };
  }
}

export async function updateStatusAction(applicationId: string, status: string) {
  if (!(APPLICATION_STATUSES as readonly string[]).includes(status)) throw new Error("Invalid status");
  await updateApplicationStatus(await requireUserId(), applicationId, status as ApplicationStatus);
  refresh();
}

/** "2026-11-12", a day that exists (not Feb 31) and isn't absurdly far off. */
function isRealDay(day: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const at = new Date(Date.UTC(y, mo - 1, d));
  return y >= 2000 && y <= 2100 && at.getUTCFullYear() === y && at.getUTCMonth() === mo - 1 && at.getUTCDate() === d;
}

/** The Notes form on an application card: notes, contact, and the next step with its day. */
export async function saveNotesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const userId = await requireUserId();
    const day = String(formData.get("nextStepAt") ?? "").trim();
    if (day && !isRealDay(day)) return { ok: false, message: "Pick a date for the next step." };
    const saved = await saveApplicationNotes(userId, String(formData.get("applicationId") ?? ""), {
      notes: String(formData.get("notes") ?? ""),
      contact: String(formData.get("contact") ?? ""),
      nextStep: String(formData.get("nextStep") ?? ""),
      // A day, kept as 9 AM in the app's time zone so it shows as that day everywhere.
      nextStepAt: day ? atLocalHour(day, 9) : null,
    });
    if (!saved) return { ok: false, message: "That application isn't in your list anymore." };
    revalidatePath("/applications");
    return { ok: true, message: "Saved." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't save your notes." };
  }
}

export async function removeApplicationAction(applicationId: string) {
  await deleteApplication(await requireUserId(), applicationId);
  refresh();
}
