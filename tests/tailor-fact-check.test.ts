import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { TailoredResume } from "@/db/schema";
import type { AiJsonFn } from "@/lib/jobs/ai-score";
import { findUnsupported, gateCoverLetter, gateTailoredResume, resumeFacts } from "@/lib/tailor/fact-check";
import { tailorResume, writeCoverLetter } from "@/lib/tailor/generate";
import { confirmStructure } from "@/lib/tailor/structure";
import { parsed } from "./fixtures/fake-resume-parsed";

/**
 * Tailoring may only reorder, emphasize, rephrase or leave out what the resume already says. This
 * enforces it on a fake resume (tests/fixtures/fake-resume.txt, a made-up person): every kind of
 * invented fact (employer, title, skill, school, date, number, degree, certification) is caught and
 * undone, while truthful rewording passes.
 */

const text = readFileSync(path.join(process.cwd(), "tests/fixtures/fake-resume.txt"), "utf8");

const base = confirmStructure(parsed, text);
const facts = resumeFacts(base);
const intern = base.sections[0].entries[0];

describe("findUnsupported", () => {
  it("passes truthful rewording, reordering and the resume's own numbers", () => {
    expect(findUnsupported("Built 6 data visualization dashboards in Tableau to track on-time delivery for 3 regional warehouses", [intern.bullets[0].text, intern.title, intern.org])).toEqual([]);
    expect(findUnsupported("Cut weekly reporting from 5 hours to 1 hour by writing PostgreSQL queries", [intern.bullets[1].text])).toEqual([]);
  });

  it.each([
    ["an employer", "Built 6 Tableau dashboards at Amazon for 3 regional warehouses", "Amazon"],
    ["a job title", "As Senior Data Engineer, built 6 Tableau dashboards for 3 regional warehouses", "Senior"],
    ["a skill", "Built 6 Tableau and Power BI dashboards for 3 regional warehouses", "Power BI"],
    ["a school", "Built 6 Tableau dashboards for 3 warehouses during a Stanford University project", "Stanford"],
    ["a date", "Built 6 Tableau dashboards for 3 regional warehouses in 2021", "2021"],
    ["a metric", "Built 6 Tableau dashboards for 3 regional warehouses, saving 20% in costs", "20%"],
    ["a certification", "Certified Tableau Data Analyst who built 6 dashboards for 3 regional warehouses", "Certified"],
    ["a degree", "Built 6 Tableau dashboards for 3 regional warehouses while finishing a master's degree", "master's"],
  ])("catches %s", (_, sentence, term) => {
    const found = findUnsupported(sentence, [intern.bullets[0].text, intern.title, intern.org]);
    expect(found.map((v) => v.term.toLowerCase())).toContain(term.toLowerCase());
  });

  it("checks the posting's own tools too, so a requirement the resume lacks can't be claimed", () => {
    expect(findUnsupported("Wrote SQL queries and Snowpark jobs", [intern.bullets[1].text], { terms: ["Snowpark"] }).map((v) => v.term)).toContain("Snowpark");
  });

  it("lets a cover letter name the employer and role from the posting, not claim their tools", () => {
    const allowedNames = ["Acme Freight", "Operations Data Analyst"];
    expect(findUnsupported("I'd like to bring my SQL reporting to Acme Freight as an Operations Data Analyst.", [facts], { allowedNames })).toEqual([]);
    expect(findUnsupported("At Acme Freight I would use my Snowflake experience.", [facts], { allowedNames }).map((v) => v.term)).toContain("Snowflake");
  });
});

const tailored = (over: (d: TailoredResume) => void = () => {}): TailoredResume => {
  const d: TailoredResume = {
    summary: "Entry-level data analyst building SQL reports and Tableau dashboards for operations teams.",
    sections: base.sections.map((s) => ({ id: s.id, items: [...s.items], entries: s.entries.map((e) => ({ id: e.id, bullets: e.bullets.map((b) => ({ sourceId: b.id, text: b.text })) })) })),
  };
  over(d);
  return d;
};

describe("gateTailoredResume", () => {
  it("keeps truthful rewording and the AI's bullet order", () => {
    const doc = tailored((d) => {
      const b = d.sections[0].entries[0].bullets;
      d.sections[0].entries[0].bullets = [{ ...b[1], text: "Cut weekly report preparation from 5 hours to 1 hour with PostgreSQL queries" }, b[0]];
    });
    const { value, warnings } = gateTailoredResume(base, doc);
    expect(warnings).toEqual([]);
    expect(value.sections[0].entries[0].bullets.map((b) => b.text)).toEqual([
      "Cut weekly report preparation from 5 hours to 1 hour with PostgreSQL queries",
      intern.bullets[0].text,
    ]);
  });

  it("puts back the original wording of a bullet that invents something, and the base summary for an invented one", () => {
    const doc = tailored((d) => {
      d.summary = "AWS Certified data analyst with 5 years of experience at Deloitte.";
      d.sections[0].entries[0].bullets[0].text = "Built 12 Tableau dashboards that saved $2M across 3 regional warehouses";
    });
    const { value, warnings } = gateTailoredResume(base, doc);
    expect(value.summary).toBe(base.summary);
    expect(value.sections[0].entries[0].bullets[0].text).toBe(intern.bullets[0].text);
    expect(warnings).toHaveLength(2);
    expect(JSON.stringify(value)).not.toMatch(/Deloitte|AWS|\$2M|12 Tableau/);
  });

  it("drops skills, bullets and sections the base doesn't have, and keeps every job and section", () => {
    const doc = tailored((d) => {
      d.sections[2].items = ["Tableau", "Kubernetes", "SQL"];
      d.sections[0].entries[0].bullets.push({ sourceId: "s1.e1.b99", text: "Led a team of 12 engineers at Google" });
      d.sections[0].entries = [d.sections[0].entries[0]]; // the help desk job left out
      d.sections.splice(1, 1); // education left out
      d.sections.push({ id: "s9", items: ["Top Secret clearance"], entries: [] });
    });
    const { value, warnings } = gateTailoredResume(base, doc);
    expect(value.sections.find((s) => s.id === "s3")!.items).toEqual(["Tableau", "SQL"]);
    expect(warnings.join(" ")).toContain("Kubernetes");
    expect(JSON.stringify(value)).not.toMatch(/Google|Kubernetes|Top Secret/);
    // Leaving out a whole job or the education section would hide a date gap: both come back.
    expect(value.sections.map((s) => s.id).sort()).toEqual(["s1", "s2", "s3"]);
    expect(value.sections[0].entries.map((e) => e.id)).toEqual(["s1.e1", "s1.e2"]);
  });

  it("accepts skills taken from a skills sentence, not ones the sentence lacks", () => {
    const sentence = structuredClone(base);
    sentence.sections[2].items = ["Technical Skills: Proficient with SQL, Tableau and Python; skilled in Excel"];
    const doc = tailored((d) => (d.sections[2].items = ["SQL", "Python.", "Snowflake"]));
    const { value, warnings } = gateTailoredResume(sentence, doc);
    expect(value.sections[2].items).toEqual(["SQL", "Python"]);
    expect(warnings).toEqual([expect.stringContaining("Snowflake")]);
  });

  it("checks a summary against the whole resume text, lines the parse didn't place included", () => {
    const withCoursework = { ...base, source: `${text}\nRelevant coursework: Database Management, Business Statistics` };
    const doc = tailored((d) => (d.summary = "Information Systems graduate with coursework in Database Management."));
    expect(gateTailoredResume(withCoursework, doc).value.summary).toBe("Information Systems graduate with coursework in Database Management.");
    expect(gateTailoredResume({ ...base, source: undefined }, doc).value.summary).toBe(base.summary);
  });

  it("never lets the AI write employers, titles or dates: the tailored resume only has ids and bullet text", () => {
    const { value } = gateTailoredResume(base, tailored());
    for (const s of value.sections) for (const e of s.entries) expect(Object.keys(e).sort()).toEqual(["bullets", "id"]);
  });
});

describe("gateCoverLetter", () => {
  it("drops sentences that claim what the resume doesn't, keeps the rest", () => {
    const { value, warnings } = gateCoverLetter(
      [
        "I'm applying for the Operations Data Analyst role at Acme Freight. At Prairie Logistics Co. I built 6 Tableau dashboards for 3 regional warehouses.",
        "I also hold a PMP certification and led migrations to Snowflake. I cut weekly report preparation from 5 hours to 1 hour with SQL.",
      ],
      base,
      { allowedNames: ["Acme Freight", "Operations Data Analyst"], terms: ["Snowflake"] },
    );
    expect(value.join(" ")).not.toMatch(/PMP|Snowflake/);
    expect(value.join(" ")).toContain("5 hours to 1 hour");
    expect(warnings).toHaveLength(1);
  });
});

/** A fake model that answers each call with the next canned answer. */
function fakeAi(answers: unknown[]): { ai: AiJsonFn; calls: string[] } {
  const calls: string[] = [];
  const ai = (async (opts: { prompt: string }) => {
    calls.push(opts.prompt);
    return { data: answers[Math.min(calls.length - 1, answers.length - 1)], provider: "gemini", model: "fake" };
  }) as unknown as AiJsonFn;
  return { ai, calls };
}

describe("end to end with a model that fabricates", () => {
  const job = { title: "Operations Data Analyst", company: "Acme Freight", description: "Requirements: SQL, Tableau, Snowflake. 2+ years." };
  const focus = { matched: ["SQL", "Tableau"], missing: ["Snowflake"] };

  it("asks once more with the violations named, and reverts whatever is still invented", async () => {
    const lying = tailored((d) => {
      d.summary = "Data analyst with 3 years of Snowflake experience.";
      d.sections[0].entries[0].bullets[0].text = "Built 6 Snowflake and Tableau dashboards for 3 regional warehouses";
    });
    const { ai, calls } = fakeAi([lying, lying]);
    const r = await tailorResume({ base, job, focus, ai, deadline: Date.now() + 60_000 });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("Snowflake");
    expect(JSON.stringify(r.value)).not.toContain("Snowflake");
    expect(r.value.summary).toBe(base.summary);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("doesn't let a letter claim a tool just because the posting names it", async () => {
    const posting = { ...job, description: "You'll build reports in Looker and Tableau for our Fleet Ops group.", locationRaw: "Denver, CO" };
    const letter = {
      paragraphs: [
        "I'm applying for the Operations Data Analyst role at Acme Freight in Denver. I have built Looker dashboards for operations teams.",
        "At Prairie Logistics Co. I built 6 Tableau dashboards for 3 regional warehouses.",
      ],
    };
    const { ai } = fakeAi([letter, letter]);
    const r = await writeCoverLetter({ base, job: posting, focus: { matched: [], missing: [] }, ai, deadline: Date.now() + 5_000 });
    expect(r.value.join(" ")).not.toContain("Looker");
    expect(r.value.join(" ")).toContain("Denver");
  });

  it("doesn't retry without time for it", async () => {
    const { ai, calls } = fakeAi([tailored((d) => (d.summary = "Snowflake expert."))]);
    await tailorResume({ base, job, focus, ai, deadline: Date.now() + 5_000 });
    expect(calls).toHaveLength(1);
  });

  it("keeps a cover letter's true sentences and drops invented ones", async () => {
    const para = (s: string) => `${s} At Prairie Logistics Co. I built 6 Tableau dashboards that tracked on-time delivery for 3 regional warehouses, and I wrote SQL queries in PostgreSQL that cut weekly report preparation from 5 hours to 1 hour.`;
    const letter = {
      paragraphs: [
        para("I'm applying for the Operations Data Analyst role at Acme Freight."),
        para("I have 4 years of Snowflake experience."),
        "I would welcome the chance to talk about how my reporting work could help Acme Freight's operations team.",
      ],
    };
    const { ai } = fakeAi([letter, letter]);
    const r = await writeCoverLetter({ base, job, focus, ai, deadline: Date.now() + 60_000 });
    expect(r.value.join(" ")).not.toMatch(/Snowflake|4 years/);
    expect(r.value.join(" ")).toContain("Acme Freight");
    // Short of 250 words after the gate: flagged for the user to edit.
    expect(r.warnings.some((w) => w.includes("words"))).toBe(true);
  });
});

describe("confirmStructure", () => {
  it("keeps only what the resume text contains", () => {
    const withInventions = structuredClone(parsed);
    withInventions.sections[0].entries[0].bullets.push("Presented findings to the CEO weekly");
    withInventions.sections[0].entries[0].org = "Prairie Logistics International";
    withInventions.sections[2].items.push("Kubernetes");
    const s = confirmStructure(withInventions, text);
    expect(s.sections[0].entries[0].bullets).toHaveLength(3);
    expect(s.sections[0].entries[0].org).toBeUndefined();
    expect(s.sections[2].items).not.toContain("Kubernetes");
    expect(s.warnings).toHaveLength(3);
  });

  it("matches a bullet the model joined slightly differently to the resume's own line, and gives stable ids", () => {
    const joined = structuredClone(parsed);
    joined.sections[0].entries[1].bullets[0] = "Resolved about 40 tickets per week for students and staff in ServiceNow";
    const s = confirmStructure(joined, text);
    expect(s.sections[0].entries[1].bullets[0]).toEqual({ id: "s1.e2.b1", text: "Resolved about 40 tickets a week for students and staff in ServiceNow" });
    expect(base.sections[0].entries[0].bullets.map((b) => b.id)).toEqual(["s1.e1.b1", "s1.e1.b2", "s1.e1.b3"]);
    expect(base.warnings).toEqual([]);
  });
});
