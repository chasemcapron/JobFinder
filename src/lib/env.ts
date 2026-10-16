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
  /** Max jobs per run that get a Claude score (cost control). */
  get maxAiScoresPerRun() {
    const n = Number(read("MAX_AI_SCORES_PER_RUN") ?? "20");
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 20;
  },
  get isProduction() {
    return process.env.NODE_ENV === "production";
  },
  /** The demo sign-in exists so the app is usable before Google OAuth is set up. */
  get demoLoginEnabled() {
    if (read("ENABLE_DEMO_LOGIN") === "true") return true;
    if (read("ENABLE_DEMO_LOGIN") === "false") return false;
    return !this.googleConfigured && !this.isProduction;
  },
  get googleConfigured() {
    return Boolean(this.googleClientId && this.googleClientSecret);
  },
};

export type FeatureStatus = { key: string; label: string; configured: boolean; note: string };

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
      key: "anthropic",
      label: "Claude (resume parsing + scoring)",
      configured: Boolean(env.anthropicApiKey),
      note: env.anthropicApiKey ? `Model ${env.anthropicModel}` : "Heuristic keyword extraction and scoring",
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
    {
      key: "resend",
      label: "Email (Resend)",
      configured: Boolean(env.resendApiKey && env.emailFrom),
      note: env.resendApiKey && env.emailFrom ? "Enabled" : "Emails are logged to the server console",
    },
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
