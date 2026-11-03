import { and, desc, eq, max } from "drizzle-orm";
import type { Db } from "@/db";
import {
  applications,
  fitChecks,
  jobMatches,
  jobs,
  resumeStructures,
  tailoredDocuments,
  type ResumeStructure,
  type TailoredResume,
} from "@/db/schema";
import { aiJson } from "@/lib/ai/provider";
import { redactPersonalInfo } from "@/lib/ai/redact";
import type { AiJsonFn } from "@/lib/jobs/ai-score";
import { ensureProfile, getUser } from "@/lib/profile";
import { gateTailoredResume } from "./fact-check";
import { keepsShape } from "./render";
import { tailorResume, writeCoverLetter, type TailorFocus } from "./generate";
import { parseResumeStructure, resumeHash } from "./structure";

/**
 * Tailoring's database side. Every function takes the signed-in user's id and scopes every query
 * by it; a job can be tailored only when the user has a match or an application for it. Each step
 * is its own call (parse, resume, cover letter), each inside one 60 s function, and each saves
 * its result, so a failed step resumes rather than starting over.
 */

export class TailorError extends Error {}

type Deps = { db: Db; ai?: AiJsonFn; deadline?: number };
const DEFAULT_BUDGET_MS = 48_000;

/** The job, if this user has a match or an application for it. */
export async function jobForUser(userId: string, jobId: string, db: Db) {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) return null;
  const [match] = await db
    .select({ evaluation: jobMatches.evaluation })
    .from(jobMatches)
    .where(and(eq(jobMatches.userId, userId), eq(jobMatches.jobId, jobId)))
    .limit(1);
  const [application] = await db
    .select({ id: applications.id })
    .from(applications)
    .where(and(eq(applications.userId, userId), eq(applications.jobId, jobId)))
    .limit(1);
  if (!match && !application) return null;
  return { job, evaluation: match?.evaluation ?? null, applicationId: application?.id ?? null };
}

/** The user's resume text, redacted the way every AI input is. */
async function redactedResume(userId: string, db: Db) {
  const profile = await ensureProfile(userId, db);
  const text = profile.resumeText?.trim();
  if (!text) throw new TailorError("Add your resume on the Resume page first.");
  const user = await getUser(userId, db);
  return { profile, text, redacted: redactPersonalInfo(text, { names: [user?.name] }) };
}

/** The parsed base resume for the current resume text, parsing it (one AI call) when it changed. */
export async function ensureStructure(userId: string, deps: Deps): Promise<{ structure: ResumeStructure; hash: string }> {
  const { db } = deps;
  const { text, redacted } = await redactedResume(userId, db);
  const hash = resumeHash(text);
  const cached = await db.query.resumeStructures.findFirst({ where: eq(resumeStructures.userId, userId) });
  if (cached?.sourceHash === hash) return { structure: cached.data, hash };
  const { structure, model } = await parseResumeStructure(redacted, { ai: deps.ai ?? aiJson, deadline: deps.deadline ?? Date.now() + DEFAULT_BUDGET_MS });
  if (structure.sections.every((s) => s.entries.length === 0 && s.items.length === 0)) {
    throw new TailorError("Couldn't read your resume's sections. Check the text on the Resume page.");
  }
  const row = { sourceHash: hash, data: structure, model, createdAt: new Date() };
  await db.insert(resumeStructures).values({ userId, ...row }).onConflictDoUpdate({ target: resumeStructures.userId, set: row });
  return { structure, hash };
}

/** The saved structure when it's still the current resume's; null when it needs parsing first. */
export async function currentStructure(userId: string, db: Db): Promise<{ structure: ResumeStructure; hash: string } | null> {
  const profile = await ensureProfile(userId, db);
  if (!profile.resumeText?.trim()) return null;
  const hash = resumeHash(profile.resumeText.trim());
  const cached = await db.query.resumeStructures.findFirst({ where: eq(resumeStructures.userId, userId) });
  return cached?.sourceHash === hash ? { structure: cached.data, hash } : null;
}

/**
 * What to lean on and what not to claim: the requirements the evaluation and the fit check found missing. Not the fit
 * check's missingKeywords: those are the posting's wording for things the resume may well show ("data visualization"
 * for dashboards), which the tailoring is told to reuse; blocking them would undo truthful rewording.
 */
async function focusFor(userId: string, jobId: string, evaluation: { matchedSkills: string[]; missingSkills: string[] } | null, db: Db): Promise<TailorFocus> {
  const fit = await db.query.fitChecks.findFirst({ where: and(eq(fitChecks.userId, userId), eq(fitChecks.jobId, jobId)) });
  const missing = new Set<string>(evaluation?.missingSkills ?? []);
  for (const r of fit?.result.requirements ?? []) if (r.match === "missing" && r.requirement.length <= 40) missing.add(r.requirement);
  return { matched: evaluation?.matchedSkills ?? [], missing: [...missing].slice(0, 20) };
}

export async function listVersions(userId: string, jobId: string, db: Db) {
  return db
    .select()
    .from(tailoredDocuments)
    .where(and(eq(tailoredDocuments.userId, userId), eq(tailoredDocuments.jobId, jobId)))
    .orderBy(desc(tailoredDocuments.version));
}

/** Step 2: a new tailored resume version for the job (the cover letter comes next). */
export async function createTailoredResume(userId: string, jobId: string, deps: Deps) {
  const { db } = deps;
  const found = await jobForUser(userId, jobId, db);
  if (!found) throw new TailorError("That job isn't in your list anymore.");
  const deadline = deps.deadline ?? Date.now() + DEFAULT_BUDGET_MS;
  const base = await currentStructure(userId, db);
  if (!base) throw new TailorError("Your resume changed: read it again first.");
  const focus = await focusFor(userId, jobId, found.evaluation, db);
  const { value, warnings, model } = await tailorResume({ base: base.structure, job: found.job, focus, ai: deps.ai ?? aiJson, deadline });
  // Versions are numbered per job; two tabs generating at once would collide on the unique index.
  for (let attempt = 0; attempt < 3; attempt++) {
    const [{ last }] = await db
      .select({ last: max(tailoredDocuments.version) })
      .from(tailoredDocuments)
      .where(and(eq(tailoredDocuments.userId, userId), eq(tailoredDocuments.jobId, jobId)));
    const [row] = await db
      .insert(tailoredDocuments)
      .values({ userId, jobId, version: (last ?? 0) + 1, baseHash: base.hash, base: base.structure, resume: value, factCheck: { warnings }, model })
      .onConflictDoNothing()
      .returning();
    if (row) return row;
  }
  throw new TailorError("Couldn't save the new version. Try again.");
}

async function versionRow(userId: string, jobId: string, version: number, db: Db) {
  const row = await db.query.tailoredDocuments.findFirst({
    where: and(eq(tailoredDocuments.userId, userId), eq(tailoredDocuments.jobId, jobId), eq(tailoredDocuments.version, version)),
  });
  if (!row) throw new TailorError("That version doesn't exist.");
  return row;
}

/** Step 3: the cover letter for a version. */
export async function addCoverLetter(userId: string, jobId: string, version: number, deps: Deps) {
  const { db } = deps;
  const found = await jobForUser(userId, jobId, db);
  if (!found) throw new TailorError("That job isn't in your list anymore.");
  const row = await versionRow(userId, jobId, version, db);
  const focus = await focusFor(userId, jobId, found.evaluation, db);
  const { value, warnings, model } = await writeCoverLetter({
    base: row.base,
    job: found.job,
    focus,
    ai: deps.ai ?? aiJson,
    deadline: deps.deadline ?? Date.now() + DEFAULT_BUDGET_MS,
  });
  if (value.length === 0) throw new TailorError("Every sentence of the letter claimed something your resume doesn't say, so none was kept. Try again.");
  const [updated] = await db
    .update(tailoredDocuments)
    .set({ coverLetter: { paragraphs: value }, factCheck: { warnings: [...row.factCheck.warnings, ...warnings] }, model, updatedAt: new Date() })
    .where(eq(tailoredDocuments.id, row.id))
    .returning();
  return updated;
}

/**
 * Saves the user's own edits to a version. They're the user's words, so they aren't fact-checked,
 * but the resume keeps the base's shape: same sections, bullets and lines, in the same order.
 */
export async function saveEdits(userId: string, jobId: string, version: number, edits: { resume: TailoredResume; paragraphs: string[] | null }, db: Db) {
  const row = await versionRow(userId, jobId, version, db);
  // Versions made before tailoring kept the resume's shape could reorder and leave pieces out: edits map by position, so they'd land in the wrong place.
  if (!keepsShape(row.base, row.resume)) throw new TailorError("This version was made before tailoring kept your resume's layout. Make a new version to edit it.");
  // Same bullets and lines in the same order; a bullet emptied in the editor keeps its original wording.
  const resume = gateTailoredResume(row.base, edits.resume, { trusted: true }).value;
  const paragraphs = edits.paragraphs?.map((p) => p.trim()).filter(Boolean) ?? null;
  const [updated] = await db
    .update(tailoredDocuments)
    // A letter cleared in the editor is no letter (the page then offers to write one).
    .set({ resume, coverLetter: paragraphs === null ? row.coverLetter : paragraphs.length ? { paragraphs } : null, edited: true, updatedAt: new Date() })
    .where(eq(tailoredDocuments.id, row.id))
    .returning();
  return updated;
}

/** When the job is marked applied: the newest version is the one sent. */
export async function linkNewestToApplication(userId: string, jobId: string, applicationId: string, db: Db) {
  const [newest] = await listVersions(userId, jobId, db);
  if (newest && !newest.applicationId) {
    await db.update(tailoredDocuments).set({ applicationId }).where(eq(tailoredDocuments.id, newest.id));
  }
  return newest ?? null;
}
