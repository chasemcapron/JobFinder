import nodemailer from "nodemailer";
import { Resend } from "resend";
import { emailSettings, env } from "@/lib/env";
import { pickEmailChannel, type EmailChannel } from "./channel";

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
export type { EmailChannel };
export type SendResult = { channel: EmailChannel; id: string | null };

/** Resend's SDK takes no abort signal, so a hung request would otherwise run into the function's 60 s limit. */
const SEND_TIMEOUT_MS = 15_000;

/** The configured provider (see pickEmailChannel). */
export function emailChannel(): EmailChannel {
  return pickEmailChannel(emailSettings());
}

/** Whether the provider can hold a message for later delivery (Resend can; Gmail SMTP can't). */
export function canScheduleEmail() {
  return emailChannel() !== "gmail";
}

function withTimeout<T>(work: Promise<T>, provider: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${provider}: no answer within ${SEND_TIMEOUT_MS / 1000} s`)), SEND_TIMEOUT_MS);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** Sends through the configured provider (see emailChannel); `scheduledAt` only applies to Resend. */
export async function sendEmail(msg: EmailMessage): Promise<SendResult> {
  const channel = emailChannel();
  if (channel === "console") {
    const when = msg.scheduledAt ? `\nScheduled for: ${msg.scheduledAt.toISOString()}` : "";
    console.log(
      `\n[email:mock] No GMAIL_USER/GMAIL_APP_PASSWORD or RESEND_API_KEY/EMAIL_FROM, so not sending.\nTo: ${msg.to}${when}\nSubject: ${msg.subject}\n\n${msg.text}\n[/email:mock]\n`,
    );
    return { channel, id: null };
  }

  if (channel === "gmail") {
    const transport = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: env.gmailUser!, pass: env.gmailAppPassword!.replace(/\s+/g, "") },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
    });
    // Bounded by the transport's own timeouts, not a race: SMTP has no idempotency key, and a race
    // could reject after Gmail had accepted the message, so the retry would send it twice.
    try {
      const info = await transport.sendMail({ from: { name: "Job Finder", address: env.gmailUser! }, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text });
      return { channel, id: info.messageId ?? null };
    } catch (err) {
      throw new Error(`Gmail: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      transport.close();
    }
  }

  const resend = new Resend(env.resendApiKey);
  const { data, error } = await withTimeout(
    resend.emails.send(
      {
        from: env.emailFrom!,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        ...(msg.scheduledAt ? { scheduledAt: msg.scheduledAt.toISOString() } : {}),
      },
      msg.idempotencyKey ? { idempotencyKey: msg.idempotencyKey } : undefined,
    ),
    "Resend",
  );
  // The key was already used today with a different message (a retry after Resend accepted one, say
  // scheduled rather than sent now): that one stands, so this counts as sent.
  if (error?.name === "invalid_idempotent_request" && msg.idempotencyKey) return { channel, id: null };
  if (error) throw new Error(`Resend: ${error.message}`);
  return { channel, id: data?.id ?? null };
}
