import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Icon, linkClass, PageHeader } from "@/components/ui";
import { getDb } from "@/db";
import { aiProvider } from "@/lib/ai/provider";
import { requireUser } from "@/lib/session";
import { APP_TIME_ZONE } from "@/lib/time";
import { extractContact } from "@/lib/tailor/contact";
import { jobForUser, listVersions } from "@/lib/tailor/service";
import { toVersionView } from "./view";
import { TailorWorkspace } from "./workspace";

export const metadata: Metadata = { title: "Tailor · Job Finder" };
// Each tailoring step is a Server Action with one AI call; the parse, resume and letter run separately.
export const maxDuration = 60;

export default async function TailorPage({ params, searchParams }: PageProps<"/jobs/[jobId]/tailor">) {
  const { user, profile } = await requireUser();
  const { jobId } = await params;
  const { v } = await searchParams;
  const db = await getDb();
  // Only a job this user has a match or an application for; every query is scoped by their id.
  const found = /^[0-9a-f-]{36}$/i.test(jobId) ? await jobForUser(profile.userId, jobId, db) : null;
  if (!found) notFound();
  const versions = (await listVersions(profile.userId, jobId, db)).map(toVersionView);
  const wanted = Number(Array.isArray(v) ? v[0] : v);
  const current = versions.find((x) => x.version === wanted) ?? versions[0] ?? null;
  const hasResume = Boolean(profile.resumeText?.trim());
  const { job } = found;
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: APP_TIME_ZONE });

  return (
    <div>
      <PageHeader
        eyebrow={
          <Link href="/jobs" className="inline-flex items-center gap-1">
            <Icon name="chevron-right" className="size-3.5 rotate-180" />
            Jobs
          </Link>
        }
        title={`Tailor for ${job.title}`}
        description={
          <>
            {job.company}.{" "}
            <a href={job.applyUrl} target="_blank" rel="noreferrer" className={linkClass}>
              Open the posting
            </a>
            . Tailoring only reorders, rephrases or leaves out what your resume already says; anything it can&apos;t back up is put back
            as you wrote it.
          </>
        }
      />
      {!hasResume ? (
        <Alert tone="warning">
          Add your resume on the <Link href="/resume">Resume page</Link> first.
        </Alert>
      ) : !aiProvider() && versions.length === 0 ? (
        <Alert tone="warning">Tailoring needs the AI, which isn&apos;t set up on this deployment (GEMINI_API_KEY).</Alert>
      ) : (
        <TailorWorkspace
          key={current?.version ?? 0}
          jobId={jobId}
          job={{ title: job.title, company: job.company }}
          versions={versions.map((x) => ({ version: x.version, applied: x.applied, edited: x.edited }))}
          current={current}
          contact={extractContact(profile.resumeText ?? "", user.name)}
          today={today}
          canGenerate={Boolean(aiProvider())}
        />
      )}
    </div>
  );
}
