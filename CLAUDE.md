@AGENTS.md

# Job Finder: notes for Claude

A personal web app: matches job postings to the owner's resume, tracks applications in their Google Sheet, emails the top new matches every morning. One real user. Public repo, hosted on Vercel Hobby.

`README.md` covers setup and env vars, `DECISIONS.md` records past choices and their reasons, and `PROGRESS.md` covers status and what hasn't been verified yet. Read `DECISIONS.md` before reversing an earlier choice.

## Hard rules

- **Free to run.** Don't add paid services or anything that needs a credit card. Leave `ANTHROPIC_API_KEY` unset: the keyword matcher in `src/lib/resume/analyze.ts` and `src/lib/jobs/scoring.ts` is the real matching path, not a fallback. Stay within Vercel Hobby (crons at most daily, functions ≤ 60 s), Neon free, and Resend free.
- **Public repo.** Never commit secrets or personal data (name, email, resume, sheet ID). Config goes in env vars (`.env.local`, git-ignored); user data goes in the database. Every new env var also goes in `.env.example`, the README table, and `src/lib/env.ts`.
- **Next.js 16.** APIs differ from what you were trained on. Check `node_modules/next/dist/docs/` before using a Next API.
- **Done means `npm run check` passes** (lint, typecheck, Vitest, build). CI runs the same check on every push and PR.
- **Security invariants:** every server action and API route resolves the user (`requireUser` / `currentUserId` in `src/lib/session.ts`) and scopes every query by `userId`. The cron route requires `CRON_SECRET`. `ALLOWED_EMAILS` restricts Google sign-in. `ENABLE_DEMO_LOGIN=true` must never reach production.
- **Don't commit** `TODO.md`, `skills-lock.json` or `.claude/skills/`. They're local only and already git-ignored, so don't force-add them.

## Running it

- `npm run dev` → http://localhost:3000. Only one dev server can run per folder. For parallel work, use a separate git worktree and port (`npx next dev -p 3001`).
- Signing in locally: once Google is configured, the demo login is hidden. Set `ENABLE_DEMO_LOGIN=true` in `.env.local` to get it back for testing (local only).
- With `DATABASE_URL` set, the app uses Neon; without it, it uses an embedded PGlite in `.data/`. The project folder is synced by OneDrive, which can break `.data/`; see README → Troubleshooting.
- `npx tsx scripts/try-sources.ts greenhouse:stripe lever:spotify` fetches real job boards without the UI.

## UI map

| Route | Files | What it does |
| --- | --- | --- |
| `/` | `src/app/page.tsx` | Sign-in (Google, or demo locally) |
| `/jobs` | `src/app/(app)/jobs/*`: `page.tsx`, `job-card.tsx`, `filter-panel.tsx`, `filters-toggle.tsx`, `refresh-button.tsx`, `apply-actions.tsx` | Ranked matches, filters (URL search params), Refresh, Mark applied |
| `/applications` | `src/app/(app)/applications/*` | Applied jobs, status changes, Sheets sync status |
| `/resume` | `src/app/(app)/resume/*` | Upload PDF/DOCX, review and edit extracted skills and titles |
| `/settings` | `src/app/(app)/settings/*` | Preferences, target companies, Google Sheet mapping, integrations status, digest preview |
| shell | `src/app/(app)/layout.tsx`, `src/components/nav-links.tsx` | Header, nav, sign-out, auth gate |
| email | `src/emails/morning-digest.tsx` | React Email morning digest (preview at `/api/digest/preview`) |

- Design tokens (light and dark) are CSS variables in `src/app/globals.css`, exposed to Tailwind v4 through `@theme inline`. Change colors there, not per component.
- The theme is dark-first charcoal with section colours: `data-section` (set by `SectionScope`) drives `--section`, `--section-fg`, `--section-bg`, `--section-on`, so primary buttons, links and icon tiles recolour per page. Use `bg-section text-section-on` for solid section fills.
- Shared primitives live in `src/components/ui.tsx`: `Button`, `Card`, `Badge`, `Alert`, `EmptyState`, `PageHeader`, `inputClass`. Extend these rather than restyling inline. Forms use `ActionForm` / `SubmitButton` from `src/components/action-form.tsx`.
- Pages are Server Components that read from the database. Interactive pieces are small `"use client"` files next to them. Keep data fetching on the server.
- Every route has loading and error states (`loading.tsx`, `error.tsx`). Keep them when restructuring.

## Working as one of several agents

- Work on a branch (`ui/<topic>`), not `main`, and open a PR. CI must be green before merging.
- Keep PRs to one concern (one page or one primitive), so parallel work merges cleanly. Changes to `ui.tsx` or `globals.css` affect every page, so coordinate them, or make them first in their own PR.
- Record any non-obvious decision as one line in `DECISIONS.md`.
