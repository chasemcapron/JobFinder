import { z } from "zod";
import { EXPERIENCE_LEVELS, type ExperienceLevel } from "@/db/schema";
import { AiUnavailableError } from "@/lib/ai/gemini";
import { aiJson, aiProvider, type AiProvider } from "@/lib/ai/provider";
import { redactPersonalInfo } from "@/lib/ai/redact";
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
  /** Title words for nearby-but-wrong fields (e.g. "credit" for a security analyst). Jobs with them are skipped. */
  excludeKeywords: string[];
  source: AiProvider | "heuristic";
  /** Set when the AI was configured but couldn't be used, so the built-in extractor ran instead. */
  notice?: string;
};

const AnalysisSchema = z.object({
  titles: z.array(z.string()).describe("Job titles to search for, exactly as job postings word them, best fit first"),
  seniority: z.enum(EXPERIENCE_LEVELS).describe("The level of role this person should target next"),
  skills: z.array(z.string()).describe("Concrete skills, tools, languages, frameworks, standards and methods"),
  keywords: z.array(z.string()).describe("Domain and industry terms that help match postings (not repeats of skills)"),
  avoidTitleTerms: z
    .array(z.string())
    .describe("Words in job titles that signal a different profession sharing vocabulary with this person's field"),
});

const SYSTEM = `You turn a resume into job-search settings. Use only what the resume supports.
- titles: 4-8 job titles to search for, ordered by fit, worded the way US job postings word them. Use real posting titles, never field names: "SOC Analyst", "Security Analyst", "Cybersecurity Analyst", "Information Security Analyst", not "Cybersecurity" or "Information Security". Include common variants of the same role. Match the seniority (an entry-level candidate gets "Security Analyst I", "Junior Penetration Tester", etc., not "Senior" or "Lead" titles).
- seniority: internship, entry, mid, senior, lead or executive: the level of the next role this person should apply to, based on years of experience and scope. Students graduating within a year, recent graduates and career changers are entry; only use internship when the person is still years from graduating or explicitly seeks an internship.
- skills: 10-30 concrete, searchable skills, tools, certifications, frameworks and standards (e.g. "Splunk", "NIST CSF", "Wireshark", "Python", "CompTIA Security+"), canonical spelling. No soft skills.
- keywords: 5-15 domain terms that show up in relevant postings (e.g. "incident response", "vulnerability management", "SIEM", "GRC").
- avoidTitleTerms: 4-12 single words or short phrases that appear in titles of jobs this person should NOT get, where the job shares tools or vocabulary with their field and would otherwise slip through keyword matching. For a security analyst: "credit", "securities", "physical security", "loan", "underwriter", "sales", "account executive". For a software engineer: "sales engineer", "recruiter". Never include words that also appear in the person's own target titles, and never seniority words (senior, lead, principal, staff, manager, director): seniority is handled separately.`;

const SENIORITY_WORDS = new Set([
  "senior", "sr", "sr.", "junior", "jr", "jr.", "lead", "principal", "staff", "manager", "director", "head", "vp",
  "vice president", "chief", "executive", "intern", "internship", "entry level", "mid level",
]);

export function todayLabel(now = new Date()): string {
  return now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Chicago" });
}

/** Resume text with contact details and the person's name stripped (see redactPersonalInfo). */
export function resumeForAi(resumeText: string, names: (string | null | undefined)[] = []): string {
  return redactPersonalInfo(resumeText, { names });
}

export async function analyzeResume(resumeText: string, opts: { names?: (string | null | undefined)[] } = {}): Promise<ResumeAnalysis> {
  if (resumeText.length > MAX_RESUME_CHARS) {
    throw new Error(`That resume is ${resumeText.length.toLocaleString()} characters; the limit is ${MAX_RESUME_CHARS.toLocaleString()}.`);
  }
  if (!aiProvider()) return analyzeResumeHeuristically(resumeText);
  try {
    const { data, provider } = await aiJson({
      schema: AnalysisSchema,
      system: SYSTEM,
      // The model doesn't know today's date, and graduation dates decide entry vs internship.
      prompt: `Today is ${todayLabel()}.\n<resume>\n${resumeForAi(resumeText, opts.names)}\n</resume>`,
      tier: "quality",
      maxTokens: 4_000,
      hedgeAfterMs: 12_000, // a busy 3.8 Flash can take minutes; Flash-Lite is asked too after this
      deadline: Date.now() + 45_000,
    });
    const titles = uniqueCaseInsensitive(data.titles.map((s) => s.trim()).filter(Boolean)).slice(0, 8);
    return {
      skills: uniqueCaseInsensitive(data.skills.map((s) => s.trim()).filter(Boolean)).slice(0, 40),
      titles,
      seniority: data.seniority,
      keywords: uniqueCaseInsensitive(data.keywords.map((s) => s.trim()).filter(Boolean)).slice(0, 20),
      // Guard against the model excluding a word from the person's own titles, or a seniority
      // word (which would hide most of the market; seniority is handled by scoring).
      excludeKeywords: uniqueCaseInsensitive(
        data.avoidTitleTerms
          .map((s) => s.trim())
          .filter((t) => t && !SENIORITY_WORDS.has(t.toLowerCase()) && !titles.some((title) => containsTerm(title, t))),
      ).slice(0, 15),
      source: provider,
    };
  } catch (err) {
    if (!(err instanceof AiUnavailableError)) throw err;
    return { ...analyzeResumeHeuristically(resumeText), notice: `${err.message} Used the built-in extractor instead.` };
  }
}

const STOPWORDS = new Set(
  "about above after again also among and another any are around based because been before being below between both but can could did does doing done down during each either else ever every few for from further had has have having her here hers him his how however into its itself just least less made make many more most much must myself near need neither never nor not now off once only other others our ours out over own per rather same she should since some such than that the their theirs them then there these they this those through thus too toward under until upon used using very via was were what when where whether which while who whom whose why will with within without would year years you your yours work worked working team teams including responsible across various new using also well experience skills summary education present current company role".split(
    " ",
  ),
);

/** Offline extractor: used when no AI key is set, or when the AI is unavailable. */
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
    excludeKeywords: [],
    source: "heuristic",
  };
}
