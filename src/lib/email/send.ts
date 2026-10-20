import { Resend } from "resend";
import { env } from "@/lib/env";

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Resend sends a message with the same key only once within 24 hours. */
  idempotencyKey?: string;
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
    console.log(
      `\n[email:mock] RESEND_API_KEY/EMAIL_FROM not set, so not sending.\nTo: ${msg.to}\nSubject: ${msg.subject}\n\n${msg.text}\n[/email:mock]\n`,
    );
    return { channel: "console", id: null };
  }
  const resend = new Resend(env.resendApiKey);
  const sending = resend.emails.send(
    { from: env.emailFrom!, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text },
    msg.idempotencyKey ? { idempotencyKey: msg.idempotencyKey } : undefined,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Resend: no answer within ${SEND_TIMEOUT_MS / 1000} s`)), SEND_TIMEOUT_MS);
  });
  try {
    const { data, error } = await Promise.race([sending, timeout]);
    if (error) throw new Error(`Resend: ${error.message}`);
    return { channel: "resend", id: data?.id ?? null };
  } finally {
    clearTimeout(timer);
  }
}
