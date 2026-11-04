import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { TailoredResume } from "@/db/schema";
import type { AiJsonFn } from "@/lib/jobs/ai-score";
import { findUnsupported, gateCoverLetter, gateTailoredResume, LINE_CHARS, resumeFacts, tooLong } from "@/lib/tailor/fact-check";
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

  it("accepts 'degree' for one the resume names, not when it names none", () => {
    expect(findUnsupported("I am pursuing this degree full time", ["Master of Science in Information Systems"])).toEqual([]);
    expect(findUnsupported("I am pursuing this degree full time", ["B.S. in Information Systems"])).toEqual([]);
    for (const looksLikeOne of ["Data Analyst Intern", "IT Support Associate", "Scrum Master", "MS Excel", "Boston, MA", "latency under 200 ms"]) {
      expect(findUnsupported("I am pursuing a degree full time", [looksLikeOne]).map((v) => v.term)).toEqual(["degree"]);
    }
  });

  it("reads amounts like $1M+ as numbers, not names", () => {
    expect(findUnsupported("Reconciled $1M+ in monthly transfers", ["Reconciled over $1M+ of transfers each month"])).toEqual([]);
    expect(findUnsupported("Reconciled $2M+ in monthly transfers", ["Reconciled over $1M+ of transfers each month"]).map((v) => v.term)).toEqual(["2"]);
  });

  it("lets a rewrite grow as long as it doesn't wrap to another line", () => {
    const short = "Built 6 Tableau dashboards"; // one line, room to spare
    expect(tooLong("Built 6 Tableau dashboards tracking on-time delivery for regional operations teams", short)).toBe(false);
    expect(tooLong(`${short} ${"x".repeat(LINE_CHARS)}`, short)).toBe(true);
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
  const texts = (d: TailoredResume, s = 0, e = 0) => d.sections[s].entries[e].bullets.map((b) => b.text);

  it("takes truthful rewording, bullet by bullet, in place", () => {
    const doc = tailored((d) => (d.sections[0].entries[0].bullets[1].text = "Cut weekly report preparation from 5 hours to 1 hour with PostgreSQL queries"));
    const { value, warnings } = gateTailoredResume(base, doc);
    expect(warnings).toEqual([]);
    expect(texts(value)).toEqual([intern.bullets[0].text, "Cut weekly report preparation from 5 hours to 1 hour with PostgreSQL queries", intern.bullets[2].text]);
  });

  it("keeps the resume's exact shape: same sections, jobs and bullets, in the same order", () => {
    const doc = tailored((d) => {
      d.sections[0].entries[0].bullets.reverse(); // reordered
      d.sections[0].entries[0].bullets.pop(); // one dropped
      d.sections[0].entries[0].bullets.push({ sourceId: "s1.e1.b99", text: "Led a team of 12 engineers at Google" }); // unknown id
      d.sections[0].entries = [d.sections[0].entries[0]]; // the help desk job left out
      d.sections.reverse(); // sections moved
    });
    const { value } = gateTailoredResume(base, doc);
    expect(value.sections.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(value.sections[0].entries.map((e) => e.id)).toEqual(["s1.e1", "s1.e2"]);
    expect(value.sections[0].entries[0].bullets.map((b) => b.sourceId)).toEqual(["s1.e1.b1", "s1.e1.b2", "s1.e1.b3"]);
    expect(JSON.stringify(value)).not.toContain("Google");
  });

  it("leaves Education, other sections and the summary exactly as written", () => {
    const withSchoolBullet = structuredClone(base);
    withSchoolBullet.sections[1].entries[0].bullets = [{ id: "s2.e1.b1", text: "Dean's list" }];
    const doc = tailored((d) => {
      d.summary = "Rewritten summary.";
      d.sections[1].entries[0].bullets = [{ sourceId: "s2.e1.b1", text: "Dean's list every semester" }];
    });
    const { value } = gateTailoredResume(withSchoolBullet, doc);
    expect(value.summary).toBe(base.summary);
    expect(texts(value, 1)).toEqual(["Dean's list"]);
  });

  it("puts back the original wording of a bullet that invents something", () => {
    const doc = tailored((d) => (d.sections[0].entries[0].bullets[0].text = "Built 12 Tableau dashboards that saved $2M across 3 regional warehouses"));
    const { value, warnings } = gateTailoredResume(base, doc);
    expect(texts(value)[0]).toBe(intern.bullets[0].text);
    expect(warnings).toEqual([expect.stringContaining("\"12\"")]);
  });

  it("puts back a rewrite that drops one of the original's results", () => {
    const doc = tailored((d) => (d.sections[0].entries[0].bullets[1].text = "Wrote SQL queries in PostgreSQL to speed up weekly report preparation"));
    const { value, warnings } = gateTailoredResume(base, doc);
    expect(texts(value)[1]).toBe(intern.bullets[1].text);
    expect(warnings).toEqual([expect.stringContaining("left out")]);
  });

  it("puts back a rewrite that cuts most of the bullet, and ignores lines sent for a section without any", () => {
    const doc = tailored((d) => {
      d.sections[0].entries[0].bullets[2].text = "Cleaned shipment data in Excel";
      d.sections[0].items = ["Data Analyst Intern | Prairie Logistics Co. | May 2024 - Aug 2024"];
    });
    const { value, warnings } = gateTailoredResume(base, doc);
    expect(texts(value)[2]).toBe(intern.bullets[2].text);
    expect(value.sections[0].items).toEqual([]);
    expect(warnings).toEqual([expect.stringContaining("cut too much")]);
  });

  it("puts back a rewrite long enough to push the layout", () => {
    const longer = `${intern.bullets[2].text}, then presented the results to operations leaders in a monthly review meeting`;
    expect(findUnsupported(longer, [intern.bullets[2].text, intern.title, intern.org])).toEqual([]); // truthful, just long
    const { value, warnings } = gateTailoredResume(base, tailored((d) => (d.sections[0].entries[0].bullets[2].text = longer)));
    expect(texts(value)[2]).toBe(intern.bullets[2].text);
    expect(warnings).toEqual([expect.stringContaining("layout")]);
  });

  it("lets a skills line reorder or drop its skills and keep its label, never gain one", () => {
    const labeled = structuredClone(base);
    labeled.sections[2].items = ["Technical Skills: SQL, PostgreSQL, Tableau, Excel, Python", "Tools: ServiceNow, Jira"];
    const doc = tailored((d) => (d.sections[2].items = ["Technical Skills: Tableau, SQL, Python, Excel", "Tools: ServiceNow, Jira, Snowflake"]));
    const { value, warnings } = gateTailoredResume(labeled, doc);
    expect(value.sections[2].items).toEqual(["Technical Skills: Tableau, SQL, Python, Excel", "Tools: ServiceNow, Jira"]);
    expect(warnings).toEqual([expect.stringContaining("Snowflake")]);
    // A line with another label stays as written; a missing line stays as written.
    const relabeled = gateTailoredResume(labeled, tailored((d) => (d.sections[2].items = ["Data: Tableau, SQL"]))).value;
    expect(relabeled.sections[2].items).toEqual(labeled.sections[2].items);
  });

  it("lets a list of single skills be reordered and trimmed as a whole, never gain one", () => {
    // The fixture's skills are single items: they print as one comma-separated line.
    const doc = tailored((d) => (d.sections[2].items = ["Tableau", "SQL", "Python", "Snowflake"]));
    const { value, warnings } = gateTailoredResume(base, doc);
    expect(value.sections[2].items).toEqual(["Tableau", "SQL", "Python"]);
    expect(warnings).toEqual([expect.stringContaining("Snowflake")]);
  });

  it("notes a skills line whose label changed, and doesn't ask a skills line to keep its numbers", () => {
    const labeled = structuredClone(base);
    labeled.sections[2].items = ["Technical Skills: SQL, Tableau, Microsoft Office 365", "Tools: ServiceNow, Jira"];
    const doc = tailored((d) => (d.sections[2].items = ["Skills: SQL, Tableau", "Tools: Jira, ServiceNow"]));
    const { value, warnings } = gateTailoredResume(labeled, doc);
    expect(value.sections[2].items).toEqual(["Technical Skills: SQL, Tableau, Microsoft Office 365", "Tools: Jira, ServiceNow"]);
    expect(warnings).toEqual([expect.stringContaining("label")]);
    // A line returned without its label gets the label back.
    const bare = gateTailoredResume(labeled, tailored((d) => (d.sections[2].items = ["Tableau, SQL", "Tools: ServiceNow, Jira"])));
    expect(bare.value.sections[2].items[0]).toBe("Technical Skills: Tableau, SQL");
    // Dropping "Office 365" (and its number) from a skills line is fine.
    const trimmed = gateTailoredResume(labeled, tailored((d) => (d.sections[2].items = ["Technical Skills: Tableau, SQL", "Tools: ServiceNow, Jira"])));
    expect(trimmed.value.sections[2].items[0]).toBe("Technical Skills: Tableau, SQL");
    // The user's own label fix is kept.
    const fixed = gateTailoredResume(labeled, tailored((d) => (d.sections[2].items = ["Tech Skills: SQL", "Tools: ServiceNow, Jira"])), { trusted: true });
    expect(fixed.value.sections[2].items[0]).toBe("Tech Skills: SQL");
  });

  it("takes the user's own edits as written (trusted), still in the resume's shape", () => {
    const doc = tailored((d) => {
      d.sections[0].entries[0].bullets[0].text = "My own words about 9 dashboards and Looker";
      d.sections[0].entries[0].bullets[1].text = "   ";
      d.sections[0].entries[0].bullets.reverse();
    });
    const { value } = gateTailoredResume(base, doc, { trusted: true });
    expect(texts(value)).toEqual(["My own words about 9 dashboards and Looker", intern.bullets[1].text, intern.bullets[2].text]);
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
/** A tailored resume in the tailoring step's answer shape (skills lines by id); other answers as they are. */
function asAnswer(data: unknown): unknown {
  const doc = data as Partial<TailoredResume>;
  if (!doc.sections) return data;
  return { sections: doc.sections.map((s) => ({ ...s, items: s.items.map((text, k) => ({ id: `${s.id}#${k}`, text })) })) };
}

function fakeAi(answers: unknown[]): { ai: AiJsonFn; calls: string[] } {
  const calls: string[] = [];
  const ai = (async (opts: { prompt: string }) => {
    calls.push(opts.prompt);
    return { data: asAnswer(answers[Math.min(calls.length - 1, answers.length - 1)]), provider: "gemini", model: "fake" };
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

  it("asks again when most bullets come back unchanged, and keeps the best of both answers", async () => {
    const lazy = tailored(); // everything copied back as written
    const second = tailored((d) => {
      d.sections[0].entries[0].bullets[0].text = "Built 6 Tableau dashboards tracking on-time delivery across 3 regional warehouses";
      d.sections[0].entries[0].bullets[1].text = "Wrote PostgreSQL SQL queries that cut weekly report preparation from 5 hours to 1 hour";
      d.sections[0].entries[1].bullets[0].text = "Resolved about 40 tickets a week in ServiceNow for 300 students"; // invented number: stays as written
    });
    const { ai, calls } = fakeAi([lazy, second]);
    const r = await tailorResume({ base, job, focus, ai, deadline: Date.now() + 60_000 });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("came back unchanged");
    const bullets = r.value.sections[0].entries.flatMap((e) => e.bullets.map((b) => b.text));
    expect(bullets[0]).toContain("across 3 regional warehouses");
    expect(bullets[1]).toContain("Wrote PostgreSQL SQL queries");
    expect(bullets.join(" ")).not.toContain("300");
    expect(r.warnings).toEqual([expect.stringContaining("\"300\"")]);
  });

  it("doesn't retry without time for it", async () => {
    const { ai, calls } = fakeAi([tailored((d) => (d.sections[0].entries[0].bullets[0].text = "Built 6 Snowflake dashboards for 3 regional warehouses"))]);
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
