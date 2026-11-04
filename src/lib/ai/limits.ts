import { and, eq, gt, gte, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db";
import { aiUsage, users, type AiUsageKind } from "@/db/schema";
import { env } from "@/lib/env";
import { localDate } from "@/lib/time";
import { ClaudeRefusalError } from "./claude";
import { AiRequestError, AiUnavailableError } from "./gemini";

/**
 * Daily limits on the AI actions a user starts, so one person can't use up the free Gemini quota
 * everyone shares. The owner (the first address in ALLOWED_EMAILS) has none, and with no
 * ALLOWED_EMAILS (local development) nobody does. Scheduled runs (the morning searches, the
 * nightly crawl, the 10:00 scoring) never count. Days are Chicago days, like the morning email.
 */
export const DAILY_LIMITS: Record<AiUsageKind, number> = { tailor: 10, letter: 10, fit: 25, refresh: 6, suggest: 5, resume: 5 };

const NOUNS: Record<AiUsageKind, [string, string]> = {
  tailor: ["tailored resume", "tailored resumes"],
  letter: ["cover letter", "cover letters"],
  fit: ["fit check", "fit checks"],
  refresh: ["AI-scored refresh", "AI-scored refreshes"],
  suggest: ["company suggestion", "company suggestions"],
  resume: ["AI resume reading", "AI resume readings"],
};

export function usageNoun(kind: AiUsageKind, n: number): string {
  return NOUNS[kind][n === 1 ? 0 : 1];
}

export class AiLimitError extends Error {
  constructor(kind: AiUsageKind) {
    super(limitMessage(kind));
    this.name = "AiLimitError";
  }
}

export function limitMessage(kind: AiUsageKind): string {
  return `You've used today's ${DAILY_LIMITS[kind]} ${usageNoun(kind, DAILY_LIMITS[kind])}. It resets at midnight Central.`;
}

/** True for the account the limits don't apply to. */
export function isUnlimited(email: string | null | undefined): boolean {
  const owner = env.allowedEmails[0];
  if (!owner) return true;
  return Boolean(email) && email!.trim().toLowerCase() === owner;
}

/** Who's asking: the email, when the caller already has it, saves a lookup. */
export type Who = { userId: string; email?: string | null };

/** The AI itself failed (busy, timed out, refused, rejected the request): no work was done. */
function isAiFailure(err: unknown): boolean {
  return err instanceof AiUnavailableError || err instanceof AiRequestError || err instanceof ClaudeRefusalError;
}

async function unlimited(who: Who, db: Db): Promise<boolean> {
  if (who.email !== undefined) return isUnlimited(who.email);
  const user = await db.query.users.findFirst({ where: eq(users.id, who.userId), columns: { email: true } });
  return isUnlimited(user?.email);
}

/**
 * Counts one use and returns true, or returns false when today's limit is reached. One statement
 * does both (the update only applies under the limit), so two quick clicks can't both slip past it.
 */
export async function tryTakeAllowance(who: Who, kind: AiUsageKind, db: Db, now = new Date()): Promise<boolean> {
  if (await unlimited(who, db)) return true;
  const counted = await db
    .insert(aiUsage)
    .values({ userId: who.userId, day: localDate(now), kind, count: 1 })
    .onConflictDoUpdate({
      target: [aiUsage.userId, aiUsage.day, aiUsage.kind],
      set: { count: sql`${aiUsage.count} + 1` },
      setWhere: sql`${aiUsage.count} < ${DAILY_LIMITS[kind]}`,
    })
    .returning({ count: aiUsage.count });
  return counted.length > 0;
}

/** Counts one use, or throws AiLimitError when today's limit is reached. */
export async function takeAllowance(who: Who, kind: AiUsageKind, db: Db, now = new Date()): Promise<void> {
  if (!(await tryTakeAllowance(who, kind, db, now))) throw new AiLimitError(kind);
}

/** Throws AiLimitError when today's limit is already reached, without counting a use. */
export async function assertAllowance(who: Who, kind: AiUsageKind, db: Db, now = new Date()): Promise<void> {
  if (await unlimited(who, db)) return;
  const [full] = await db
    .select({ count: aiUsage.count })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, who.userId), eq(aiUsage.day, localDate(now)), eq(aiUsage.kind, kind), gte(aiUsage.count, DAILY_LIMITS[kind])));
  if (full) throw new AiLimitError(kind);
}

/** Gives a use back when the AI didn't do the work (busy, timed out), so a failure doesn't cost the user one. */
export async function returnAllowance(who: Who, kind: AiUsageKind, db: Db, now = new Date()): Promise<void> {
  if (await unlimited(who, db)) return;
  await db
    .update(aiUsage)
    .set({ count: sql`${aiUsage.count} - 1` })
    .where(and(eq(aiUsage.userId, who.userId), eq(aiUsage.day, localDate(now)), eq(aiUsage.kind, kind), gt(aiUsage.count, 0)));
}

/**
 * Runs `fn` as one counted use: taken first, given back if the AI failed (not for errors after
 * the AI did its work, like a fact check rejecting its answer) or if `spent` says it didn't do
 * the work (it fell back to the built-in path, or found nothing). One timestamp for both, so a
 * request that runs past midnight gives the use back to the day it was taken from.
 */
export async function withAllowance<T>(who: Who, kind: AiUsageKind, db: Db, fn: () => Promise<T>, spent: (result: T) => boolean = () => true): Promise<T> {
  const day = new Date();
  await takeAllowance(who, kind, db, day);
  let result: T;
  try {
    result = await fn();
  } catch (err) {
    if (isAiFailure(err)) await returnAllowance(who, kind, db, day).catch(() => {});
    throw err;
  }
  if (!spent(result)) await returnAllowance(who, kind, db, day).catch(() => {});
  return result;
}

/**
 * Like withAllowance, but once the limit is reached runs `fallback` (the work without AI) with the
 * limit message to show, instead of failing.
 */
export async function withAllowanceOr<T>(
  who: Who,
  kind: AiUsageKind,
  db: Db,
  fn: () => Promise<T>,
  fallback: (notice: string) => Promise<T>,
  spent?: (result: T) => boolean,
): Promise<T> {
  try {
    return await withAllowance(who, kind, db, fn, spent);
  } catch (err) {
    if (err instanceof AiLimitError) return fallback(err.message);
    throw err;
  }
}

export type UsageToday = { kind: AiUsageKind; used: number; limit: number }[];

/** Today's use of each limited action, or null for an account without limits. */
export async function usageToday(who: Who, db?: Db, now = new Date()): Promise<UsageToday | null> {
  db ??= await getDb();
  if (await unlimited(who, db)) return null;
  const rows = await db
    .select({ kind: aiUsage.kind, count: aiUsage.count })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, who.userId), eq(aiUsage.day, localDate(now))));
  const used = new Map(rows.map((r) => [r.kind, r.count]));
  return (Object.keys(DAILY_LIMITS) as AiUsageKind[]).map((kind) => ({ kind, used: used.get(kind) ?? 0, limit: DAILY_LIMITS[kind] }));
}
