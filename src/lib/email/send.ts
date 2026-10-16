import { Resend } from "resend";
import { env } from "@/lib/env";

export type EmailMessage = { to: string; subject: string; html: string; text: string };
export type SendResult = { channel: "resend" | "console"; id: string | null };

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
  const { data, error } = await resend.emails.send({
    from: env.emailFrom!,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
  });
  if (error) throw new Error(`Resend: ${error.message}`);
  return { channel: "resend", id: data?.id ?? null };
}
