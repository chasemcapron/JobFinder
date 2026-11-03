import type { ResumeStructure, tailoredDocuments, TailoredResume } from "@/db/schema";

/** One tailored version as the page needs it (plain data, safe to pass to the client). */
export type VersionView = {
  version: number;
  base: ResumeStructure;
  resume: TailoredResume;
  paragraphs: string[] | null;
  warnings: string[];
  edited: boolean;
  /** Sent with an application (linked when the job was marked applied). */
  applied: boolean;
};

export function toVersionView(row: typeof tailoredDocuments.$inferSelect): VersionView {
  return {
    version: row.version,
    base: row.base,
    resume: row.resume,
    paragraphs: row.coverLetter?.paragraphs ?? null,
    warnings: row.factCheck.warnings,
    edited: row.edited,
    applied: Boolean(row.applicationId),
  };
}
