import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { accounts, users } from "@/db/schema";

export { confirmsEmail } from "./confirm-email";

const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/**
 * Deletes a user and, by cascade, everything of theirs: profile and resume file, matches, hidden
 * roles, AI use, fit checks, applications and their notes, tailored versions, target companies,
 * crawl state, email log, search runs, Google sign-in tokens and sessions. Postings themselves
 * are shared between users and stay (pruned by age). Their Google Sheet isn't touched.
 *
 * First, the app's access to their Google account (Sheets, offline) is revoked at Google, so it no
 * longer shows under their Google Account's third-party access. That's best effort: a failure
 * there doesn't stop the deletion.
 */
export async function deleteAccount(userId: string, db: Db, deps: { fetchImpl?: typeof fetch } = {}): Promise<boolean> {
  const [google] = await db
    .select({ refresh: accounts.refresh_token, access: accounts.access_token })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, "google")))
    .limit(1);
  const token = google?.refresh ?? google?.access;
  if (token) await revokeGoogleGrant(token, deps.fetchImpl ?? fetch);
  const gone = await db.delete(users).where(eq(users.id, userId)).returning({ id: users.id });
  return gone.length > 0;
}

async function revokeGoogleGrant(token: string, fetchImpl: typeof fetch): Promise<void> {
  try {
    await fetchImpl(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    console.warn("Couldn't revoke the Google grant; deleting the account anyway", err instanceof Error ? err.message : err);
  }
}
