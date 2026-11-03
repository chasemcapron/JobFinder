import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { Packer } from "docx";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPglite, schema, type Db } from "@/db";
import type { TailoredResume } from "@/db/schema";
import { markApplied } from "@/lib/applications";
import type { AiJsonFn } from "@/lib/jobs/ai-score";
import { ensureProfile } from "@/lib/profile";
import { extractContact } from "@/lib/tailor/contact";
import { diffTailored, wordDiff } from "@/lib/tailor/diff";
import { coverLetterDocx, resumeDocx } from "@/lib/tailor/export-docx";
import { entryLines, renderTailored, splitLabel } from "@/lib/tailor/render";
import { addCoverLetter, createTailoredResume, ensureStructure, saveEdits, TailorError } from "@/lib/tailor/service";
import { confirmStructure } from "@/lib/tailor/structure";
import { parsed } from "./fixtures/fake-resume-parsed";

const text = readFileSync(path.join(process.cwd(), "tests/fixtures/fake-resume.txt"), "utf8");
const base = confirmStructure(parsed, text);
const fromBase = (): TailoredResume => ({
  summary: base.summary,
  sections: base.sections.map((s) => ({ id: s.id, items: [...s.items], entries: s.entries.map((e) => ({ id: e.id, bullets: e.bullets.map((b) => ({ sourceId: b.id, text: b.text })) })) })),
});

describe("diffTailored", () => {
  it("labels every bullet kept, moved, rephrased or left out", () => {
    const doc = fromBase();
    const intern = doc.sections[0].entries[0];
    intern.bullets = [intern.bullets[1], { ...intern.bullets[0], text: "Built 6 Tableau dashboards for on-time delivery across 3 regional warehouses" }];
    doc.sections[2].items = ["Tableau", "SQL"];
    const changes = diffTailored(base, doc);
    expect(changes.counts).toEqual({ kept: 2, moved: 1, rephrased: 1, dropped: 1 });
    const bullets = changes.sections[0].entries[0].bullets;
    expect(bullets.map((b) => b.status)).toEqual(["moved", "rephrased", "dropped"]);
    // A list of single skills is compared as the one line it prints as.
    expect(changes.sections[2].items).toEqual([{ status: "rephrased", text: "Tableau, SQL", ops: expect.any(Array) }]);
    expect(changes.summary.status).toBe("kept");
  });

  it("doesn't call bullets moved when an earlier one was only left out", () => {
    const doc = fromBase();
    const intern = doc.sections[0].entries[0];
    intern.bullets = [intern.bullets[0], intern.bullets[2]];
    expect(diffTailored(base, doc).sections[0].entries[0].bullets.map((b) => b.status)).toEqual(["kept", "kept", "dropped"]);
  });

  it("word diff marks what was added and removed", () => {
    expect(wordDiff("built 6 dashboards", "built 6 Tableau dashboards")).toEqual([
      { op: "same", text: "built 6" },
      { op: "add", text: "Tableau" },
      { op: "same", text: "dashboards" },
    ]);
  });
});

describe("contact header and exports", () => {
  const contact = extractContact(text);

  it("reads the contact header from the resume, locally", () => {
    expect(contact).toEqual({
      name: "Jordan Example",
      email: "jordan.example@example.com",
      phone: "(217) 555-0142",
      location: "Springfield, IL",
      links: ["linkedin.com/in/jordan-example"],
    });
  });

  it("takes the city only from the contact lines, not from a school line further down", () => {
    const resume = "Jordan Example\njordan@example.com | (217) 555-0142\nEDUCATION\nMays Business School, College Station, TX";
    expect(extractContact(resume).location).toBeNull();
    expect(extractContact("Jordan Example\nAustin, TX 78701  •  jordan@example.com").location).toBe("Austin, TX");
  });

  it("builds the Word resume in the copied layout: Times, ruled headings, right-aligned places and dates, no tables", async () => {
    const zip = await JSZip.loadAsync(await Packer.toBuffer(resumeDocx(renderTailored(base, fromBase(), contact))));
    const xml = await zip.file("word/document.xml")!.async("string");
    const styles = await zip.file("word/styles.xml")!.async("string");
    const words = xml.replace(/<[^>]+>/g, " ");
    for (const t of ["Jordan Example", "EXPERIENCE", "Prairie Logistics Co.", "Data Analyst Intern", "May 2024 - Aug 2024", base.sections[0].entries[0].bullets[0].text, "SQL, PostgreSQL, Tableau"]) {
      expect(words).toContain(t);
    }
    expect(styles + xml).toContain('w:ascii="Times New Roman"');
    expect(xml).toMatch(/<w:pBdr>\s*<w:bottom /); // the rule under each heading
    expect(xml).toMatch(/<w:tab w:val="right"/); // places and dates on the right
    expect(xml).not.toMatch(/<w:tbl\b|<w:drawing\b|<w:cols w:num="[2-9]"/);
    expect(xml).toContain("<w:numPr>"); // real list bullets, not typed symbols
  });

  it("lays out entry headers like the owner's resume", () => {
    expect(entryLines({ org: "Prairie Logistics Co.", location: "Springfield, IL", title: "Data Analyst Intern", dates: "May 2024 - Aug 2024" })).toEqual([
      { left: "Prairie Logistics Co.", right: "Springfield, IL", leftStyle: "bold", rightStyle: "bold" },
      { left: "Data Analyst Intern", right: "May 2024 - Aug 2024", leftStyle: "italic", rightStyle: "regular" },
    ]);
    // A project: its name and dates on one bold line.
    expect(entryLines({ title: "Aethermart Database", dates: "Aug 2025 - Dec 2025" })).toEqual([
      { left: "Aethermart Database", right: "Aug 2025 - Dec 2025", leftStyle: "bold", rightStyle: "bold" },
    ]);
    expect(splitLabel("Technical Skills: SQL, Python")).toEqual({ label: "Technical Skills:", text: "SQL, Python" });
    expect(splitLabel("SQL, Python")).toEqual({ label: "", text: "SQL, Python" });
  });

  it("builds the cover letter with the greeting, the body and the sign-off", async () => {
    const view = { contact, date: "November 4, 2026", company: "Acme Freight", role: "Operations Data Analyst", paragraphs: ["First paragraph.", "Second paragraph."] };
    const zip = await JSZip.loadAsync(await Packer.toBuffer(coverLetterDocx(view)));
    const words = (await zip.file("word/document.xml")!.async("string")).replace(/<[^>]+>/g, " ");
    for (const t of ["Dear Hiring Manager,", "First paragraph.", "Second paragraph.", "Sincerely,", "Re: Operations Data Analyst, Acme Freight"]) expect(words).toContain(t);
  });
});

describe("tailoring service", () => {
  let db: Db;
  let userId: string;
  let jobId: string;
  const calls: string[] = [];
  // One fake model for every step, answering by what's asked for.
  const ai = (async (opts: { prompt: string; system: string }) => {
    calls.push(opts.system.slice(0, 20));
    if (opts.system.startsWith("You split a resume")) return { data: parsed, provider: "gemini", model: "fake" };
    if (opts.system.startsWith("You tailor")) {
      const doc = fromBase();
      doc.sections[0].entries[0].bullets.reverse();
      const data = { sections: doc.sections.map((s) => ({ ...s, items: s.items.map((text, k) => ({ id: `${s.id}#${k}`, text })) })) };
      return { data, provider: "gemini", model: "fake" };
    }
    return { data: { paragraphs: ["I'm applying for the Operations Data Analyst role at Acme Freight."] }, provider: "gemini", model: "fake" };
  }) as unknown as AiJsonFn;

  beforeEach(async () => {
    calls.length = 0;
    db = await createPglite("memory://");
    const [u] = await db.insert(schema.users).values({ email: "t@example.com" }).returning();
    userId = u.id;
    await ensureProfile(userId, db);
    await db.update(schema.profiles).set({ resumeText: text }).where(eq(schema.profiles.userId, userId));
    const [j] = await db
      .insert(schema.jobs)
      .values({ source: "greenhouse", externalId: "acme:9", dedupeKey: "acme|ops data analyst", title: "Operations Data Analyst", company: "Acme Freight", applyUrl: "https://example.com/9", description: "SQL and Tableau." })
      .returning();
    jobId = j.id;
    await db.insert(schema.jobMatches).values({ userId, jobId, score: 80, keywordScore: 70 });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("parses the resume once per resume text, makes numbered versions and keeps each version's base", async () => {
    await ensureStructure(userId, { db, ai });
    await ensureStructure(userId, { db, ai });
    expect(calls.filter((c) => c.startsWith("You split"))).toHaveLength(1);

    const v1 = await createTailoredResume(userId, jobId, { db, ai });
    const v2 = await createTailoredResume(userId, jobId, { db, ai });
    expect([v1.version, v2.version]).toEqual([1, 2]);
    expect(v1.base.sections[0].entries[0].org).toBe("Prairie Logistics Co.");

    const withLetter = await addCoverLetter(userId, jobId, 2, { db, ai });
    expect(withLetter.coverLetter?.paragraphs[0]).toContain("Acme Freight");
    // Too short for 250 words: the user is told to edit it.
    expect(withLetter.factCheck.warnings.some((w) => w.includes("words"))).toBe(true);
  });

  it("doesn't save a letter the gate emptied, and a letter cleared in the editor counts as none", async () => {
    await ensureStructure(userId, { db, ai });
    await createTailoredResume(userId, jobId, { db, ai });
    const allInvented = (async () => ({ data: { paragraphs: ["I hold a PMP certification."] }, provider: "gemini", model: "fake" })) as unknown as AiJsonFn;
    await expect(addCoverLetter(userId, jobId, 1, { db, ai: allInvented, deadline: Date.now() + 5_000 })).rejects.toThrow(TailorError);
    await addCoverLetter(userId, jobId, 1, { db, ai });
    const cleared = await saveEdits(userId, jobId, 1, { resume: fromBase(), paragraphs: [] }, db);
    expect(cleared.coverLetter).toBeNull();
  });

  it("won't edit a version made before tailoring kept the resume's shape", async () => {
    await ensureStructure(userId, { db, ai });
    const v = await createTailoredResume(userId, jobId, { db, ai });
    const old = fromBase();
    old.sections[0].entries[0].bullets.reverse(); // the old rules could reorder
    old.summary = "An AI summary from the old rules.";
    await db.update(schema.tailoredDocuments).set({ resume: old }).where(eq(schema.tailoredDocuments.id, v.id));
    await expect(saveEdits(userId, jobId, v.version, { resume: fromBase(), paragraphs: null }, db)).rejects.toThrow(/before tailoring kept/);
  });

  it("only works on the user's own jobs", async () => {
    const [other] = await db.insert(schema.users).values({ email: "o@example.com" }).returning();
    await ensureProfile(other.id, db);
    await db.update(schema.profiles).set({ resumeText: text }).where(eq(schema.profiles.userId, other.id));
    await ensureStructure(other.id, { db, ai });
    await expect(createTailoredResume(other.id, jobId, { db, ai })).rejects.toThrow(TailorError);
    await ensureStructure(userId, { db, ai });
    await createTailoredResume(userId, jobId, { db, ai });
    await expect(addCoverLetter(other.id, jobId, 1, { db, ai })).rejects.toThrow(TailorError);
    await expect(saveEdits(other.id, jobId, 1, { resume: fromBase(), paragraphs: null }, db)).rejects.toThrow(TailorError);
  });

  it("saves the user's edits in the base's shape: an emptied bullet keeps its wording, unknown ids are ignored", async () => {
    await ensureStructure(userId, { db, ai });
    await createTailoredResume(userId, jobId, { db, ai });
    const edited = fromBase();
    edited.sections[0].entries[0].bullets[0].text = "My own wording, 6 dashboards.";
    edited.sections[0].entries[0].bullets[1].text = "   ";
    edited.sections[0].entries[0].bullets.push({ sourceId: "nope", text: "Injected" });
    const row = await saveEdits(userId, jobId, 1, { resume: edited, paragraphs: ["My letter."] }, db);
    expect(row.edited).toBe(true);
    const bullets = base.sections[0].entries[0].bullets;
    expect(row.resume.sections[0].entries[0].bullets.map((b) => b.text)).toEqual(["My own wording, 6 dashboards.", bullets[1].text, bullets[2].text]);
    expect(row.coverLetter).toEqual({ paragraphs: ["My letter."] });
  });

  it("links the newest version to the application and puts its link in the Sheet row", async () => {
    vi.stubEnv("APP_URL", "https://jobs.example.com");
    await ensureStructure(userId, { db, ai });
    await createTailoredResume(userId, jobId, { db, ai });
    await createTailoredResume(userId, jobId, { db, ai });
    await db
      .update(schema.profiles)
      .set({ sheetId: "sheet-abc", sheetColumnMap: { company: "A", title: "B", tailored: "C" } })
      .where(eq(schema.profiles.userId, userId));
    const fetchOk = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("batchGet") ? new Response(JSON.stringify({ valueRanges: [{ values: [["Company"]] }] })) : new Response(JSON.stringify({ updatedRange: "A2:C2" })),
    ) as unknown as typeof fetch;
    const { applicationId, sync } = await markApplied(userId, jobId, { db, getToken: async () => "tok", fetchImpl: fetchOk });
    expect(sync.status).toBe("synced");
    const linked = await db.query.tailoredDocuments.findMany({ where: eq(schema.tailoredDocuments.applicationId, applicationId) });
    expect(linked.map((r) => r.version)).toEqual([2]);
    const put = (fetchOk as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1) as [string, RequestInit];
    expect(JSON.parse(String(put[1].body)).values[0]).toEqual(["Acme Freight", "Operations Data Analyst", `https://jobs.example.com/jobs/${jobId}/tailor?v=2`]);
  });
});
