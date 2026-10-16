import { describe, expect, it } from "vitest";
import { createPglite, schema } from "@/db";

describe("database migrations", () => {
  it("apply cleanly to an empty Postgres and support basic writes", async () => {
    const db = await createPglite("memory://");
    const [user] = await db.insert(schema.users).values({ email: "test@example.com" }).returning();
    await db.insert(schema.profiles).values({ userId: user.id, skills: ["typescript"] });
    const profile = await db.query.profiles.findFirst();
    expect(profile?.skills).toEqual(["typescript"]);
    expect(profile?.emailEnabled).toBe(true);
    expect(profile?.remotePreference).toBe("any");
  });
});
