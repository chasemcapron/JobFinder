import { and, eq, sql, type SQL } from "drizzle-orm";
import { getDb, type Db } from "@/db";
import { applications, dismissedRoles, jobMatches, jobs, profiles, type DismissReason } from "@/db/schema";
import { companyKey, type HiddenSet } from "./hidden";
import { roleKey } from "./normalize";

export { hiddenState, type HiddenState } from "./hidden";

/**
 * "Not interested": a role (company + title, every city it's posted in, now and later) or a whole
 * company, hidden from the Jobs list and the morning email. Everything is scoped by user.
 */

export async function loadHidden(userId: string, db?: Db): Promise<HiddenSet> {
  db ??= await getDb();
  const [roles, profile] = await Promise.all([
    db.select({ roleKey: dismissedRoles.roleKey, reason: dismissedRoles.reason }).from(dismissedRoles).where(eq(dismissedRoles.userId, userId)),
    db.query.profiles.findFirst({ where: eq(profiles.userId, userId), columns: { hiddenCompanies: true } }),
  ]);
  return {
    roles: new Map(roles.map((r) => [r.roleKey, r.reason])),
    companies: new Set((profile?.hiddenCompanies ?? []).map(companyKey)),
  };
}

/** The job, if it's in this user's matches or applications (anything else isn't theirs to hide). */
async function usersJob(userId: string, jobId: string, db: Db) {
  const [match] = await db
    .select({ company: jobs.company, title: jobs.title })
    .from(jobMatches)
    .innerJoin(jobs, eq(jobs.id, jobMatches.jobId))
    .where(and(eq(jobMatches.userId, userId), eq(jobMatches.jobId, jobId)))
    .limit(1);
  if (match) return match;
  const [applied] = await db
    .select({ company: jobs.company, title: jobs.title })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(and(eq(applications.userId, userId), eq(applications.jobId, jobId)))
    .limit(1);
  return applied ?? null;
}

/** Hides the job's role, or with "company" its whole company. Returns false when the job isn't the user's. */
export async function dismissJob(userId: string, jobId: string, reason: DismissReason | "company", db: Db): Promise<boolean> {
  const job = await usersJob(userId, jobId, db);
  if (!job) return false;
  if (reason === "company") {
    await setCompanyHidden(userId, job.company, true, db);
    return true;
  }
  await db
    .insert(dismissedRoles)
    .values({ userId, roleKey: roleKey(job), company: job.company, title: job.title, reason })
    .onConflictDoUpdate({ target: [dismissedRoles.userId, dismissedRoles.roleKey], set: { reason, createdAt: new Date() } });
  return true;
}

/** Shows the job again: clears both its role and its company, since either alone would keep it hidden. */
export async function restoreJob(userId: string, jobId: string, db: Db): Promise<boolean> {
  const job = await usersJob(userId, jobId, db);
  if (!job) return false;
  await db.delete(dismissedRoles).where(and(eq(dismissedRoles.userId, userId), eq(dismissedRoles.roleKey, roleKey(job))));
  await setCompanyHidden(userId, job.company, false, db);
  return true;
}

/** Adds or removes a company from the user's hidden list; names match case- and punctuation-insensitively. */
export async function setCompanyHidden(userId: string, company: string, hide: boolean, db: Db): Promise<void> {
  // The row is locked while the list is edited, so two quick clicks can't each drop the other's change.
  await db.transaction(async (tx) => {
    const [profile] = await tx.select({ hiddenCompanies: profiles.hiddenCompanies }).from(profiles).where(eq(profiles.userId, userId)).for("update");
    if (!profile) return;
    const key = companyKey(company);
    const others = profile.hiddenCompanies.filter((c) => companyKey(c) !== key);
    const next = hide ? [...others, company.trim()].sort((a, b) => a.localeCompare(b)) : others;
    await tx.update(profiles).set({ hiddenCompanies: next }).where(eq(profiles.userId, userId));
  });
}

/**
 * SQL twin of `hiddenState` (the role dismissed, or the company hidden), comparing names
 * case-insensitively, for leaving hidden jobs out before a query's row limit. `hiddenState` stays
 * the exact check on the rows that come back.
 */
export function isHiddenSql(userId: string): SQL {
  return sql`(exists (select 1 from ${dismissedRoles} where ${dismissedRoles.userId} = ${userId} and lower(${dismissedRoles.company}) = lower(${jobs.company}) and lower(${dismissedRoles.title}) = lower(${jobs.title}))
    or exists (select 1 from ${profiles}, jsonb_array_elements_text(${profiles.hiddenCompanies}) as hidden_company(name) where ${profiles.userId} = ${userId} and lower(hidden_company.name) = lower(${jobs.company})))`;
}
