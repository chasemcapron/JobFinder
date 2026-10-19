import { afterEach, describe, expect, it, vi } from "vitest";
import { isEmailAllowed } from "./env";

describe("isEmailAllowed", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("allows anyone when ALLOWED_EMAILS is empty", () => {
    vi.stubEnv("ALLOWED_EMAILS", "");
    expect(isEmailAllowed("someone@example.com")).toBe(true);
  });

  it("only allows listed emails, ignoring case and spaces", () => {
    vi.stubEnv("ALLOWED_EMAILS", " Me@Example.com , other@example.com");
    expect(isEmailAllowed("me@example.com")).toBe(true);
    expect(isEmailAllowed("OTHER@example.com ")).toBe(true);
    expect(isEmailAllowed("stranger@example.com")).toBe(false);
    expect(isEmailAllowed(null)).toBe(false);
  });
});
