import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { resumeFiles } from "@/db/schema";

export type StoredResume = { kind: "pdf" | "docx"; fileName: string; data: Buffer };

/** Keeps the latest upload as "pending" until the profile is saved. Every call is scoped by userId. */
export async function storePendingResume(userId: string, file: Omit<StoredResume, "data"> & { data: Uint8Array }) {
  const db = await getDb();
  const row = { userId, slot: "pending" as const, kind: file.kind, fileName: file.fileName, data: file.data, createdAt: new Date() };
  await db
    .insert(resumeFiles)
    .values(row)
    .onConflictDoUpdate({ target: [resumeFiles.userId, resumeFiles.slot], set: { kind: row.kind, fileName: row.fileName, data: row.data, createdAt: row.createdAt } });
}

/**
 * Called when the profile is saved. A fresh upload with the same file name becomes the
 * saved resume (promoting consumes it, so later saves leave the file alone). Newly pasted
 * text (no file) drops the old saved file so the preview matches what was saved.
 */
export async function commitResumeFile(userId: string, opts: { resumeTextChanged: boolean; fileName: string | null }) {
  const db = await getDb();
  const savedSlot = and(eq(resumeFiles.userId, userId), eq(resumeFiles.slot, "saved"));
  const pendingSlot = and(eq(resumeFiles.userId, userId), eq(resumeFiles.slot, "pending"));
  if (!opts.fileName) {
    if (opts.resumeTextChanged) await db.delete(resumeFiles).where(savedSlot);
    return;
  }
  const pending = await db.query.resumeFiles.findFirst({ where: pendingSlot, columns: { fileName: true } });
  if (pending?.fileName !== opts.fileName) return;
  await db.delete(resumeFiles).where(savedSlot);
  await db.update(resumeFiles).set({ slot: "saved" }).where(pendingSlot);
}

export async function getSavedResume(userId: string): Promise<StoredResume | null> {
  const db = await getDb();
  const row = await db.query.resumeFiles.findFirst({
    where: and(eq(resumeFiles.userId, userId), eq(resumeFiles.slot, "saved")),
  });
  return row ? { kind: row.kind, fileName: row.fileName, data: Buffer.from(row.data) } : null;
}

/** Converts a saved .docx to HTML for the preview. mammoth emits plain semantic markup (no scripts). */
export async function docxToHtml(data: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.convertToHtml({ buffer: data });
  return value;
}
