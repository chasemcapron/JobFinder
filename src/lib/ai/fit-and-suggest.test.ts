import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "@/db/schema";
import { checkFit } from "./fit-check";
import { suggestCompanies } from "./suggest-companies";

const geminiReply = (data: unknown) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] }, finishReason: "STOP" }] }));
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

const profile = {
  titles: ["Security Analyst", "SOC Analyst"],
  skills: ["Splunk", "Python"],
  keywords: ["SIEM"],
  searchKeywords: [],
  preferredLocations: [],
  experienceLevels: ["entry"],
  remotePreference: "any",
  seniority: "entry",
  excludeKeywords: ["sales"],
  adzunaCountry: "us",
} as unknown as Profile;

beforeEach(() => vi.stubEnv("GEMINI_API_KEY", "test-key"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("checkFit", () => {
  it("redacts the resume, cleans the lists, and keeps the verdict consistent with the score", async () => {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
      geminiReply({
        fitScore: 81.6,
        verdict: "stretch", // inconsistent with the score; the code fixes it
        summary: "Strong SOC fit. Splunk triage matches the core duty.",
        strengths: ["Splunk alert triage", "splunk alert triage", "Python scripting"],
        gaps: [],
        missingKeywords: ["EDR", "PowerShell"],
        resumeTips: ["Lead with the Splunk bullet"],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = await checkFit({
      resumeText: "Jordan Sample\njordan@example.com | (630) 555-0142\nSecurity intern: Splunk triage",
      names: ["Jordan Sample"],
      profile,
      job: { title: "SOC Analyst", company: "Huntress", description: "Triage EDR alerts.", city: null, state: null, country: "US", remote: true, locationRaw: "Remote US", experienceLevel: "entry" },
    });
    const sent: string = JSON.parse(String(fetchMock.mock.calls[0][1].body)).contents[0].parts[0].text;
    expect(sent).not.toMatch(/Jordan|555-0142|jordan@/);
    expect(sent).toContain("Triage EDR alerts.");
    expect(result.fitScore).toBe(82);
    expect(result.verdict).toBe("strong");
    expect(result.strengths).toEqual(["Splunk alert triage", "Python scripting"]);
  });
});

describe("suggestCompanies", () => {
  it("keeps only boards that exist, tries the other services, and counts level-appropriate title matches", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("generativelanguage")) {
        return geminiReply({
          companies: [
            { name: "Huntress", ats: "greenhouse", slug: "huntress", why: "MDR provider" },
            { name: "Sophos", ats: "greenhouse", slug: "sophos", why: "Security vendor" }, // really on Lever
            { name: "Nowhere", ats: "ashby", slug: "nowhere", why: "Doesn't exist" },
            { name: "Tracked", ats: "greenhouse", slug: "tracked", why: "Already tracked" },
          ],
        });
      }
      if (url.includes("boards-api.greenhouse.io/v1/boards/huntress/jobs")) {
        expect(url).toContain("content=false");
        const job = (id: number, title: string, location: string) => ({ id, title, location: { name: location }, absolute_url: `https://x.test/${id}` });
        return json({
          jobs: [
            job(1, "Security Operations Analyst", "Remote US"),
            job(2, "Senior Security Analyst", "Remote US"), // too senior for entry
            job(3, "Security Operations Analyst", "Australia"), // not US
            job(4, "Account Executive, Sales", "Austin, TX"), // excluded word
            job(5, "Office Manager", "Ellicott City, MD"),
          ],
        });
      }
      if (url.includes("api.lever.co/v0/postings/sophos")) {
        return json([{ id: "a", text: "SOC Analyst I", categories: { location: "Remote - United States" }, hostedUrl: "https://x.test/a", createdAt: Date.now(), descriptionPlain: "" }]);
      }
      return json({ error: "not found" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await suggestCompanies({ profile, existing: [{ ats: "greenhouse", slug: "tracked" }], deadline: Date.now() + 30_000 });
    expect(out.map((s) => `${s.ats}:${s.slug}`)).toEqual(["greenhouse:huntress", "lever:sophos"]);
    expect(out[0]).toMatchObject({ usJobs: 3, goodMatches: 1, topTitles: ["Security Operations Analyst"] });
    expect(out[1]).toMatchObject({ usJobs: 1, goodMatches: 1 });
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/tracked"))).toBe(false);
  });
});
