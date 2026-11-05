import { isResendTestSender, pickEmailChannel, type EmailSettings } from "@/lib/email/channel";
/**
 * Central, typed access to environment variables. Nothing here has a default
 * that looks like a real secret: when a value is missing the related feature
 * reports itself as "not configured" and falls back to mock behavior.
 */

function read(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

export const env = {
  get databaseUrl() {
    return read("DATABASE_URL");
  },
  get authSecret() {
    return read("AUTH_SECRET");
  },
  get googleClientId() {
    return read("AUTH_GOOGLE_ID");
  },
  get googleClientSecret() {
    return read("AUTH_GOOGLE_SECRET");
  },
  /** Google Gemini (free tier via AI Studio). Preferred over Claude when both are set. */
  get geminiApiKey() {
    return read("GEMINI_API_KEY");
  },
  /** The stronger model, used first for resume reading and fit checks; bulk scoring starts on Flash-Lite. */
  get geminiModel() {
    return read("GEMINI_MODEL") ?? "gemini-3.8-flash";
  },
  get anthropicApiKey() {
    return read("ANTHROPIC_API_KEY");
  },
  get anthropicModel() {
    return read("ANTHROPIC_MODEL") ?? "claude-sonnet-5-5";
  },
  get adzunaAppId() {
    return read("ADZUNA_APP_ID");
  },
  get adzunaAppKey() {
    return read("ADZUNA_APP_KEY");
  },
  get usajobsApiKey() {
    return read("USAJOBS_API_KEY");
  },
  get usajobsUserAgent() {
    return read("USAJOBS_USER_AGENT");
  },
  get resendApiKey() {
    return read("RESEND_API_KEY");
  },
  get emailFrom() {
    return read("EMAIL_FROM");
  },
  /** Sends the morning email through this Gmail account (with GMAIL_APP_PASSWORD); takes priority over Resend. */
  get gmailUser() {
    return read("GMAIL_USER");
  },
  /** A Google app password for GMAIL_USER (needs 2-Step Verification), not the account password. */
  get gmailAppPassword() {
    return read("GMAIL_APP_PASSWORD");
  },
  get cronSecret() {
    return read("CRON_SECRET");
  },
  get appUrl() {
    return (
      read("APP_URL") ??
      (read("VERCEL_PROJECT_PRODUCTION_URL")
        ? `https://${read("VERCEL_PROJECT_PRODUCTION_URL")}`
        : "http://localhost:3000")
    );
  },
  /** Max jobs per run that get an AI score (rate-limit / cost control). Gemini's free tier allows more. */
  get maxAiScoresPerRun() {
    const fallback = read("GEMINI_API_KEY") ? 40 : 20;
    const n = Number(read("MAX_AI_SCORES_PER_RUN") ?? String(fallback));
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
  },
  get isProduction() {
    return process.env.NODE_ENV === "production";
  },
  /** The demo sign-in exists so the app is usable before Google OAuth is set up. */
  /** Local development: sample postings instead of live sources. */
  get mockJobs() {
    return read("MOCK_JOBS") === "true";
  },
  /** Where the embedded database (PGlite, used without DATABASE_URL) keeps its files. */
  get pgliteDataDir() {
    return read("PGLITE_DATA_DIR");
  },
  /** Escape hatch: allow the embedded database in a production build (never on Vercel). */
  get allowPgliteInProduction() {
    return read("ALLOW_PGLITE_IN_PRODUCTION") === "true";
  },
  get demoLoginEnabled() {
    if (read("ENABLE_DEMO_LOGIN") === "true") return true;
    if (read("ENABLE_DEMO_LOGIN") === "false") return false;
    return !this.googleConfigured && !this.isProduction;
  },
  /** Lowercased emails allowed to sign in with Google (ALLOWED_EMAILS, comma-separated). Empty = anyone. */
  get allowedEmails(): string[] {
    return (read("ALLOWED_EMAILS") ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  },
  get googleConfigured() {
    return Boolean(this.googleClientId && this.googleClientSecret);
  },
};

/** With ALLOWED_EMAILS set, only those addresses may sign in; without it, anyone Google lets through can. */
export function isEmailAllowed(email: string | null | undefined): boolean {
  const allowed = env.allowedEmails;
  if (allowed.length === 0) return true;
  return Boolean(email) && allowed.includes(email!.trim().toLowerCase());
}

export type FeatureStatus = { key: string; label: string; configured: boolean; note: string };

/** The current email settings, for pickEmailChannel. */
export function emailSettings(): EmailSettings {
  return { gmailUser: env.gmailUser, gmailAppPassword: env.gmailAppPassword, resendApiKey: env.resendApiKey, emailFrom: env.emailFrom };
}

/** Which provider sends the morning email, and the catch with Resend's shared test sender. */
function emailStatus(): FeatureStatus {
  const channel = pickEmailChannel(emailSettings());
  if (channel === "gmail") return { key: "email", label: "Email", configured: true, note: "Sent from Gmail, between 7 and 8 AM Central" };
  if (channel === "console") return { key: "email", label: "Email", configured: false, note: "Emails are logged to the server console" };
  return {
    key: "email",
    label: "Email",
    configured: true,
    note: isResendTestSender(env.emailFrom)
      ? "Sent with Resend's test sender (onboarding@resend.dev), which only delivers to the Resend account's own address: other users get nothing. Set GMAIL_USER and GMAIL_APP_PASSWORD, or verify a domain in Resend."
      : "Sent with Resend, at 7:00 AM Central",
  };
}

/** Used by the settings page to show what is live vs mocked. */
export function featureStatus(): FeatureStatus[] {
  return [
    {
      key: "database",
      label: "Database",
      configured: Boolean(env.databaseUrl),
      note: env.databaseUrl ? "Postgres via DATABASE_URL" : "Local embedded Postgres (PGlite) in .data/",
    },
    {
      key: "google",
      label: "Google sign-in + Sheets",
      configured: env.googleConfigured,
      note: env.googleConfigured ? "Google OAuth configured" : "Demo sign-in only; Sheets sync disabled",
    },
    {
      key: "allowlist",
      label: "Sign-in allowlist",
      configured: env.allowedEmails.length > 0,
      note:
        env.allowedEmails.length > 0
          ? `Only ${env.allowedEmails.length} allowed email(s) can sign in`
          : "Not set: any Google account your OAuth consent screen allows can sign in",
    },
    {
      key: "ai",
      label: "AI (resume reading, scoring, fit checks)",
      configured: Boolean(env.geminiApiKey || env.anthropicApiKey),
      note: env.geminiApiKey
        ? `Gemini ${env.geminiModel}, falling back to gemini-3.5-flash-lite and gemini-3.1-flash-lite (free tier)`
        : env.anthropicApiKey
          ? `Claude ${env.anthropicModel}`
          : "Off: keyword extraction and scoring only. Set GEMINI_API_KEY (free) to turn it on.",
    },
    {
      key: "adzuna",
      label: "Adzuna",
      configured: Boolean(env.adzunaAppId && env.adzunaAppKey),
      note: env.adzunaAppId && env.adzunaAppKey ? "Enabled" : "Skipped (no ADZUNA_APP_ID / ADZUNA_APP_KEY)",
    },
    {
      key: "usajobs",
      label: "USAJobs",
      configured: Boolean(env.usajobsApiKey && env.usajobsUserAgent),
      note:
        env.usajobsApiKey && env.usajobsUserAgent
          ? "Enabled"
          : "Skipped (no USAJOBS_API_KEY / USAJOBS_USER_AGENT)",
    },
    emailStatus(),
    {
      key: "cron",
      label: "Cron secret",
      configured: Boolean(env.cronSecret),
      note: env.cronSecret ? "Set" : "Cron route rejects all requests until CRON_SECRET is set",
    },
    ...(env.isProduction && env.demoLoginEnabled
      ? [
          {
            key: "demo",
            label: "Demo sign-in",
            configured: false,
            note: "ENABLE_DEMO_LOGIN=true in production: anyone can sign in as the demo user. Remove it.",
          },
        ]
      : []),
  ];
}
