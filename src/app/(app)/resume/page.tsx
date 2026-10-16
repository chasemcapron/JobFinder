import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/session";
import { ResumeEditor } from "./resume-editor";

export const metadata: Metadata = { title: "Resume · Job Finder" };

export default async function ResumePage() {
  const { profile } = await requireUser();
  return (
    <>
      <PageHeader
        title="Resume"
        description="Upload your resume to extract skills, target titles, seniority, and keywords. Review and edit before saving."
      />
      <ResumeEditor
        aiEnabled={Boolean(env.anthropicApiKey)}
        saved={{
          resumeText: profile.resumeText ?? "",
          fileName: profile.resumeFileName,
          skills: profile.skills,
          titles: profile.titles,
          keywords: profile.keywords,
          seniority: profile.seniority,
          updatedAt: profile.resumeText ? profile.updatedAt.toISOString() : null,
        }}
      />
    </>
  );
}
