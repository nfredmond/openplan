# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**OpenPlan** — a free, open-source, AI-powered **operating system for planners**. It brings transportation demand modeling, community-engagement mapping (a SocialPinpoint-style public-input platform), and project + grant management into one workbench for the people who plan and build communities: RTPAs, MPOs, cities, counties, state agencies (e.g. Caltrans), planning and environmental consulting firms, tribes, non-profits, and independent planners. The goal is one all-in-one system for transportation, urban, city, environmental, and land-use planning — the operating system for planners of the future.

**Stack:** Next.js 16 (App Router) · React 19 · Supabase (Postgres + PostGIS + Auth + Storage) · Mapbox GL JS v3 (direct, not react-map-gl) · Claude API via Vercel AI SDK · TypeScript · Tailwind CSS v4 · shadcn/ui · Vercel.

## Git workflow — one clean `main`

Nathaniel wants **exactly one clean `main`**: no long-lived branches, no open PRs, nothing dangling. Review is done by an **agent (Claude), not a human** — do not wait on human PR review. Once a change is written and verified (lint + tests + build green, plus the relevant worker pytest for Python changes), **land it on `main`, push, and keep everything synced**; delete any working branch afterward. A short-lived working branch during a single change is fine, but converge back to `main` — keep all OpenPlan work consolidated on `main` unless there is a genuinely strong reason to hold something on a branch (and if so, say why).

## Critical gotchas

- **All app code lives in `openplan/`.** Run every `npm`/`supabase` command from that subdirectory, not the repo root.
- **Package manager is npm** (`packageManager: npm@11.11.0`), not pnpm — despite historical proof logs citing `pnpm`. The one exception: `qa:gate` deliberately shells `corepack pnpm@10.33.0 audit` for the dependency audit. Don't "fix" that to npm.
- **`build` uses the webpack builder** (`next build --webpack`), not Turbopack. If you run `next dev` from a git worktree with a symlinked `node_modules`, Turbopack rejects the symlink — use `next dev --webpack`.
- **Python modeling workers live in `workers/`** (not `openplan/`) — the AequilibraE screening worker, county onramp, and ActivitySim scaffold. They run their own pytest suites.

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
