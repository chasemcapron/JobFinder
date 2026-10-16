# Decisions

One line each: decision — why.

- Next.js 16.4 with `cacheComponents: false` — every page is per-user and request-time, so static-shell prerendering adds complexity with no benefit for a single-user app.
- Embedded Postgres (PGlite) when `DATABASE_URL` is empty (dev only) — the app runs locally with zero setup and uses the same Drizzle schema and migrations as Neon/Supabase.
- `postgres` (postgres-js) driver with `prepare: false` — works with both Neon and Supabase, including transaction-mode pooled URLs.
- Migrations live in `drizzle/` and are applied with `npm run db:migrate` (PGlite applies them on startup) — keeps schema changes explicit instead of running them during the Vercel build.
- `job_matches`, `applications`, `email_log`, `target_companies` are per-user; `jobs` is shared — job postings are the same for everyone, matches are not.
- Profile preferences are typed columns on `profiles` (not a JSON blob) — easier to query and validate.
- Added a `search_runs` table — needed to show per-source failures and run history in the UI.
- Auth.js v5 (next-auth@beta) with JWT sessions + Drizzle adapter — JWT is required for the credentials-based demo login; the adapter still stores users and Google accounts.
- A "demo account" sign-in (credentials provider, no password) is enabled only when Google OAuth isn't configured and NODE_ENV isn't production (override with ENABLE_DEMO_LOGIN) — lets the app run end to end before OAuth setup without exposing anything in production.
- Dev-only fallback AUTH_SECRET when unset outside production — `npm run dev` works with no .env; production still refuses to start without one.
- Google provider uses `access_type=offline` + `prompt=consent`, and a signIn event re-saves tokens on every Google login — the adapter only stores tokens on first link, and Sheets needs a fresh refresh token.
- Seeded target companies: greenhouse:stripe, greenhouse:figma, lever:spotify, ashby:ramp, ashby:linear — each verified live on 2026-10-15; lever:netflix and lever:plaid returned 404 so were left out.
- Target companies can be entered as `ats:slug` or by pasting a board URL — less friction than looking up slugs.
- Sheet setting accepts the full sheet URL and extracts the ID — that's what people have on hand.
- Settings changes that affect ranking bump `profiles.matching_updated_at`, so stale matches get re-scored on the next run.
- Default Claude model is `claude-opus-5-5` (override with ANTHROPIC_MODEL); calls use `effort: "low"` — extraction and scoring are simple structured tasks, and low effort is the cost lever that keeps the default model.
- Claude calls use structured outputs (`betaZodOutputFormat`) + `fallbacks: "default"` (server-side refusal fallback) — guaranteed-valid JSON and no dead end if a classifier declines a resume.
- Resume upload is two steps (extract → review/edit → save); nothing is persisted until "Save profile" — the brief asks to edit the result before saving.
- With no ANTHROPIC_API_KEY, resumes are analyzed by a built-in heuristic (skills dictionary, title-line detection, years-of-experience → seniority) — the app stays usable without a key.
- Upload limit 4 MB, Server Action body limit raised to 5 MB — Vercel rejects request bodies over 4.5 MB.
- pdf.js needs DOMMatrix, normally from @napi-rs/canvas, which has no Windows-ARM64 build; a pure-JS polyfill (@thednp/dommatrix) is used only when the native one can't load — text extraction doesn't render, so it's sufficient.
- Resumes over 60,000 characters are rejected with a message rather than silently truncated.
- Greenhouse/Lever/Ashby adapters were written against live responses captured 2026-10-15 (trimmed copies are the test fixtures); Adzuna/USAJobs adapters follow their official docs because no keys were available — both are lenient (string-or-number, optional fields) and marked "not yet verified live" in code.
- Lever and Ashby don't return a company name, so it's derived from the board slug ("spotify" → "Spotify").
- Ashby's `isRemote` is true for hybrid roles, so `workplaceType` decides remote; Lever uses `workplaceType` too.
- Locations are parsed into city/state/country (ISO-2) with a small gazetteer of major cities and the abbreviations seen in real data ("NYC, SF", "US-SEA"); multi-location postings use the first parseable place for filters; the raw string is kept for display and search. 94% of 1,143 live postings resolve a country.
- Salary: structured fields when the source has them (annualized from hourly/monthly), otherwise parsed from the description (Greenhouse puts pay ranges in the HTML). Adzuna's *predicted* salaries are skipped — they carry extra attribution terms.
- Dedupe key = normalized company + title + place; when two sources have the same job the direct ATS copy wins over USAJobs/Adzuna (richer description, direct apply link).
- Each source "task" (one per target company, one per Adzuna/USAJobs query) runs in parallel (max 8) with a 12s timeout; a failed or slow source is recorded in `search_runs.source_results` and shown in the UI, never failing the run.
- Adzuna's free tier is ~250 calls/day, so a run makes at most 2 Adzuna queries (and 2 USAJobs queries), built from the top target titles + first preferred location.
- Keyword prefilter: title similarity 40 + skills 35 + keywords 15 + preferences 10, with penalties for remote/level/location mismatches; jobs under 10 aren't saved as matches. Claude re-scores only the top MAX_AI_SCORES_PER_RUN (default 20) jobs that don't already have an AI score newer than the last profile change, in batches of 10.
- Each job's description is cut to 2,500 characters in the Claude scoring prompt — that's where the role summary lives; the rest is mostly boilerplate, and it bounds cost per run.
- Sample/mock postings (`source = "mock"`) are used when MOCK_JOBS=true, or when there's nothing real to query — the app always has something to show offline.
- Jobs not seen by any search in 21 days are hidden from results (treated as closed).
- The refresh API refuses to start a second run for the same user while one is in flight (409).
