import { and, eq } from "drizzle-orm";
import { getDb, type Db } from "@/db";
import { accounts } from "@/db/schema";
import { env } from "@/lib/env";

export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

/** Expected, user-fixable states (shown as "not configured" rather than as failures). */
export class GoogleNotConnectedError extends Error {}

/**
 * Returns a valid Google access token for the user, refreshing it with the stored
 * refresh token when it's expired or about to expire.
 */
export async function getGoogleAccessToken(userId: string, db?: Db, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (!env.googleConfigured) throw new GoogleNotConnectedError("Google OAuth isn't configured on this deployment.");
  db ??= await getDb();
  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.userId, userId), eq(accounts.provider, "google")),
  });
  if (!account) throw new GoogleNotConnectedError("Sign in with Google to enable Sheets sync.");
  if (account.scope && !account.scope.split(" ").includes(SHEETS_SCOPE)) {
    throw new GoogleNotConnectedError("Google Sheets access wasn't granted. Sign out and sign in again, allowing Sheets access.");
  }

  const now = Math.floor(Date.now() / 1000);
  if (account.access_token && account.expires_at && account.expires_at > now + 60) return account.access_token;
  if (!account.refresh_token) {
    throw new GoogleNotConnectedError("No Google refresh token is stored. Sign out and sign in again.");
  }

  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.googleClientId!,
      client_secret: env.googleClientSecret!,
      grant_type: "refresh_token",
      refresh_token: account.refresh_token,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !body.access_token) {
    if (body.error === "invalid_grant") {
      throw new GoogleNotConnectedError("Google access was revoked or expired. Sign out and sign in again.");
    }
    throw new Error(`Couldn't refresh Google token: ${body.error_description ?? body.error ?? `HTTP ${res.status}`}`);
  }

  await db
    .update(accounts)
    .set({
      access_token: body.access_token,
      expires_at: now + (body.expires_in ?? 3600),
      ...(body.refresh_token ? { refresh_token: body.refresh_token } : {}),
      ...(body.scope ? { scope: body.scope } : {}),
    })
    .where(and(eq(accounts.provider, "google"), eq(accounts.providerAccountId, account.providerAccountId)));
  return body.access_token;
}
