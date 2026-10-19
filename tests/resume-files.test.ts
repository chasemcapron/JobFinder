import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPglite, schema, type Db } from "@/db";

let db: Db;
vi.mock("@/db", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/db")>()), getDb: async () => db }));

const { commitResumeFile, getSavedResume, storePendingResume } = await import("@/lib/resume/file-store");

const pdf = (text: string) => ({ kind: "pdf" as const, fileName: `${text}.pdf`, data: new TextEncoder().encode(`%PDF ${text}`) });

describe("resume file store", () => {
  let userId: string;
  beforeEach(async () => {
    db = await createPglite("memory://");
    [{ id: userId }] = await db.insert(schema.users).values({ email: "a@example.com" }).returning();
  });

  it("keeps an upload pending until the profile is saved", async () => {
    await storePendingResume(userId, pdf("v1"));
    expect(await getSavedResume(userId)).toBeNull();
    await commitResumeFile(userId, { resumeTextChanged: true, fileName: "v1.pdf" });
    const saved = await getSavedResume(userId);
    expect(saved?.fileName).toBe("v1.pdf");
    expect(saved?.data.toString()).toBe("%PDF v1");
  });

  it("promotes a re-upload of the same file even when the text is unchanged", async () => {
    await storePendingResume(userId, pdf("v1"));
    await commitResumeFile(userId, { resumeTextChanged: false, fileName: "v1.pdf" });
    expect((await getSavedResume(userId))?.fileName).toBe("v1.pdf");
  });

  it("keeps the saved file when only skills are edited later", async () => {
    await storePendingResume(userId, pdf("v1"));
    await commitResumeFile(userId, { resumeTextChanged: true, fileName: "v1.pdf" });
    await commitResumeFile(userId, { resumeTextChanged: false, fileName: "v1.pdf" });
    expect((await getSavedResume(userId))?.fileName).toBe("v1.pdf");
  });

  it("replaces the saved file with a newer upload", async () => {
    await storePendingResume(userId, pdf("v1"));
    await commitResumeFile(userId, { resumeTextChanged: true, fileName: "v1.pdf" });
    await storePendingResume(userId, pdf("v2"));
    await commitResumeFile(userId, { resumeTextChanged: true, fileName: "v2.pdf" });
    expect((await getSavedResume(userId))?.fileName).toBe("v2.pdf");
  });

  it("drops the saved file when new text is pasted instead", async () => {
    await storePendingResume(userId, pdf("v1"));
    await commitResumeFile(userId, { resumeTextChanged: true, fileName: "v1.pdf" });
    await commitResumeFile(userId, { resumeTextChanged: true, fileName: null });
    expect(await getSavedResume(userId)).toBeNull();
  });

  it("never returns another user's file", async () => {
    const [{ id: other }] = await db.insert(schema.users).values({ email: "b@example.com" }).returning();
    await storePendingResume(other, pdf("theirs"));
    await commitResumeFile(other, { resumeTextChanged: true, fileName: "theirs.pdf" });
    expect(await getSavedResume(userId)).toBeNull();
  });
});
