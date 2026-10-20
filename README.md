# Job Finder

A personal web app that finds job postings matching your resume, lets you filter and track them, logs applications to your own Google Sheet, and emails you the top new matches every morning.

- **Sources (APIs only):** Greenhouse, Lever, and Ashby public job boards (per target company), plus Adzuna and USAJobs search (with API keys). No scraping.
- **Matching:** your resume is parsed into skills, titles, seniority, and keywords (Claude, or a built-in extractor without a key). A cheap keyword score ranks every posting; Claude re-scores only the top candidates each run and writes a one-line reason.
- **Tracking:** "Mark applied" saves the application and writes a row to your Google Sheet using a column mapping you control.
- **Morning email:** at 7:00 AM Central, a Vercel Cron job searches again and emails up to 10 new matches.

Stack: Next.js 16 (App Router) + TypeScript, Tailwind CSS v4, Drizzle ORM on Postgres (Neon or Supabase), Auth.js v5 with Google, Anthropic SDK, Resend + React Email, Vitest.

---

## Quick start (no accounts or keys needed)

Requires Node.js 20.9+.

```bash
npm install
npm run dev
```

Open http://localhost:3000 and click **Continue with demo account**.

With no `.env.local` at all:

| Feature | What happens |
| --- | --- |
| Database | An embedded Postgres (PGlite) is created in `.data/` and migrated automatically |
| Sign-in | A local demo account (dev only) |
| Resume parsing / scoring | Built-in keyword extractor and keyword scoring instead of Claude |
| Greenhouse / Lever / Ashby | **Live**, no keys needed (5 example companies are pre-seeded) |
| Adzuna / USAJobs | Skipped until keys are set |
| Google Sheets | Applications are saved in the app, marked "Not synced" |
| Email | The digest is printed to the server console |

Set `MOCK_JOBS=true` to use built-in sample postings instead of live boards (offline work).

Settings → **Integrations** shows which features are live vs mocked on the running deployment.

---

## Environment variables

Copy `.env.example` to `.env.local` and fill in what you have. Nothing is required locally.

| Variable | Needed for | Where to get it |
| --- | --- | --- |
| `DATABASE_URL` | Production (required) | Neon or Supabase connection string, see [Database](#database) |
| `AUTH_SECRET` | Production (required) | Run `npx auth secret` or `openssl rand -base64 32` |
| `AUTH_GOOGLE_ID` | Google sign-in + Sheets | Google Cloud OAuth client ID, see [Google OAuth](#google-oauth-and-sheets) |
| `AUTH_GOOGLE_SECRET` | Google sign-in + Sheets | Same OAuth client |
| `ALLOWED_EMAILS` | Production (strongly recommended) | Your Google email (comma-separate several). Only these accounts can sign in |
| `GEMINI_API_KEY` | AI resume reading, match scoring and "Check my fit" (**free tier**) | https://aistudio.google.com/apikey (no billing). Free-tier inputs may be used by Google to improve its products; the app strips your name and contact details first |
| `GEMINI_MODEL` | Optional | Model tried first for resume reading and fit checks (default `gemini-3.8-flash`; bulk scoring starts on `gemini-3.5-flash-lite`, and each falls back to the other when busy) |
| `ANTHROPIC_API_KEY` | Optional, **paid** alternative to Gemini | https://console.anthropic.com → API Keys. Ignored when `GEMINI_API_KEY` is set |
| `ANTHROPIC_MODEL` | Optional | Claude model override |
| `MAX_AI_SCORES_PER_RUN` | Optional cap | Jobs the AI scores per search (default 40 with Gemini, 20 with Claude) |
| `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` | Adzuna source (**paid**: leave unset to keep the app free) | https://developer.adzuna.com → Register → your app's ID and key |
| `USAJOBS_API_KEY` | USAJobs source | https://developer.usajobs.gov/apirequest/ (key arrives by email) |
| `USAJOBS_USER_AGENT` | USAJobs source | The email address you registered with |
| `RESEND_API_KEY` | Sending the morning email | https://resend.com → API Keys |
| `EMAIL_FROM` | Sending the morning email | A sender on a domain verified in Resend, e.g. `Job Finder <jobs@yourdomain.com>` |
| `CRON_SECRET` | Morning cron | Any long random string (`openssl rand -hex 32`) |
| `APP_URL` | Optional | Base URL for links in emails. Defaults to the Vercel production URL |
| `ENABLE_DEMO_LOGIN` | Optional | `false` hides the demo sign-in; **never set `true` in production** (anyone could sign in as the demo user) |
| `MOCK_JOBS` | Optional | `true` = sample postings instead of live sources |

Your name, email, resume, and sheet ID are never in the code; they live in the database, entered through the app.

---

## Database

Any Postgres works. Two free options:

**Neon:** create a project at https://neon.tech → **Connection Details** → copy the connection string (pooled is fine).
**Supabase:** create a project at https://supabase.com → **Project Settings → Database → Connection string → URI**. Use the *Transaction pooler* URI (port 6543) for Vercel.

Then apply the migrations once (and again after pulling schema changes):

```bash
# with DATABASE_URL in .env.local
npm run db:migrate
```

Schema lives in `src/db/schema.ts`; after editing it, run `npm run db:generate` to create a new migration in `drizzle/`.

---

## Google OAuth and Sheets

1. Go to https://console.cloud.google.com and create a project (e.g. "Job Finder").
2. **APIs & Services → Library**: enable the **Google Sheets API**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform → Branding / Audience / Data access):
   - User type: **External**. App name: Job Finder. Support and developer email: yours.
   - **Data access → Add scopes:** `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`, and `https://www.googleapis.com/auth/spreadsheets`.
   - **Audience:** leave the publishing status in **Testing** and add your Google account under **Test users**.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Authorized redirect URIs:
     - `http://localhost:3000/api/auth/callback/google`
     - `https://<your-vercel-domain>/api/auth/callback/google`
5. Copy the client ID and secret into `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`.

Sign in with Google. The consent screen will warn that the app is unverified (expected for a Testing app): continue, and **allow access to Google Sheets**. The app requests offline access, so it stores a refresh token for syncing in the background.

> **Testing-mode limitation:** Google expires refresh tokens for apps in Testing after **7 days**. When that happens, Sheets sync shows "Google access was revoked or expired"; sign out and sign back in to renew it. Publishing the app removes the limit but requires Google's verification for the Sheets scope.

**Connecting your sheet:** Settings → Google Sheet. Paste the sheet URL, optionally the tab name, and map each field to the column letter it belongs in (defaults: Company A, Title B, Date applied C, Link D, Location E, Status F; Source and Match score are optional). Fields left blank aren't written. Use **Test connection** to see the tab list and header row. New rows go directly below the last used row of the mapped columns; your other columns are left untouched.

---

## Target companies

Greenhouse, Lever, and Ashby are queried per company. In Settings → Target companies, add `ats:slug` or paste a board URL:

| ATS | Board URL looks like | Entry |
| --- | --- | --- |
| Greenhouse | `job-boards.greenhouse.io/stripe` or `boards.greenhouse.io/stripe` | `greenhouse:stripe` |
| Lever | `jobs.lever.co/spotify` | `lever:spotify` |
| Ashby | `jobs.ashbyhq.com/linear` | `ashby:linear` |

To find a company's slug, open its careers page and follow an "Apply" link; the URL shows the ATS and slug. After a search, each company shows how many postings it returned, or why it failed (e.g. "No Lever board named …").

---

## Deploy to Vercel

1. Push this repo to GitHub.
2. At https://vercel.com/new, import the repo. The framework preset is detected as Next.js; keep the defaults.
3. Add the environment variables (Project → Settings → Environment Variables) for **Production**: at least `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `CRON_SECRET`, plus any of `GEMINI_API_KEY`, `USAJOBS_*`, `RESEND_API_KEY`, `EMAIL_FROM`.
4. Run `npm run db:migrate` locally against the production `DATABASE_URL` (once, before or right after the first deploy).
5. Deploy. Add `https://<your-domain>/api/auth/callback/google` to the Google OAuth client's redirect URIs.
6. Visit the site, sign in with Google, upload your resume, connect your sheet, and click **Refresh jobs**.

### Morning email cron

`vercel.json` registers two cron jobs for `/api/cron/morning`, at 12:00 and 13:00 UTC. Vercel Cron runs in UTC without daylight saving, so the route checks the time in America/Chicago and only sends from the invocation that lands in the 7 AM hour (12:00 UTC in summer, 13:00 UTC in winter), once per day. On the Hobby plan a cron can fire anytime within its hour; the hour-based check handles that.

Vercel automatically sends `Authorization: Bearer $CRON_SECRET` to cron routes when the `CRON_SECRET` env var is set. Without it, the route refuses every request.

Test it manually (`force=1` skips the 7 AM check but still sends at most once per day):

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "https://<your-domain>/api/cron/morning?force=1"
```

To preview the email without sending: Settings → **Preview the email** (or `/api/digest/preview` while signed in).

The email also reminds you, once, about applications still marked **Applied** 7 to 30 days later, with a link to update their status. On days with no new matches but a reminder due, it sends just the reminder.

**Email delivery:** in Resend, verify a domain you own and set `EMAIL_FROM` to an address on it. For a quick test without a domain, `EMAIL_FROM="Job Finder <onboarding@resend.dev>"` works, but Resend only delivers it to the email address of your Resend account. The digest goes to the email of your Google account.

---

## How it works

- `runJobSearch(userId)` in `src/lib/jobs/search.ts` is the single pipeline used by both the **Refresh jobs** button (`POST /api/jobs/refresh`) and the cron: fetch every source in parallel (12 s timeout each, a failing source never fails the run) → normalize to one `Job` shape → dedupe across sources (same company + title + location; direct ATS postings win over aggregator copies) → store → keyword prefilter (also re-ranks matches already stored, so a profile change applies everywhere) → the AI (Gemini, free) scores the top `MAX_AI_SCORES_PER_RUN` that don't already have a fresh AI score → save matches with a reason.
- Source adapters live in `src/lib/jobs/sources/`. The Greenhouse, Lever, and Ashby adapters were written against live responses; the trimmed real responses are the test fixtures in `tests/fixtures/`.
- Every search is recorded in `search_runs` with per-source counts and errors.
- Design decisions and their reasons are listed in [DECISIONS.md](DECISIONS.md).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build / server |
| `npm run lint` | ESLint |
| `npm run typecheck` | Generate route types, then `tsc --noEmit` |
| `npm test` | Vitest (parsing, normalization, scoring, filtering, Sheets, digest, DB flows on in-memory Postgres) |
| `npm run check` | All of the above |
| `npm run db:generate` | New migration from `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` |
| `npx tsx scripts/try-sources.ts greenhouse:stripe lever:spotify` | Fetch real boards and print a parsing summary |

## Troubleshooting

- **`EPERM` errors in `.next` or `.data` on Windows:** OneDrive (or another sync tool) is syncing build output. Keep the project outside a synced folder, or delete `.next` and rebuild.
- **Every page errors with `Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"` (cause: "PGlite failed to initialize properly"):** the embedded database can't write to `.data/pglite`. On OneDrive this happens when sync marks the folders ReadOnly: Windows ignores that on folders, but PGlite doesn't. Stop the dev server, run `attrib -R .data /S /D` and `attrib -R .data\* /S /D`, then start it again. To avoid it for good, set `DATABASE_URL` (PGlite is then unused), or point `PGLITE_DATA_DIR` at a folder outside OneDrive.
- **"Cannot load @napi-rs/canvas" warning:** harmless. PDF text extraction falls back to a pure-JS matrix on platforms without a native canvas build (e.g. Windows on ARM).
- **Sheets: "Google access was revoked or expired":** sign out and sign in with Google again (see the Testing-mode note above).
- **A target company shows "No … board named":** the slug is wrong or the company moved ATS; check its careers page.
- **Local data:** delete `.data/` to reset the embedded database.
