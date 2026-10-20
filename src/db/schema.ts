import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

// ---------------------------------------------------------------------------
// Auth.js tables (shape required by @auth/drizzle-adapter)
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

// ---------------------------------------------------------------------------
// App tables
// ---------------------------------------------------------------------------

export const EXPERIENCE_LEVELS = ["internship", "entry", "mid", "senior", "lead", "executive"] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

export const REMOTE_PREFERENCES = ["any", "remote_only", "onsite_only"] as const;
export type RemotePreference = (typeof REMOTE_PREFERENCES)[number];

/** Maps a sheet field to a column letter, e.g. { company: "A", title: "B" }. */
export type SheetColumnMap = Partial<Record<SheetField, string>>;
export const SHEET_FIELDS = ["company", "title", "dateApplied", "link", "location", "status", "source", "score"] as const;
export type SheetField = (typeof SHEET_FIELDS)[number];

export const profiles = pgTable("profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  resumeText: text("resume_text"),
  resumeFileName: text("resume_file_name"),
  // Extracted from the resume (editable by the user)
  skills: jsonb("skills").$type<string[]>().notNull().default([]),
  titles: jsonb("titles").$type<string[]>().notNull().default([]),
  seniority: text("seniority").$type<ExperienceLevel | null>(),
  keywords: jsonb("keywords").$type<string[]>().notNull().default([]),
  /** Jobs whose title contains any of these are skipped (e.g. "credit" for a security analyst). */
  excludeKeywords: jsonb("exclude_keywords").$type<string[]>().notNull().default([]),
  // Preferences
  searchKeywords: jsonb("search_keywords").$type<string[]>().notNull().default([]),
  preferredLocations: jsonb("preferred_locations").$type<string[]>().notNull().default([]),
  experienceLevels: jsonb("experience_levels").$type<ExperienceLevel[]>().notNull().default([]),
  remotePreference: text("remote_preference").$type<RemotePreference>().notNull().default("any"),
  adzunaCountry: text("adzuna_country").notNull().default("us"),
  // Google Sheets
  sheetId: text("sheet_id"),
  sheetTab: text("sheet_tab"),
  sheetColumnMap: jsonb("sheet_column_map").$type<SheetColumnMap>(),
  // Email
  emailEnabled: boolean("email_enabled").notNull().default(true),
  /** America/Chicago date (YYYY-MM-DD) of the last morning digest sent. */
  lastDigestDate: text("last_digest_date"),
  /** Bumped when anything that affects scoring changes, so stale matches get re-scored. */
  matchingUpdatedAt: timestamp("matching_updated_at", { mode: "date" }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});

// "mock" is local sample data, used only when no real source can run (see lib/jobs/sources/mock.ts).
export const JOB_SOURCES = ["greenhouse", "lever", "ashby", "adzuna", "usajobs", "mock"] as const;
export type JobSource = (typeof JOB_SOURCES)[number];

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").$type<JobSource>().notNull(),
    externalId: text("external_id").notNull(),
    /** normalized company + title + location; the cross-source dedupe key */
    dedupeKey: text("dedupe_key").notNull(),
    title: text("title").notNull(),
    company: text("company").notNull(),
    locationRaw: text("location_raw"),
    city: text("city"),
    state: text("state"),
    country: text("country"),
    remote: boolean("remote").notNull().default(false),
    experienceLevel: text("experience_level").$type<ExperienceLevel | null>(),
    description: text("description").notNull().default(""),
    applyUrl: text("apply_url").notNull(),
    postedAt: timestamp("posted_at", { mode: "date" }),
    salaryMin: integer("salary_min"),
    salaryMax: integer("salary_max"),
    salaryCurrency: text("salary_currency"),
    firstSeenAt: timestamp("first_seen_at", { mode: "date" }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("jobs_dedupe_key_idx").on(t.dedupeKey),
    index("jobs_source_external_idx").on(t.source, t.externalId),
  ],
);

export const jobMatches = pgTable(
  "job_matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    /** 0-100. The AI score when aiScored, otherwise the keyword score. */
    score: integer("score").notNull(),
    keywordScore: integer("keyword_score").notNull(),
    aiScored: boolean("ai_scored").notNull().default(false),
    reasons: text("reasons").notNull().default(""),
    matchedKeywords: jsonb("matched_keywords").$type<string[]>().notNull().default([]),
    scoredAt: timestamp("scored_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("job_matches_user_job_idx").on(t.userId, t.jobId), index("job_matches_user_score_idx").on(t.userId, t.score)],
);

export const FIT_VERDICTS = ["strong", "good", "stretch", "poor"] as const;
export type FitVerdict = (typeof FIT_VERDICTS)[number];

/** An AI comparison of the user's resume with one posting ("Check my fit"). */
export type FitCheckResult = {
  fitScore: number;
  verdict: FitVerdict;
  summary: string;
  strengths: string[];
  gaps: string[];
  /** Terms from the posting the resume doesn't use; worth adding only if they're true. */
  missingKeywords: string[];
  resumeTips: string[];
};

/** Cached fit checks. Stale once the profile changes after `createdAt` (the resume was edited). */
export const fitChecks = pgTable(
  "fit_checks",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    result: jsonb("result").$type<FitCheckResult>().notNull(),
    model: text("model").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.jobId] })],
);

export const APPLICATION_STATUSES = ["applied", "interviewing", "offer", "rejected", "withdrawn"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export const SHEET_SYNC_STATUSES = ["pending", "synced", "failed", "not_configured"] as const;
export type SheetSyncStatus = (typeof SHEET_SYNC_STATUSES)[number];

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    appliedAt: timestamp("applied_at", { mode: "date" }).notNull().defaultNow(),
    status: text("status").$type<ApplicationStatus>().notNull().default("applied"),
    sheetSyncStatus: text("sheet_sync_status").$type<SheetSyncStatus>().notNull().default("pending"),
    sheetSyncError: text("sheet_sync_error"),
    sheetSyncedAt: timestamp("sheet_synced_at", { mode: "date" }),
  },
  (t) => [uniqueIndex("applications_user_job_idx").on(t.userId, t.jobId)],
);

export const ATS_TYPES = ["greenhouse", "lever", "ashby"] as const;
export type AtsType = (typeof ATS_TYPES)[number];

export const targetCompanies = pgTable(
  "target_companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ats: text("ats").$type<AtsType>().notNull(),
    slug: text("slug").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("target_companies_user_ats_slug_idx").on(t.userId, t.ats, t.slug)],
);

export const emailLog = pgTable(
  "email_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    sentAt: timestamp("sent_at", { mode: "date" }).notNull().defaultNow(),
    /** "resend" or "console" (mock mode) */
    channel: text("channel").notNull(),
  },
  (t) => [uniqueIndex("email_log_user_job_idx").on(t.userId, t.jobId)],
);

export type SourceRunResult = {
  source: string;
  ok: boolean;
  count: number;
  error?: string;
  durationMs: number;
};

/** One row per runJobSearch call, so the UI can show per-source failures. */
export const searchRuns = pgTable(
  "search_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    trigger: text("trigger").notNull(),
    startedAt: timestamp("started_at", { mode: "date" }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { mode: "date" }),
    status: text("status").notNull().default("running"),
    sourceResults: jsonb("source_results").$type<SourceRunResult[]>().notNull().default([]),
    jobsFetched: integer("jobs_fetched").notNull().default(0),
    jobsNew: integer("jobs_new").notNull().default(0),
    matchesScored: integer("matches_scored").notNull().default(0),
    aiScored: integer("ai_scored").notNull().default(0),
    error: text("error"),
  },
  (t) => [index("search_runs_user_started_idx").on(t.userId, t.startedAt)],
);

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
});

/**
 * The original resume file, for the preview on /resume. One "pending" row holds the
 * latest upload until the user saves; saving promotes it to "saved".
 */
export const resumeFiles = pgTable(
  "resume_files",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slot: text("slot").$type<"pending" | "saved">().notNull(),
    kind: text("kind").$type<"pdf" | "docx">().notNull(),
    fileName: text("file_name").notNull(),
    data: bytea("data").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.slot] })],
);

export type User = typeof users.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type JobMatchRow = typeof jobMatches.$inferSelect;
export type ApplicationRow = typeof applications.$inferSelect;
export type TargetCompanyRow = typeof targetCompanies.$inferSelect;
export type SearchRunRow = typeof searchRuns.$inferSelect;
