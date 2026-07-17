# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**OpenPlan** — free, open-source transportation and urban/city planning intelligence platform.

**Stack:** Next.js 16 (App Router) · React 19 · Supabase (Postgres + PostGIS + Auth + Storage) · Mapbox GL JS v3 (direct, not react-map-gl) · Claude API via Vercel AI SDK · TypeScript · Tailwind CSS v4 · shadcn/ui · Vercel.

## Critical gotchas

- **All app code lives in `openplan/`.** Run every `npm`/`supabase` command from that subdirectory, not the repo root.
- **Package manager is npm** (`packageManager: npm@11.11.0`), not pnpm — despite historical proof logs citing `pnpm`. The one exception: `qa:gate` deliberately shells `corepack pnpm@10.33.0 audit` for the dependency audit. Don't "fix" that to npm.
- **`build` uses the webpack builder** (`next build --webpack`), not Turbopack.

## Commands (run from `openplan/`)

```bash
npm run dev            # dev server, localhost:3000
npm run build          # production build (webpack)
npm test               # vitest unit tests
npm run test:watch     # vitest watch
npm run lint           # eslint
npm run qa:gate        # lint + test + pnpm audit + build — the full pre-ship gate
npm run seed:nctc      # seed NCTC pilot demo
npm run test:rls-live  # live RLS-isolation test (needs OPENPLAN_RLS_LIVE_TEST=1, set by the script)

npm exec supabase start                                                  # local Supabase stack
npm exec supabase db reset                                               # re-apply all migrations
npm exec supabase gen types typescript --local > src/types/supabase.ts   # regenerate DB types after schema changes
```

Run a single test: `npm test -- src/test/<file>.test.ts` or `npm test -- -t "<test name>"`.


## Frontend design

OpenPlan should read as a **civic workbench / planning operating system**, not a generic AI-SaaS dashboard. Prefer lists/rows/tables/sectioned worksurfaces and a left-rail + worksurface + inspector layout; avoid card grids, chip/pill clusters, and many equal-weight CTAs. Before major UI work, read `docs/ops/2026-04-08-openplan-frontend-design-constitution.md`.
