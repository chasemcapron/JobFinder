# Progress

Overnight autonomous build of the Job Finder app described in `brief.md`.
Each phase is committed only after lint, typecheck, tests, and build pass.

## Phases

- [x] Phase 1: Skeleton (Next.js, Tailwind, Drizzle schema + migrations, `.env.example`, README)
- [x] Phase 2: Sign-in and profile (Google sign-in, settings page)
- [x] Phase 3: Resume upload (PDF/.docx/text, Claude extraction, editable result)
- [x] Phase 4: Job search (adapters, normalize, dedupe, store, score, "Refresh jobs")
- [x] Phase 5: Results and filters
- [ ] Phase 6: Application tracking + Google Sheets (column mapping, retry)
- [ ] Phase 7: Morning email (Vercel Cron, CRON_SECRET, Chicago 7 AM gating)
- [ ] Phase 8: Polish (empty/error/loading states, mobile, full README)

## Log

- **Phase 1**: Next.js 16 + Tailwind v4 + Drizzle. Schema for users/auth, profiles, jobs, job_matches, applications, target_companies, email_log, search_runs; first migration in `drizzle/`. With no DATABASE_URL the app uses an embedded Postgres (PGlite) in `.data/`.
- **Phase 2**: Auth.js v5 with Google (Sheets scope, offline access, refresh token stored and refreshed on each login). A dev-only "demo account" sign-in works until Google OAuth is set up. Settings page covers keywords, locations, levels, remote, target companies, sheet ID, and email on/off. Verified sign-in → profile creation → seeded companies end to end over HTTP.
- **Phase 3**: Upload PDF/.docx or paste text → extract → Claude structured output (skills, titles, seniority, keywords) → editable review → save. Without an API key a built-in heuristic extractor runs instead. Verified upload + save end to end through the real Server Actions in a production build.
- **Phase 4**: Adapters for Greenhouse, Lever, Ashby (verified against live responses), Adzuna and USAJobs (from docs; no keys). `runJobSearch(userId)` fetches in parallel with timeouts → normalizes → dedupes → stores → keyword prefilter → Claude scores the top N → saves matches. "Refresh jobs" button with loading/result/failed-source states. Live E2E run: 1,143 postings from the 5 seeded boards in 1.4s, 420 ranked matches.
- **Phase 5**: Results sorted by match score with apply links; filters for country, state, city, remote, experience level, source, date posted, keyword search, applied (dim/hide/only), min score, sort; pagination; mobile collapsible filter panel. Verified 16 filter combinations over HTTP against 894 real matches.

## Not verified yet (needs keys)

- Claude calls (resume extraction and match scoring) are implemented per the current SDK docs and type-check, but have never run against the real API. With no key, the heuristic paths are what has been exercised.
- Adzuna and USAJobs adapters are tested against fixtures built from their documented response shapes, not live responses. Bad-credential responses (401) were checked live and are handled.

## Blocked / needs you

_(full checklist at the end once all phases are done)_
