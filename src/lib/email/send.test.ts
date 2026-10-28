import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));

const { sendEmail } = await import("./send");

const message = { to: "me@example.com", subject: "Hi", html: "<p>Hi</p>", text: "Hi", idempotencyKey: "morning-digest/u1/2026-07-01" };

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("EMAIL_FROM", "Job Finder <jobs@example.com>");
  send.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("sendEmail", () => {
  it("hands Resend the delivery time when there is one", async () => {
    send.mockResolvedValue({ data: { id: "re_1" }, error: null });
    const result = await sendEmail({ ...message, scheduledAt: new Date("2026-07-01T12:00:00Z") });
    expect(result).toEqual({ channel: "resend", id: "re_1" });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "me@example.com", scheduledAt: "2026-07-01T12:00:00.000Z" }), {
      idempotencyKey: message.idempotencyKey,
    });

    await sendEmail(message);
    expect(send.mock.calls[1][0]).not.toHaveProperty("scheduledAt");
  });

  it("counts a key Resend already accepted with a different message as sent", async () => {
    send.mockResolvedValue({ data: null, error: { name: "invalid_idempotent_request", message: "Same key, different payload", statusCode: 409 } });
    expect(await sendEmail(message)).toEqual({ channel: "resend", id: null });
  });

  it("throws on other errors", async () => {
    send.mockResolvedValue({ data: null, error: { name: "invalid_from_address", message: "Invalid `from` field", statusCode: 422 } });
    await expect(sendEmail(message)).rejects.toThrow("Resend: Invalid `from` field");
    send.mockResolvedValue({ data: null, error: { name: "concurrent_idempotent_requests", message: "In progress", statusCode: 409 } });
    await expect(sendEmail(message)).rejects.toThrow("Resend: In progress");
  });
});
