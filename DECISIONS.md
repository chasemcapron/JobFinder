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
