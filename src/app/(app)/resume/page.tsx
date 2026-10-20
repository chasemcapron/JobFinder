import type { Metadata } from "next";
import { PageHeader, StatTile } from "@/components/ui";
import type { ExperienceLevel } from "@/db/schema";
import { aiLabel } from "@/lib/ai/provider";
import { formatDateTime, formatRelativeDate } from "@/lib/format";
import { EXPERIENCE_LABELS } from "@/lib/jobs/experience";
import { getSavedResume } from "@/lib/resume/file-store";
import { requireUser } from "@/lib/session";
import { ResumeEditor } from "./resume-editor";
import { ResumePreview } from "./resume-preview";

export const metadata: Metadata = { title: "Resume · Job Finder" };
// Reading a resume calls the AI, which can take a while on a busy free tier.
export const maxDuration = 60;

/** One short word per level, so it fits a summary tile's big type at phone width. */
const LEVEL_SHORT: Record<ExperienceLevel, string> = {
  internship: "Intern",
  entry: "Entry",
  mid: "Mid",
  senior: "Senior",
  lead: "Lead",
  executive: "Exec",
};

/** "Today", "1d ago", "3d ago", "2w ago", "Oct 4": short enough for a tile. */
function savedAgo(date: Date): string {
  const relative = formatRelativeDate(date) ?? "";
  return relative === "today" ? "Today" : relative === "yesterday" ? "1d ago" : relative;
}

export default async function ResumePage() {
  const { user, profile } = await requireUser();
  const file = await getSavedResume(user.id);
  const savedAt = profile.resumeText ? profile.updatedAt : null;
  const hasProfile = Boolean(profile.resumeText) || profile.skills.length + profile.titles.length > 0;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  return (
    <>
      <PageHeader
        title="Resume"
        description={
          <>
            Upload it, check what was found, save.{" "}
            <span className="text-foreground">It decides what gets searched and how every job ranks.</span>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          hue="blue"
          label="Target titles"
          value={profile.titles.length}
          hint={profile.titles[0] ? `Best fit: ${profile.titles[0]}` : "The roles searched for"}
          href={hasProfile ? "#titles" : undefined}
          className="min-w-0"
        />
        <StatTile
          hue="green"
          label="Skills"
          value={profile.skills.length}
          hint={hasProfile ? `Plus ${plural(profile.keywords.length, "keyword")}` : "Found when you upload"}
          href={hasProfile ? "#skills" : undefined}
          className="min-w-0"
        />
        <StatTile
          hue="orange"
          label="Level"
          value={profile.seniority ? LEVEL_SHORT[profile.seniority] : "–"}
          hint={profile.seniority ? EXPERIENCE_LABELS[profile.seniority] : "Not set yet"}
          href={hasProfile ? "#level" : undefined}
          className="min-w-0"
        />
        <StatTile
          hue="pink"
          label="Last saved"
          value={savedAt ? <span title={formatDateTime(savedAt)}>{savedAgo(savedAt)}</span> : "Never"}
          hint={
            savedAt ? (
              <span className="block truncate" title={profile.resumeFileName ?? undefined}>
                {profile.resumeFileName ?? "Pasted text"}
              </span>
            ) : (
              "Nothing saved yet"
            )
          }
          href={profile.resumeText || file ? "#saved-resume" : undefined}
          className="min-w-0"
        />
      </div>

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
          savedAt: savedAt ? formatDateTime(savedAt) : null,
        }}
      />

      {profile.resumeText || file ? (
        <div className="mt-6">
          <ResumePreview file={file} resumeText={profile.resumeText ?? ""} savedAt={savedAt} />
        </div>
      ) : null}
    </>
  );
}
