"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { profiles } from "@/db/schema";
import { ClaudeRefusalError } from "@/lib/ai/claude";
import { coerceExperienceLevel } from "@/lib/jobs/experience";
import { parseList } from "@/lib/parse-input";
import { analyzeResume, type ResumeAnalysis } from "@/lib/resume/analyze";
import { detectResumeKind, extractResumeText, MAX_RESUME_BYTES, cleanExtractedText } from "@/lib/resume/extract-text";
import { currentUserId } from "@/lib/session";

export type AnalyzeState =
  | { ok: true; text: string; fileName: string | null; analysis: ResumeAnalysis }
  | { ok: false; message: string }
  | null;

/** Step 1: extract text from the upload (or pasted text) and analyze it. Nothing is saved yet. */
export async function analyzeResumeAction(_prev: AnalyzeState, formData: FormData): Promise<AnalyzeState> {
  try {
    if (!(await currentUserId())) return { ok: false, message: "You're signed out. Sign in again." };

    const file = formData.get("file");
    const pasted = String(formData.get("text") ?? "");
    let text: string;
    let fileName: string | null = null;

    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_RESUME_BYTES) return { ok: false, message: "That file is over 4 MB." };
      const kind = detectResumeKind(file.name, file.type);
      if (!kind) return { ok: false, message: "Upload a PDF or .docx file, or paste the text instead." };
      text = await extractResumeText(Buffer.from(await file.arrayBuffer()), kind);
      fileName = file.name;
    } else if (pasted.trim()) {
      text = cleanExtractedText(pasted);
    } else {
      return { ok: false, message: "Choose a file or paste your resume text." };
    }

    const analysis = await analyzeResume(text);
    return { ok: true, text, fileName, analysis };
  } catch (err) {
    console.error("Resume analysis failed", err);
    if (err instanceof ClaudeRefusalError) return { ok: false, message: err.message };
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't read that resume." };
  }
}

export type SaveState = { ok: boolean; message: string } | null;

/** Step 2: save the (possibly edited) extraction to the profile. */
export async function saveResumeProfile(_prev: SaveState, formData: FormData): Promise<SaveState> {
  try {
    const userId = await currentUserId();
    if (!userId) return { ok: false, message: "You're signed out. Sign in again." };
    const resumeText = String(formData.get("resumeText") ?? "").trim();
    const fileName = String(formData.get("fileName") ?? "").trim() || null;
    const db = await getDb();
    await db
      .update(profiles)
      .set({
        ...(resumeText ? { resumeText, resumeFileName: fileName } : {}),
        skills: parseList(String(formData.get("skills") ?? ""), 60),
        titles: parseList(String(formData.get("titles") ?? ""), 12),
        keywords: parseList(String(formData.get("keywords") ?? ""), 30),
        seniority: coerceExperienceLevel(String(formData.get("seniority") ?? "")),
        matchingUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(profiles.userId, userId));
    revalidatePath("/resume");
    return { ok: true, message: "Profile saved. Refresh jobs to re-rank matches." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't save." };
  }
}
