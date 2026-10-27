import { Resend } from "resend";
import { env } from "@/lib/env";

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Resend sends a message with the same key only once within 24 hours. */
  idempotencyKey?: string;
  /** Resend holds the message and delivers it then (up to 30 days ahead). Sent right away when absent. */
  scheduledAt?: Date;
};
export type SendResult = { channel: "resend" | "console"; id: string | null };

/** The SDK takes no abort signal, so a hung request would otherwise run into the function's 60 s limit. */
const SEND_TIMEOUT_MS = 15_000;

export function emailConfigured() {
  return Boolean(env.resendApiKey && env.emailFrom);
}

/**
 * Sends through Resend when RESEND_API_KEY and EMAIL_FROM are set. Otherwise prints the
 * message to the server log (mock mode) so the digest flow can be exercised locally.
 */
export async function sendEmail(msg: EmailMessage): Promise<SendResult> {
  if (!emailConfigured()) {
    const when = msg.scheduledAt ? `\nScheduled for: ${msg.scheduledAt.toISOString()}` : "";
    console.log(
      `\n[email:mock] RESEND_API_KEY/EMAIL_FROM not set, so not sending.\nTo: ${msg.to}${when}\nSubject: ${msg.subject}\n\n${msg.text}\n[/email:mock]\n`,
    );
    return { channel: "console", id: null };
  }
  const resend = new Resend(env.resendApiKey);
  const sending = resend.emails.send(
    {
      from: env.emailFrom!,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      ...(msg.scheduledAt ? { scheduledAt: msg.scheduledAt.toISOString() } : {}),
    },
    msg.idempotencyKey ? { idempotencyKey: msg.idempotencyKey } : undefined,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Resend: no answer within ${SEND_TIMEOUT_MS / 1000} s`)), SEND_TIMEOUT_MS);
  });
  try {
    const { data, error } = await Promise.race([sending, timeout]);
    // The key was already used today with a different message (a retry after Resend accepted one, say
    // scheduled rather than sent now): that one stands, so this counts as sent.
    if (error?.name === "invalid_idempotent_request" && msg.idempotencyKey) return { channel: "resend", id: null };
    if (error) throw new Error(`Resend: ${error.message}`);
    return { channel: "resend", id: data?.id ?? null };
  } finally {
    clearTimeout(timer);
  }
}
