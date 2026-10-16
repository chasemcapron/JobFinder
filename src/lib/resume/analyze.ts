import { z } from "zod";
import { EXPERIENCE_LEVELS, type ExperienceLevel } from "@/db/schema";
import { claudeJson, getClaude } from "@/lib/ai/claude";
import { inferExperienceLevel } from "@/lib/jobs/experience";
import { containsTerm, uniqueCaseInsensitive } from "@/lib/text";
import { KNOWN_SKILLS, TITLE_HINTS } from "./skills-dictionary";

/** Resumes are short; anything past this is almost certainly the wrong file. */
export const MAX_RESUME_CHARS = 60_000;

export type ResumeAnalysis = {
  skills: string[];
  titles: string[];
  seniority: ExperienceLevel | null;
  keywords: string[];
  source: "claude" | "heuristic";
};

const AnalysisSchema = z.object({
  skills: z.array(z.string()).describe("Concrete skills, tools, languages, frameworks, and methods"),
  titles: z.array(z.string()).describe("Job titles this person is a strong fit for, best fit first"),
  seniority: z.enum(EXPERIENCE_LEVELS).describe("The level of role this person should target next"),
  keywords: z
    .array(z.string())
    .describe("Domain and industry keywords useful for searching job boards (not repeats of skills)"),
});

const SYSTEM = `You extract structured job-search data from resumes. Return only what the resume supports.
- skills: 10-30 concrete, searchable skills (e.g. "TypeScript", "Kubernetes", "Financial modeling"). Use the common canonical spelling. No soft skills like "communication".
- titles: 3-6 job titles to search for, ordered by fit, phrased the way job postings phrase them (e.g. "Senior Backend Engineer").
- seniority: one of internship, entry, mid, senior, lead, executive, for the next role this person should apply to. Base it on years of experience and scope of past roles.
- keywords: 5-15 domain/industry terms (e.g. "payments", "healthcare", "B2B SaaS") that would help match postings.`;

export async function analyzeResume(resumeText: string): Promise<ResumeAnalysis> {
  if (resumeText.length > MAX_RESUME_CHARS) {
    throw new Error(`That resume is ${resumeText.length.toLocaleString()} characters; the limit is ${MAX_RESUME_CHARS.toLocaleString()}.`);
  }
  if (!getClaude()) return analyzeResumeHeuristically(resumeText);
  const result = await claudeJson({
    schema: AnalysisSchema,
    system: SYSTEM,
    prompt: `<resume>\n${resumeText}\n</resume>`,
    maxTokens: 4000,
  });
  return {
    skills: uniqueCaseInsensitive(result.skills.map((s) => s.trim())).slice(0, 40),
    titles: uniqueCaseInsensitive(result.titles.map((s) => s.trim())).slice(0, 8),
    seniority: result.seniority,
    keywords: uniqueCaseInsensitive(result.keywords.map((s) => s.trim())).slice(0, 20),
    source: "claude",
  };
}

const STOPWORDS = new Set(
  "about above after again also among and another any are around based because been before being below between both but can could did does doing done down during each either else ever every few for from further had has have having her here hers him his how however into its itself just least less made make many more most much must myself near need neither never nor not now off once only other others our ours out over own per rather same she should since some such than that the their theirs them then there these they this those through thus too toward under until upon used using very via was were what when where whether which while who whom whose why will with within without would year years you your yours work worked working team teams including responsible across various new using also well experience skills summary education present current company role".split(
    " ",
  ),
);

/** Offline fallback used when ANTHROPIC_API_KEY is not set. */
export function analyzeResumeHeuristically(text: string): ResumeAnalysis {
  const skills = KNOWN_SKILLS.filter((s) => containsTerm(text, s));

  const titles: string[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.length < 4 || line.length > 80 || /@|https?:|\d{3}[-.\s]\d{3}/.test(line)) continue;
    const lower = line.toLowerCase();
    if (!TITLE_HINTS.some((h) => new RegExp(`\\b${h}s?\\b`).test(lower))) continue;
    // "Senior Engineer at Acme | 2019 - 2023" -> "Senior Engineer"
    const title = line
      .split(/\s+(?:at|@)\s+|\s[|–—-]\s|,|\(|\t/)[0]
      .replace(/\b(19|20)\d{2}\b.*$/, "")
      .trim();
    if (title.split(/\s+/).length <= 6 && title.length >= 4) titles.push(title);
    if (titles.length >= 6) break;
  }

  let seniority: ExperienceLevel | null = null;
  const years = [...text.matchAll(/(\d{1,2})\+?\s*(?:years|yrs)/gi)].map((m) => Number(m[1])).filter((n) => n < 50);
  if (years.length) {
    const y = Math.max(...years);
    seniority = y >= 10 ? "lead" : y >= 5 ? "senior" : y >= 2 ? "mid" : "entry";
  } else if (titles.length) {
    seniority = inferExperienceLevel(titles[0]) ?? "mid";
  }

  // Exclude words already covered by skills/titles, plus the first line (usually the person's name).
  const firstLine = text.split("\n").find((l) => l.trim()) ?? "";
  const excluded = new Set(
    [...skills, ...titles, firstLine, ...TITLE_HINTS].flatMap((s) => s.toLowerCase().split(/[\s./-]+/)),
  );
  const counts = new Map<string, number>();
  for (const word of text.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []) {
    if (STOPWORDS.has(word) || excluded.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const keywords = [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([w]) => w);

  return {
    skills: [...skills],
    titles: uniqueCaseInsensitive(titles),
    seniority,
    keywords,
    source: "heuristic",
  };
}
