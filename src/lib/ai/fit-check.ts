import { z } from "zod";
import { FIT_VERDICTS, type FitCheckResult, type Profile } from "@/db/schema";
import { EXPERIENCE_LABELS } from "@/lib/jobs/experience";
import { formatLocation } from "@/lib/jobs/location";
import type { ScoredJob } from "@/lib/jobs/scoring";
import { todayLabel } from "@/lib/resume/analyze";
import { uniqueCaseInsensitive } from "@/lib/text";
import { aiJson } from "./provider";
import { redactPersonalInfo } from "./redact";

/** Postings rarely need more than this; the rest is benefits and legal boilerplate. */
const POSTING_CHARS = 12_000;

const FitSchema = z.object({
  fitScore: z.number().describe("0-100 overall fit, using the same scale as the guide"),
  verdict: z.enum(FIT_VERDICTS).describe("strong 75+, good 50-74, stretch 25-49, poor under 25"),
  summary: z.string().describe("Two sentences: the overall fit and the single biggest factor"),
  strengths: z.array(z.string()).describe("3-5 specific ways the resume meets the posting, each citing resume evidence"),
  gaps: z.array(z.string()).describe("Up to 5 requirements the resume doesn't show, most important first"),
  missingKeywords: z.array(z.string()).describe("Up to 12 important terms from the posting that the resume never uses"),
  resumeTips: z.array(z.string()).describe("3-5 concrete edits to tailor the resume to this posting"),
});

const SYSTEM = `You are a candid career coach comparing one candidate's resume with one US job posting.
Scale: 90+ near-perfect; 75-89 strong, apply now; 50-74 good, worth applying with a tailored resume; 25-49 a stretch (missing core requirements or above their level); under 25 poor (different profession or far above their level).
Rules:
- Be specific and honest. Quote or paraphrase the resume and the posting; no generic advice ("tailor your resume", "show passion").
- Treat "required" or "minimum" qualifications as far more important than "preferred" or "nice to have". Years of experience and required certifications or clearances are hard gaps.
- missingKeywords: exact terms from the posting (tools, frameworks, certifications, methods) that applicant tracking systems would look for and that the resume never mentions. No soft skills, no company names.
- resumeTips: concrete edits, e.g. "Move the Splunk alert-triage bullet to the top of the internship entry and add the alert volume". Never suggest claiming experience the resume doesn't support; for a missing skill, suggest how to show adjacent evidence or say it's a real gap to close.
- Everything is short: each list item under 160 characters.`;

type FitJob = ScoredJob & { company: string };

function describeCandidate(profile: Pick<Profile, "seniority" | "experienceLevels" | "remotePreference" | "preferredLocations">): string {
  const lines = [
    profile.seniority ? `Targets ${EXPERIENCE_LABELS[profile.seniority].toLowerCase()} roles.` : null,
    profile.preferredLocations.length ? `Preferred locations: ${profile.preferredLocations.join("; ")}.` : null,
    `Remote preference: ${{ any: "remote or on-site", remote_only: "remote only", onsite_only: "on-site/hybrid only" }[profile.remotePreference]}.`,
  ];
  return lines.filter(Boolean).join(" ");
}

/** Compares the (redacted) resume with one posting. Throws AiUnavailableError when the AI is busy. */
export async function checkFit(input: {
  resumeText: string;
  names?: (string | null | undefined)[];
  profile: Pick<Profile, "seniority" | "experienceLevels" | "remotePreference" | "preferredLocations">;
  job: FitJob;
}): Promise<{ result: FitCheckResult; model: string }> {
  const { job } = input;
  const level = job.experienceLevel ? `\nLevel: ${EXPERIENCE_LABELS[job.experienceLevel]}` : "";
  const posting = job.description.length > POSTING_CHARS ? `${job.description.slice(0, POSTING_CHARS)}…` : job.description;
  const { data, model } = await aiJson({
    schema: FitSchema,
    system: SYSTEM,
    prompt: `Today is ${todayLabel()}.
<candidate_preferences>${describeCandidate(input.profile)}</candidate_preferences>
<resume>
${redactPersonalInfo(input.resumeText, { names: input.names })}
</resume>
<posting>
${job.title} at ${job.company}
Location: ${formatLocation(job, job.locationRaw)}${level}
${posting}
</posting>`,
    tier: "quality",
    maxTokens: 4_000,
    // 3.8 Flash answers in ~5-9 s when healthy but can take minutes on a busy free tier;
    // past 10 s, Flash-Lite (~1-3 s) is asked too and the first answer wins.
    hedgeAfterMs: 10_000,
    deadline: Date.now() + 48_000,
  });
  const fitScore = Math.max(0, Math.min(100, Math.round(data.fitScore)));
  const clean = (items: string[], max: number) => uniqueCaseInsensitive(items.map((s) => s.trim()).filter(Boolean)).slice(0, max);
  return {
    model,
    result: {
      fitScore,
      // Keep the label consistent with the number even if the model drifts.
      verdict: fitScore >= 75 ? "strong" : fitScore >= 50 ? "good" : fitScore >= 25 ? "stretch" : "poor",
      summary: data.summary.trim().slice(0, 500),
      strengths: clean(data.strengths, 5),
      gaps: clean(data.gaps, 5),
      missingKeywords: clean(data.missingKeywords, 12),
      resumeTips: clean(data.resumeTips, 5),
    },
  };
}
