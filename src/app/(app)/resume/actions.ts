"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { profiles } from "@/db/schema";
import { ClaudeRefusalError } from "@/lib/ai/claude";
import { AiRequestError } from "@/lib/ai/gemini";
import { aiProvider } from "@/lib/ai/provider";
import { coerceExperienceLevel } from "@/lib/jobs/experience";
import { rescoreStoredMatches } from "@/lib/jobs/search";
import { parseList } from "@/lib/parse-input";
import { getUser } from "@/lib/profile";
import { analyzeResume, type ResumeAnalysis } from "@/lib/resume/analyze";
import { detectResumeKind, extractResumeText, MAX_RESUME_BYTES, cleanExtractedText } from "@/lib/resume/extract-text";
import { commitResumeFile, storePendingResume } from "@/lib/resume/file-store";
import { currentUserId } from "@/lib/session";

export type AnalyzeState =
  | { ok: true; text: string; fileName: string | null; analysis: ResumeAnalysis }
  | { ok: false; message: string }
  | null;

/** Step 1: extract text from the upload (or pasted text) and analyze it. Nothing is saved yet. */
export async function analyzeResumeAction(_prev: AnalyzeState, formData: FormData): Promise<AnalyzeState> {
  try {
    const userId = await currentUserId();
    if (!userId) return { ok: false, message: "You're signed out. Sign in again." };

    const file = formData.get("file");
    const pasted = String(formData.get("text") ?? "");
    let text: string;
    let fileName: string | null = null;

    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_RESUME_BYTES) return { ok: false, message: "That file is over 4 MB." };
      const kind = detectResumeKind(file.name, file.type);
      if (!kind) return { ok: false, message: "Upload a PDF or .docx file, or paste the text instead." };
      const data = Buffer.from(await file.arrayBuffer());
      text = await extractResumeText(data, kind);
      fileName = file.name;
      // Kept for the preview; it only becomes the saved resume when the profile is saved.
      if (kind !== "text") await storePendingResume(userId, { kind, fileName, data });
    } else if (pasted.trim()) {
      text = cleanExtractedText(pasted);
    } else {
      return { ok: false, message: "Choose a file or paste your resume text." };
    }

    // The account name is stripped from the text before it goes to the AI (see redactPersonalInfo).
    const user = await getUser(userId);
    const analysis = await analyzeResume(text, { names: [user?.name] });
    return { ok: true, text, fileName, analysis };
  } catch (err) {
    console.error("Resume analysis failed", err);
    if (err instanceof ClaudeRefusalError || err instanceof AiRequestError) return { ok: false, message: err.message };
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
    const before = await db.query.profiles.findFirst({ where: eq(profiles.userId, userId), columns: { resumeText: true } });
    const resumeTextChanged = Boolean(resumeText) && resumeText !== (before?.resumeText ?? "");
    await db
      .update(profiles)
      .set({
        ...(resumeText ? { resumeText, resumeFileName: fileName } : {}),
        skills: parseList(String(formData.get("skills") ?? ""), 60),
        titles: parseList(String(formData.get("titles") ?? ""), 12),
        keywords: parseList(String(formData.get("keywords") ?? ""), 30),
        excludeKeywords: parseList(String(formData.get("excludeKeywords") ?? ""), 30),
        seniority: coerceExperienceLevel(String(formData.get("seniority") ?? "")),
        matchingUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(profiles.userId, userId));
    await commitResumeFile(userId, { resumeTextChanged, fileName });
    // Re-rank stored matches now so the Jobs page reflects the new profile right away.
    const { saved, removed } = await rescoreStoredMatches(userId, db);
    revalidatePath("/resume");
    revalidatePath("/jobs");
    const ranked = saved || removed ? ` Re-ranked ${saved.toLocaleString()} saved job${saved === 1 ? "" : "s"}${removed ? ` and hid ${removed.toLocaleString()} that no longer fit` : ""}.` : "";
    return { ok: true, message: `Profile saved.${ranked} Click Refresh jobs to search again${aiProvider() ? " and get AI scores" : ""}.` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't save." };
  }
}
