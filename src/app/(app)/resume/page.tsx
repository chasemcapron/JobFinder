import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { aiLabel } from "@/lib/ai/provider";
import { getSavedResume } from "@/lib/resume/file-store";
import { requireUser } from "@/lib/session";
import { ResumeEditor } from "./resume-editor";
import { ResumePreview } from "./resume-preview";

export const metadata: Metadata = { title: "Resume · Job Finder" };
// Reading a resume calls the AI, which can take a while on a busy free tier.
export const maxDuration = 60;

export default async function ResumePage() {
  const { user, profile } = await requireUser();
  const file = await getSavedResume(user.id);
  return (
    <>
      <PageHeader
        title="Resume"
        description="Upload your resume to extract skills, target titles, seniority, and keywords. Review and edit before saving."
      />
      {profile.resumeText || file ? (
        <div className="mb-6">
          <ResumePreview file={file} resumeText={profile.resumeText ?? ""} savedAt={profile.resumeText ? profile.updatedAt : null} />
        </div>
      ) : null}
      <ResumeEditor
        aiLabel={aiLabel()}
        saved={{
          resumeText: profile.resumeText ?? "",
          fileName: profile.resumeFileName,
          skills: profile.skills,
          titles: profile.titles,
          keywords: profile.keywords,
          excludeKeywords: profile.excludeKeywords,
          seniority: profile.seniority,
          updatedAt: profile.resumeText ? profile.updatedAt.toISOString() : null,
        }}
      />
    </>
  );
}
