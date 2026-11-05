/**
 * Which provider sends email, from the env values alone (no imports, so env.ts and send.ts can both
 * use it): Gmail when GMAIL_USER and GMAIL_APP_PASSWORD are set (free, delivers to anyone, from the
 * owner's address); else Resend when RESEND_API_KEY and EMAIL_FROM are set; else the server log.
 */
export type EmailChannel = "gmail" | "resend" | "console";

export type EmailSettings = {
  gmailUser?: string;
  gmailAppPassword?: string;
  resendApiKey?: string;
  emailFrom?: string;
};

export function pickEmailChannel(s: EmailSettings): EmailChannel {
  if (s.gmailUser && s.gmailAppPassword) return "gmail";
  if (s.resendApiKey && s.emailFrom) return "resend";
  return "console";
}

/** Resend's shared test sender (onboarding@resend.dev) only delivers to the Resend account's own address. */
export function isResendTestSender(emailFrom: string | undefined): boolean {
  return /@resend\.dev\b/i.test(emailFrom ?? "");
}
