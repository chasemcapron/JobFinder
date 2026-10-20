"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/action-form";
import { getDb } from "@/db";
import {
  ATS_TYPES,
  EXPERIENCE_LEVELS,
  REMOTE_PREFERENCES,
  SHEET_FIELDS,
  profiles,
  targetCompanies,
  type AtsType,
  type ExperienceLevel,
  type RemotePreference,
  type SheetColumnMap,
  type SheetField,
} from "@/db/schema";
import { AiRequestError, AiUnavailableError } from "@/lib/ai/gemini";
import { aiProvider } from "@/lib/ai/provider";
import { suggestCompanies, type CompanySuggestion } from "@/lib/ai/suggest-companies";
import { inspectSheet, SHEET_FIELD_LABELS } from "@/lib/google/sheets";
import { getGoogleAccessToken } from "@/lib/google/tokens";
import { rescoreStoredMatches } from "@/lib/jobs/search";
import { parseColumnLetter, parseList, parseSheetId, parseTargetCompany } from "@/lib/parse-input";
import { ensureProfile, listTargetCompanies } from "@/lib/profile";
import { currentUserId } from "@/lib/session";

async function userIdOrThrow() {
  const id = await currentUserId();
  if (!id) throw new Error("Not signed in");
  return id;
}

function errorState(err: unknown): ActionState {
  return { ok: false, message: err instanceof Error ? err.message : "Something went wrong." };
}

export async function savePreferences(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const userId = await userIdOrThrow();
    const levels = formData
      .getAll("experienceLevels")
      .map(String)
      .filter((l): l is ExperienceLevel => (EXPERIENCE_LEVELS as readonly string[]).includes(l));
    const remote = String(formData.get("remotePreference") ?? "any");
    const db = await getDb();
    await db
      .update(profiles)
      .set({
        searchKeywords: parseList(String(formData.get("searchKeywords") ?? "")),
        preferredLocations: parseList(String(formData.get("preferredLocations") ?? "")),
        experienceLevels: levels,
        remotePreference: (REMOTE_PREFERENCES as readonly string[]).includes(remote) ? (remote as RemotePreference) : "any",
        adzunaCountry: "us",
        emailEnabled: formData.get("emailEnabled") === "on",
        matchingUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(profiles.userId, userId));
    // Preferences change scores (levels, remote, locations), so re-rank saved jobs right away.
    await rescoreStoredMatches(userId, db);
    revalidatePath("/settings");
    revalidatePath("/jobs");
    return { ok: true, message: "Preferences saved and your saved jobs re-ranked." };
  } catch (err) {
    return errorState(err);
  }
}

export async function addTargetCompany(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const userId = await userIdOrThrow();
    const raw = String(formData.get("company") ?? "");
    const entries = raw
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map(parseTargetCompany);
    if (entries.length === 0) return { ok: false, message: "Enter at least one company, e.g. greenhouse:stripe." };
    const db = await getDb();
    await db
      .insert(targetCompanies)
      .values(entries.map((e) => ({ ...e, userId })))
      .onConflictDoNothing();
    revalidatePath("/settings");
    return { ok: true, message: `Added ${entries.map((e) => `${e.ats}:${e.slug}`).join(", ")}.` };
  } catch (err) {
    return errorState(err);
  }
}

export async function setTargetCompanyEnabled(id: string, enabled: boolean) {
  const userId = await userIdOrThrow();
  const db = await getDb();
  await db
    .update(targetCompanies)
    .set({ enabled })
    .where(and(eq(targetCompanies.id, id), eq(targetCompanies.userId, userId)));
  revalidatePath("/settings");
}

export async function removeTargetCompany(id: string) {
  const userId = await userIdOrThrow();
  const db = await getDb();
  await db.delete(targetCompanies).where(and(eq(targetCompanies.id, id), eq(targetCompanies.userId, userId)));
  revalidatePath("/settings");
}

export async function saveSheetSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const userId = await userIdOrThrow();
    const sheetId = parseSheetId(String(formData.get("sheetId") ?? ""));
    const sheetTab = String(formData.get("sheetTab") ?? "").trim() || null;
    const map: SheetColumnMap = {};
    const used = new Map<string, SheetField>();
    for (const field of SHEET_FIELDS) {
      const col = parseColumnLetter(String(formData.get(`col_${field}`) ?? ""));
      if (!col) continue;
      const clash = used.get(col);
      if (clash) {
        return { ok: false, message: `Column ${col} is used for both ${SHEET_FIELD_LABELS[clash]} and ${SHEET_FIELD_LABELS[field]}.` };
      }
      used.set(col, field);
      map[field] = col;
    }
    if (sheetId && used.size === 0) return { ok: false, message: "Map at least one column." };
    const db = await getDb();
    await db
      .update(profiles)
      .set({ sheetId, sheetTab, sheetColumnMap: map, updatedAt: new Date() })
      .where(eq(profiles.userId, userId));
    revalidatePath("/settings");
    return { ok: true, message: sheetId ? "Sheet settings saved." : "Sheet sync turned off." };
  } catch (err) {
    return errorState(err);
  }
}

export type SheetCheck =
  | { ok: true; title: string; tabs: string[]; tab: string | null; headers: { column: string; label: string }[] }
  | { ok: false; message: string };

/** Verifies access to the saved sheet and returns its tabs and header row. */
export async function testSheetAction(): Promise<SheetCheck> {
  try {
    const userId = await userIdOrThrow();
    const db = await getDb();
    const profile = await db.query.profiles.findFirst({ where: eq(profiles.userId, userId) });
    if (!profile?.sheetId) return { ok: false, message: "Save a sheet URL or ID first." };
    const token = await getGoogleAccessToken(userId, db);
    return { ok: true, ...(await inspectSheet({ token, sheetId: profile.sheetId, tab: profile.sheetTab })) };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't reach the sheet." };
  }
}

export type SuggestState = { ok: true; suggestions: CompanySuggestion[] } | { ok: false; message: string };

/** Asks the AI for employers that fit the profile and returns only job boards verified live. Nothing is saved. */
export async function suggestCompaniesAction(): Promise<SuggestState> {
  try {
    const userId = await userIdOrThrow();
    if (!aiProvider()) return { ok: false, message: "AI isn't set up on this deployment (GEMINI_API_KEY)." };
    const db = await getDb();
    const profile = await ensureProfile(userId, db);
    if (profile.titles.length === 0) return { ok: false, message: "Save your target titles on the Resume page first." };
    const existing = await listTargetCompanies(userId, db);
    const suggestions = await suggestCompanies({ profile, existing, deadline: Date.now() + 45_000 });
    if (suggestions.length === 0) return { ok: false, message: "None of the suggested companies had a job board that could be read. Try again." };
    return { ok: true, suggestions };
  } catch (err) {
    if (err instanceof AiUnavailableError || err instanceof AiRequestError) return { ok: false, message: err.message };
    return errorState(err) as SuggestState;
  }
}

/** Adds suggested boards (already verified) to the user's target companies. */
export async function addSuggestedCompanies(entries: { ats: AtsType; slug: string }[]): Promise<ActionState> {
  try {
    const userId = await userIdOrThrow();
    const valid = entries
      .filter((e) => (ATS_TYPES as readonly string[]).includes(e.ats) && /^[a-z0-9._-]{1,80}$/i.test(e.slug))
      .slice(0, 50);
    if (valid.length === 0) return { ok: false, message: "Nothing to add." };
    const db = await getDb();
    await db
      .insert(targetCompanies)
      .values(valid.map((e) => ({ ats: e.ats, slug: e.slug.toLowerCase(), userId })))
      .onConflictDoNothing();
    revalidatePath("/settings");
    return { ok: true, message: `Added ${valid.length} compan${valid.length === 1 ? "y" : "ies"}. Refresh jobs to search them.` };
  } catch (err) {
    return errorState(err);
  }
}
