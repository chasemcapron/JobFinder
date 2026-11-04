"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { profiles } from "@/db/schema";
import { currentUserId } from "@/lib/session";

/** "Hide this" on the setup guide: it stays hidden for good (every step is still reachable from the nav). */
export async function dismissSetupAction(): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;
  const db = await getDb();
  await db.update(profiles).set({ setupDismissedAt: new Date() }).where(eq(profiles.userId, userId));
  revalidatePath("/jobs");
}
