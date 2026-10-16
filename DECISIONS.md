# Decisions

One line each: decision — why.

- Next.js 16.4 with `cacheComponents: false` — every page is per-user and request-time, so static-shell prerendering adds complexity with no benefit for a single-user app.
- Embedded Postgres (PGlite) when `DATABASE_URL` is empty (dev only) — the app runs locally with zero setup and uses the same Drizzle schema and migrations as Neon/Supabase.
- `postgres` (postgres-js) driver with `prepare: false` — works with both Neon and Supabase, including transaction-mode pooled URLs.
- Migrations live in `drizzle/` and are applied with `npm run db:migrate` (PGlite applies them on startup) — keeps schema changes explicit instead of running them during the Vercel build.
- `job_matches`, `applications`, `email_log`, `target_companies` are per-user; `jobs` is shared — job postings are the same for everyone, matches are not.
- Profile preferences are typed columns on `profiles` (not a JSON blob) — easier to query and validate.
- Added a `search_runs` table — needed to show per-source failures and run history in the UI.
