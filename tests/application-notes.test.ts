import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createPglite, schema } from "@/db";
import { NOTE_LIMITS, saveApplicationNotes } from "@/lib/applications";

describe("application notes", () => {
  it("saves notes on the user's own application only, trimmed to their limits", async () => {
    const db = await createPglite("memory://");
    const [me] = await db.insert(schema.users).values({ email: "me@example.com" }).returning();
    const [other] = await db.insert(schema.users).values({ email: "other@example.com" }).returning();
    const [job] = await db
      .insert(schema.jobs)
      .values({ source: "greenhouse", externalId: "1", dedupeKey: "k1", title: "Analyst", company: "Acme", applyUrl: "https://example.com/1" })
      .returning();
    const [mine] = await db.insert(schema.applications).values({ userId: me.id, jobId: job.id }).returning();
    const [theirs] = await db.insert(schema.applications).values({ userId: other.id, jobId: job.id }).returning();
    const at = new Date("2026-11-12T15:00:00Z");

    expect(await saveApplicationNotes(me.id, mine.id, { notes: `  ${"x".repeat(3_000)}  `, contact: " Pat, pat@acme.test ", nextStep: "Phone screen", nextStepAt: at }, db)).toBe(true);
    const [saved] = await db.select().from(schema.applications).where(eq(schema.applications.id, mine.id));
    expect(saved.notes).toHaveLength(NOTE_LIMITS.notes);
    expect(saved).toMatchObject({ contact: "Pat, pat@acme.test", nextStep: "Phone screen", nextStepAt: at });

    expect(await saveApplicationNotes(me.id, theirs.id, { notes: "mine now", contact: "", nextStep: "", nextStepAt: null }, db)).toBe(false);
    const [untouched] = await db.select().from(schema.applications).where(eq(schema.applications.id, theirs.id));
    expect(untouched.notes).toBe("");
  });
});
