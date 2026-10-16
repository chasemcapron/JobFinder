"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/action-form";
import { getDb } from "@/db";
import {
  EXPERIENCE_LEVELS,
  REMOTE_PREFERENCES,
  profiles,
  targetCompanies,
  type ExperienceLevel,
  type RemotePreference,
} from "@/db/schema";
import { ADZUNA_COUNTRIES } from "@/lib/jobs/sources/adzuna-countries";
import { parseList, parseSheetId, parseTargetCompany } from "@/lib/parse-input";
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
    const country = String(formData.get("adzunaCountry") ?? "us");
    const db = await getDb();
    await db
      .update(profiles)
      .set({
        searchKeywords: parseList(String(formData.get("searchKeywords") ?? "")),
        preferredLocations: parseList(String(formData.get("preferredLocations") ?? "")),
        experienceLevels: levels,
        remotePreference: (REMOTE_PREFERENCES as readonly string[]).includes(remote) ? (remote as RemotePreference) : "any",
        adzunaCountry: ADZUNA_COUNTRIES.some((c) => c.code === country) ? country : "us",
        emailEnabled: formData.get("emailEnabled") === "on",
        matchingUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(profiles.userId, userId));
    revalidatePath("/settings");
    return { ok: true, message: "Preferences saved." };
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
    const db = await getDb();
    await db.update(profiles).set({ sheetId, sheetTab, updatedAt: new Date() }).where(eq(profiles.userId, userId));
    revalidatePath("/settings");
    return { ok: true, message: sheetId ? "Sheet settings saved." : "Sheet sync turned off." };
  } catch (err) {
    return errorState(err);
  }
}
