# Progress

Overnight autonomous build of the Job Finder app described in `brief.md`.
Each phase is committed only after lint, typecheck, tests, and build pass.

## Phases

- [x] Phase 1: Skeleton (Next.js, Tailwind, Drizzle schema + migrations, `.env.example`, README)
- [x] Phase 2: Sign-in and profile (Google sign-in, settings page)
- [x] Phase 3: Resume upload (PDF/.docx/text, Claude extraction, editable result)
- [x] Phase 4: Job search (adapters, normalize, dedupe, store, score, "Refresh jobs")
- [x] Phase 5: Results and filters
- [x] Phase 6: Application tracking + Google Sheets (column mapping, retry)
- [x] Phase 7: Morning email (Vercel Cron, CRON_SECRET, Chicago 7 AM gating)
- [x] Phase 8: Polish (empty/error/loading states, mobile, full README)

**Final state:** 174 tests passing; lint, typecheck, and build clean; one commit per phase on `main`. Nothing pushed or deployed.

## Log

- **Phase 1**: Next.js 16 + Tailwind v4 + Drizzle. Schema for users/auth, profiles, jobs, job_matches, applications, target_companies, email_log, search_runs; first migration in `drizzle/`. With no DATABASE_URL the app uses an embedded Postgres (PGlite) in `.data/`.
- **Phase 2**: Auth.js v5 with Google (Sheets scope, offline access, refresh token stored and refreshed on each login). A dev-only "demo account" sign-in works until Google OAuth is set up. Settings page covers keywords, locations, levels, remote, target companies, sheet ID, and email on/off. Verified sign-in → profile creation → seeded companies end to end over HTTP.
- **Phase 3**: Upload PDF/.docx or paste text → extract → Claude structured output (skills, titles, seniority, keywords) → editable review → save. Without an API key a built-in heuristic extractor runs instead. Verified upload + save end to end through the real Server Actions in a production build.
- **Phase 4**: Adapters for Greenhouse, Lever, Ashby (verified against live responses), Adzuna and USAJobs (from docs; no keys). `runJobSearch(userId)` fetches in parallel with timeouts → normalizes → dedupes → stores → keyword prefilter → Claude scores the top N → saves matches. "Refresh jobs" button with loading/result/failed-source states. Live E2E run: 1,143 postings from the 5 seeded boards in 1.4s, 420 ranked matches.
- **Phase 5**: Results sorted by match score with apply links; filters for country, state, city, remote, experience level, source, date posted, keyword search, applied (dim/hide/only), min score, sort; pagination; mobile collapsible filter panel. Verified 16 filter combinations over HTTP against 894 real matches.
- **Phase 6**: "Mark applied" on each job saves to `applications`, then writes a row to the user's Google Sheet using a configurable column mapping (defaults A–F). Sheets failures keep the application and show Retry. Applications page with status changes and removal. Settings: sheet URL/ID, tab, column mapping, Test connection. Verified end to end over HTTP in a production build (save, validation, not-configured path, retry, status change, remove); the Sheets HTTP calls and token refresh are covered by unit tests with mocked fetch.
- **Phase 7**: `/api/cron/morning` (CRON_SECRET bearer check) scheduled at 12:00 and 13:00 UTC in `vercel.json`; sends only at 7 AM Chicago, once per day. Runs `runJobSearch`, then emails up to 10 new matches (not already emailed or applied) via Resend + React Email: title, company, location, score, reason, apply link. Mock mode prints the email to the server log. Preview route + Settings link. Verified over HTTP: auth rejections, hour gate, forced send, same-day skip, email_log effect.
- **Phase 8**: Loading skeletons, error boundaries (app shell, root, global), 404 page, security headers, per-company last-search status in Settings, demo-login-in-production warning, full README (setup, every env var, Google OAuth, Neon/Supabase, Vercel, cron). Drove the real UI in headless Edge at 1280px and 390px: sign-in → PDF upload → save → Refresh (1,142 live postings) → Mark applied → filters. No horizontal overflow on any page, and the search box keeps focus while filtering. Verified PDF parsing from a standalone build, which like Vercel ships only traced files.

## Not verified (needs keys or a deploy)

- ~~**Database on Neon**~~: migrated and in use locally since 2026-10-19.

- **Claude calls** (resume extraction, match scoring): written per the current SDK and type-checked, but never run against the real API. Everything tested so far used the built-in heuristics. Intentionally unused for now: the app is meant to run free, so no API key is set.
- ~~**Google sign-in and Sheets sync**~~: verified 2026-10-19 against a real tracker sheet (found and fixed: pre-filled Status columns pushed rows far down).
- ~~**Resend delivery**~~: real digest sent 2026-10-19 via Resend (10 jobs) from `onboarding@resend.dev`.
- **Adzuna and USAJobs**: adapters follow the official docs, with fixtures built from the documented shapes. Only bad-credential (401) responses were checked live. If a real field differs, that posting is skipped rather than failing the run; after adding keys, click Refresh jobs and check the result banner for errors and whether those sources return postings.
- **Vercel itself** (cron registration, function limits): nothing was deployed.

## Morning checklist

### What's done
All 8 phases. The app runs locally with zero configuration: embedded Postgres, demo login, live Greenhouse/Lever/Ashby boards, heuristic matching, and email printed to the console.

### What's mocked until you add keys

| Feature | Without keys | Turns live with |
| --- | --- | --- |
| Sign-in | Demo account (dev only) | `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` |
| Google Sheets sync | Applications saved, marked "Not synced" | Google OAuth + a sheet set in Settings |
| Resume parsing + scoring | Built-in keyword extractor/scorer | `ANTHROPIC_API_KEY` |
| Adzuna / USAJobs | Skipped | `ADZUNA_APP_ID` + `ADZUNA_APP_KEY`; `USAJOBS_API_KEY` + `USAJOBS_USER_AGENT` |
| Morning email | Printed to the server console | `RESEND_API_KEY` + `EMAIL_FROM` |
| Database | Embedded PGlite in `.data/` (local only) | `DATABASE_URL` |

### Accounts and keys to set up
1. **Neon** (or Supabase): create a project and copy the connection string → `DATABASE_URL`.
2. **Google Cloud**: new project → enable the *Google Sheets API* → OAuth consent screen (External, **Testing**, add yourself as a test user, add the `spreadsheets` scope) → OAuth client (Web application) with redirect URIs `http://localhost:3000/api/auth/callback/google` and `https://<vercel-domain>/api/auth/callback/google` → `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`. In Testing mode Google refresh tokens expire after 7 days, so expect to sign in again about weekly for Sheets sync.
3. **Anthropic**: console.anthropic.com → API key → `ANTHROPIC_API_KEY`. The default model is `claude-opus-5-5`; set `ANTHROPIC_MODEL` to use a cheaper one. Cost is capped by `MAX_AI_SCORES_PER_RUN` (default 20 jobs per search).
4. **Resend**: API key → `RESEND_API_KEY`; verify a domain and set `EMAIL_FROM` (or use `onboarding@resend.dev`, which only delivers to your Resend account's email).
5. **Adzuna** (optional, **not free**: needs a paid plan, so leave it unset to stay free): developer.adzuna.com → app ID + key. The app makes at most 2 calls per search.
6. **USAJobs** (optional): developer.usajobs.gov/apirequest → the key arrives by email; `USAJOBS_USER_AGENT` = that email.
7. Generate secrets: `AUTH_SECRET` (`npx auth secret`) and `CRON_SECRET` (`openssl rand -hex 32`).

### Run it locally
```bash
npm install
cp .env.example .env.local   # optional: fill in any keys you have
npm run db:migrate           # only if DATABASE_URL is set
npm run dev                  # http://localhost:3000
```
Then: sign in → **Resume** (upload, review, save) → **Settings** (locations, target companies, sheet + column mapping, Test connection) → **Jobs** → **Refresh jobs**.

### Deploy to Vercel
1. Create a GitHub repo and push: `git remote add origin <url> && git push -u origin main`.
2. vercel.com/new → import the repo (Next.js preset, default settings).
3. Add Production env vars: `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `CRON_SECRET`, plus any of `ANTHROPIC_API_KEY`, `ADZUNA_*`, `USAJOBS_*`, `RESEND_API_KEY`, `EMAIL_FROM`. Do **not** set `ENABLE_DEMO_LOGIN`.
4. Run `npm run db:migrate` once with the production `DATABASE_URL`.
5. Deploy, then add the production callback URL to the Google OAuth client.
6. The two crons come from `vercel.json` (check Project → Settings → Cron Jobs). Test now: `curl -H "Authorization: Bearer $CRON_SECRET" "https://<domain>/api/cron/morning?force=1"`.

### Things to know
- **Git identity:** commits use your global git config (your name and outlook.com address). If you'd rather not publish that email, set a GitHub noreply address and rewrite the author before the first push: `git config user.email "<id>+<username>@users.noreply.github.com"` then `git rebase --root --exec "git commit --amend --no-edit --reset-author"`.
- **History cleanup:** a test file in the Phase 6 commit used your first name in a sample string. Before anything was pushed, I rewrote that string out of the local history; the old commits remain only in your local reflog.
- **OneDrive:** this folder is synced by OneDrive, which locked files in `.next` once (EPERM during build). If a build fails that way, delete `.next` or move the project out of OneDrive.
- **Windows on ARM:** `@napi-rs/canvas` has no build for this machine, so PDF parsing uses a pure-JS fallback (a harmless warning in the log). Vercel (Linux x64) uses the native one.
- Decisions made without you are in [DECISIONS.md](DECISIONS.md), one line each.
