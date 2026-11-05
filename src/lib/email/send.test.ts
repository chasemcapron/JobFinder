import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));

const sendMail = vi.fn();
const createTransport = vi.fn((options: unknown) => ({ options, sendMail, close: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: (o: unknown) => createTransport(o) } }));

const { canScheduleEmail, emailChannel, sendEmail } = await import("./send");
const { featureStatus } = await import("@/lib/env");

const message = { to: "me@example.com", subject: "Hi", html: "<p>Hi</p>", text: "Hi", idempotencyKey: "morning-digest/u1/2026-07-01" };

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("EMAIL_FROM", "Job Finder <jobs@example.com>");
  vi.stubEnv("GMAIL_USER", "");
  vi.stubEnv("GMAIL_APP_PASSWORD", "");
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

  it("warns in Settings about Resend's shared test sender, which only delivers to the account's own address", () => {
    const note = () => featureStatus().find((f) => f.key === "email")?.note;
    expect(note()).toBe("Sent with Resend, at 7:00 AM Central");
    vi.stubEnv("EMAIL_FROM", "Job Finder <onboarding@resend.dev>");
    expect(note()).toMatch(/only delivers to the Resend account's own address/);
  });

  it("throws on other errors", async () => {
    send.mockResolvedValue({ data: null, error: { name: "invalid_from_address", message: "Invalid `from` field", statusCode: 422 } });
    await expect(sendEmail(message)).rejects.toThrow("Resend: Invalid `from` field");
    send.mockResolvedValue({ data: null, error: { name: "concurrent_idempotent_requests", message: "In progress", statusCode: 409 } });
    await expect(sendEmail(message)).rejects.toThrow("Resend: In progress");
  });
});

describe("sendEmail through Gmail", () => {
  beforeEach(() => {
    vi.stubEnv("GMAIL_USER", "owner@gmail.com");
    vi.stubEnv("GMAIL_APP_PASSWORD", "abcd efgh ijkl mnop");
    sendMail.mockReset();
    createTransport.mockClear();
  });

  it("is used over Resend when both are set, and can't schedule", () => {
    expect(emailChannel()).toBe("gmail");
    expect(canScheduleEmail()).toBe(false);
    vi.stubEnv("GMAIL_APP_PASSWORD", "");
    expect(emailChannel()).toBe("resend");
    expect(canScheduleEmail()).toBe(true);
  });

  it("sends from the Gmail account over SMTP, to anyone", async () => {
    sendMail.mockResolvedValue({ messageId: "<m1@gmail.com>" });
    expect(await sendEmail({ ...message, to: "friend@example.com" })).toEqual({ channel: "gmail", id: "<m1@gmail.com>" });
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: "owner@gmail.com", pass: "abcdefghijklmnop" } }),
    );
    expect(sendMail).toHaveBeenCalledWith({
      from: { name: "Job Finder", address: "owner@gmail.com" },
      to: "friend@example.com",
      subject: "Hi",
      html: "<p>Hi</p>",
      text: "Hi",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("names Gmail in errors", async () => {
    sendMail.mockRejectedValue(new Error("Invalid login: 535-5.7.8 Username and Password not accepted"));
    await expect(sendEmail(message)).rejects.toThrow("Gmail: Invalid login");
  });
});
