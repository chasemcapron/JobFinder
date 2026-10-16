import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ensureProfile, getUser } from "@/lib/profile";

/** For pages and server actions: returns the signed-in user + profile, or redirects home. */
export async function requireUser() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/");
  const user = await getUser(userId);
  if (!user) redirect("/");
  const profile = await ensureProfile(userId);
  return { user, profile };
}

/** For API routes: returns the user id or null (caller responds 401). */
export async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}
