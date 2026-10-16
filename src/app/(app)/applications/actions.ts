"use server";

import { revalidatePath } from "next/cache";
import { APPLICATION_STATUSES, type ApplicationStatus } from "@/db/schema";
import {
  deleteApplication,
  markApplied,
  syncApplicationToSheet,
  updateApplicationStatus,
  type SyncResult,
} from "@/lib/applications";
import { currentUserId } from "@/lib/session";

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

export async function removeApplicationAction(applicationId: string) {
  await deleteApplication(await requireUserId(), applicationId);
  refresh();
}
