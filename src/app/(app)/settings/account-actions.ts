"use server";

import { cookies } from "next/headers";
import { signOut } from "@/auth";
import type { ActionState } from "@/components/action-form";
import { getDb } from "@/db";
import { confirmsEmail, deleteAccount } from "@/lib/account";
import { DELETED_COOKIE } from "@/lib/confirm-email";
import { getUser } from "@/lib/profile";
import { currentUserId } from "@/lib/session";

/** Settings → Delete my account. Needs the account's email typed in; then signs out to the home page. */
export async function deleteAccountAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, message: "You're signed out. Sign in again." };
  const db = await getDb();
  const user = await getUser(userId, db);
  if (!user) return { ok: false, message: "That account is already gone." };
  if (!confirmsEmail(String(formData.get("confirm") ?? ""), user.email)) {
    return { ok: false, message: "Type your account's email exactly to confirm." };
  }
  try {
    await deleteAccount(userId, db);
  } catch (err) {
    console.error("Account deletion failed", err);
    return { ok: false, message: "Couldn't delete your account. Nothing was removed; try again." };
  }
  // Read once by the sign-in page to say the deletion went through; a URL flag could be shared.
  (await cookies()).set(DELETED_COOKIE, "1", { maxAge: 60, httpOnly: true, sameSite: "lax", path: "/" });
  // Outside the try: signOut redirects by throwing, which must reach Next.
  await signOut({ redirectTo: "/" });
  return null;
}
