# Project Brief: Job Finder Web App

## Purpose
A personal web app that finds job postings matching my resume, lets me filter and track them, logs applications to my existing Google Sheet, and emails me the top matches every morning. It will live in a **public GitHub repo** and be hosted on **Vercel**.

## How to work (read first, this runs overnight unattended)
- I will not be available to answer questions. Make reasonable decisions, record each one in `DECISIONS.md` (one line each: decision + why), and keep going.
- Work through the phases below in order. After each phase: run lint, typecheck, and tests, then make a git commit with a clear message. Do not move on with a failing build.
- Keep a running `PROGRESS.md`: what's done, what's next, anything blocked, and exactly what I need to do manually in the morning.
- **No real secrets exist yet.** Never invent or hardcode keys. Read everything from environment variables, list them all in `.env.example`, and when a key is missing, fall back to mock data or a clear "not configured" state so the app still builds and runs locally.
- **Stop and leave a note instead of doing it** if a step requires: creating accounts, entering credentials, deploying to Vercel, pushing to a remote, buying anything, or deleting files outside this project.
- Do not scrape LinkedIn, Indeed, Glassdoor, or any site whose terms forbid it. Use only the public APIs listed below.
- Because the repo is public: no personal data (my name, email, resume, sheet ID) in committed files. Put those in env vars or the database.

## Tech stack
- **Framework:** Next.js (App Router) + TypeScript, Tailwind CSS
- **Hosting:** Vercel, with Vercel Cron for scheduled runs
- **Auth:** Auth.js (NextAuth) with Google sign-in. Request Google Sheets scope (`https://www.googleapis.com/auth/spreadsheets`) and offline access so a refresh token is stored.
- **Database:** Postgres (Supabase or Neon) via Drizzle ORM. Include migrations.
- **Resume parsing:** `pdf-parse` for PDF, `mammoth` for .docx
- **Matching:** Claude API (Anthropic SDK) to extract skills, titles, seniority, and keywords from the resume, and to score job matches
- **Email:** Resend + React Email
- **Tests:** Vitest for unit tests on parsing, normalization, scoring, and filtering

## Job data sources (APIs only)
1. **Greenhouse** public board API: `GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` (no auth)
2. **Lever** public postings API: `GET https://api.lever.co/v0/postings/{site}?mode=json` (no auth)
3. **Ashby** public job board API: `GET https://api.ashbyhq.com/posting-api/job-board/{name}` (no auth)
4. **Adzuna** search API (needs `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`). Show source attribution as their terms require.
5. **USAJobs** search API (needs `USAJOBS_API_KEY` and `USAJOBS_USER_AGENT` email) for federal roles

Build each source as an adapter behind a common interface that returns one normalized `Job` shape: `source, externalId, title, company, location (city/state/country), remote, experienceLevel, description, applyUrl, postedAt, salaryMin/Max (nullable)`. Deduplicate across sources (same company + title + location). Greenhouse, Lever, and Ashby are queried per company, so store a user-editable list of target companies (`ats:slug`, e.g. `greenhouse:stripe`) in the database, seeded with a few examples.

Verify each endpoint's actual response shape before writing the adapter, and handle failures per source so one broken source never fails the whole run.

## Features (build in this order)

### Phase 1: Skeleton
- Next.js app, Tailwind, Drizzle + schema, `.env.example`, README with setup steps
- Schema: `users`, `profiles` (resume text, extracted skills/keywords, preferences), `jobs`, `job_matches` (user, job, score, reasons), `applications` (user, job, applied date, status), `target_companies`, `email_log` (which jobs were already emailed)

### Phase 2: Sign-in and profile
- Google sign-in; the app remembers the user and their profile
- Settings page: keywords, preferred locations, experience levels, target companies, Google Sheet ID, email on/off

### Phase 3: Resume upload
- Upload PDF or .docx (and allow pasting plain text as a fallback)
- Extract text, send to Claude to produce structured JSON: skills, likely titles, seniority, keywords. Let me edit the result before saving.

### Phase 4: Job search
- One shared function `runJobSearch(userId)`: fetch from all configured sources → normalize → dedupe → store → score against profile → save matches
- **"Refresh jobs" button** in the UI triggers it via an API route, with a loading state
- Scoring: cheap keyword prefilter first, then Claude scores only the top candidates (cap the number per run to control cost). Store a short "why it matches" reason.

### Phase 5: Results and filters
- Results list sorted by match score, with apply links
- Filters: country, state, city, remote, experience level, source, date posted, keyword search
- Hide or dim jobs already applied to

### Phase 6: Application tracking + Google Sheets
- "Mark applied" button on each job: saves to `applications` and appends a row to my Google Sheet
- **I have an existing sheet with its own columns.** Do not assume its layout. Build a column-mapping setting (e.g. Company → column A, Title → B, Date Applied → C, Link → D, Location → E, Status → F) with sensible defaults, and append using that mapping.
- If the Sheets call fails, keep the application saved and show a retry option

### Phase 7: Morning email
- Vercel Cron route `/api/cron/morning` protected by a `CRON_SECRET` header check
- Runs `runJobSearch`, then emails the top 5–10 **new** matches (skip anything already in `email_log` or already applied to)
- Each job in the email: title, company, location, match score, one-line reason, apply link
- Time zone: target 7:00 AM America/Chicago. Vercel Cron is UTC and ignores daylight saving, so schedule both `0 12 * * *` and `0 13 * * *` and have the route send only if the current Chicago local hour is 7 (and nothing has been sent today)
- Keep the run within Vercel function time limits: fetch sources in parallel with timeouts

### Phase 8: Polish
- Empty states, error messages, loading states, mobile-friendly layout
- README: full local setup, every env var with where to get it, Google Cloud OAuth setup (keep the consent screen in "Testing" mode and add myself as a test user), Vercel deploy steps, cron setup

## Environment variables (all go in `.env.example`)
`DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `ANTHROPIC_API_KEY`, `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `USAJOBS_API_KEY`, `USAJOBS_USER_AGENT`, `RESEND_API_KEY`, `EMAIL_FROM`, `CRON_SECRET`

## Definition of done
- `npm run build`, lint, typecheck, and tests all pass
- The app runs locally with mock data when keys are missing
- `PROGRESS.md` ends with a short morning checklist: which accounts to create, which keys to add, and how to deploy
