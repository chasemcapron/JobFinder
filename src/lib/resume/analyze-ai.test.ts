import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeResume } from "./analyze";

const RESUME = `Jordan Sample
Chicago, IL 60601 · (312) 555-0199 · jordan.sample@mail.com
Security Analyst Intern, Example Bank (2025)
- Monitored Splunk alerts, wrote Python scripts, mapped controls to NIST CSF.
Skills: Python, SQL, Linux, Splunk, Wireshark`;

const answer = {
  titles: ["SOC Analyst", "Security Analyst", "Cybersecurity Analyst"],
  seniority: "entry",
  skills: ["Python", "SQL", "Splunk", "NIST CSF", "python"],
  keywords: ["SIEM", "incident response"],
  avoidTitleTerms: ["credit", "securities", "analyst", "sales", "Senior", "Director"],
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] }, finishReason: "STOP" }] })),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("analyzeResume with Gemini", () => {
  it("sends a redacted resume and returns cleaned-up settings", async () => {
    const result = await analyzeResume(RESUME, { names: ["Jordan Sample"] });
    const sent: string = JSON.parse(fetchMock.mock.calls[0][1].body).contents[0].parts[0].text;
    expect(sent).not.toMatch(/Jordan|555-0199|jordan\.sample@|60601/);
    expect(sent).toContain("Splunk");

    expect(result.source).toBe("gemini");
    expect(result.titles[0]).toBe("SOC Analyst");
    expect(result.seniority).toBe("entry");
    expect(result.skills).toEqual(["Python", "SQL", "Splunk", "NIST CSF"]); // deduped case-insensitively
    // "analyst" appears in the person's own titles and "Senior"/"Director" are seniority words, so they're dropped.
    expect(result.excludeKeywords).toEqual(["credit", "securities", "sales"]);
  });

  it("falls back to the built-in extractor with a notice when Gemini is busy", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: { code: 503, message: "high demand" } }), { status: 503 }));
    const result = await analyzeResume(RESUME);
    expect(result.source).toBe("heuristic");
    expect(result.notice).toMatch(/Gemini is busy.*built-in extractor/);
    expect(result.skills).toContain("Python");
  });
});
