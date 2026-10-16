# Job Finder

A personal web app that finds job postings matching your resume, lets you filter and track them, logs applications to a Google Sheet, and emails you the top matches every morning.

Built with Next.js (App Router) + TypeScript, Tailwind CSS, Drizzle ORM on Postgres, Auth.js, the Claude API, and Resend.

## Quick start (no keys needed)

```bash
npm install
npm run dev
```

Open http://localhost:3000. With no `.env.local`, the app uses an embedded Postgres (PGlite) stored in `.data/`, so nothing else needs to be installed.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | Vitest unit tests |
| `npm run check` | All of the above |
| `npm run db:generate` | Generate a migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` |

## Configuration

Copy `.env.example` to `.env.local`. Every variable is documented there.
