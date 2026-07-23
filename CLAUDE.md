# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**OpenPlan** — a free, open-source, AI-powered **operating system for planners**. It brings transportation demand modeling, community-engagement mapping (a SocialPinpoint-style public-input platform), and project + grant management into one workbench for the people who plan and build communities: RTPAs, MPOs, cities, counties, state agencies (e.g. Caltrans), planning and environmental consulting firms, tribes, non-profits, and independent planners. The goal is one all-in-one system for transportation, urban, city, environmental, and land-use planning — the operating system for planners of the future.

**Stack:** Next.js 16 (App Router) · React 19 · Supabase (Postgres + PostGIS + Auth + Storage) · Mapbox GL JS v3 (direct, not react-map-gl) · Claude API via Vercel AI SDK · TypeScript · Tailwind CSS v4 · shadcn/ui · Vercel.

## Engineering Philosophy

OpenPlan is intended to become one of the most sophisticated planning software platforms ever built.

Speed is valuable, but correctness, maintainability, clarity, and extensibility are more important. Every implementation should be approached methodically and deliberately. Never rush simply to complete a task. Instead:

- Thoroughly understand the existing architecture before making changes.
- Read relevant modules before modifying them.
- Identify interactions between subsystems.
- Consider long-term consequences of architectural decisions.
- Prefer careful design over quick implementation.
- When uncertainty exists, investigate rather than assume.
- Document reasoning behind significant technical decisions.
- Build systems that will still make sense ten years from now.

Take the time necessary to produce excellent work.

## Repository First Principle

Treat the repository as a living body of knowledge. Before writing a single line of code:

- Read the surrounding modules.
- Understand existing conventions.
- Identify architectural patterns.
- Locate related functionality.
- Determine whether similar code already exists.
- Understand why previous developers made certain decisions.
- Avoid introducing duplicate concepts.
- Avoid creating parallel implementations.
- Prefer extending existing systems over inventing new ones.
- If existing architecture appears flawed, determine whether it is intentionally designed that way before replacing it.

Every change should make the repository more coherent than before.

## Think Before You Code

You are expected to spend substantial effort thinking before implementation. Before every significant task:

1. Understand the problem.
2. Explore the repository.
3. Identify all affected modules.
4. Consider multiple implementation strategies.
5. Compare tradeoffs.
6. Select the best long-term solution.
7. Explain your reasoning.
8. Only then begin implementation.

Reasoning time is never wasted. Avoid "first solution bias." Assume there is usually a better design than the first one that comes to mind.

## Architectural Self-Critique

Before considering any implementation complete, perform an internal design review. Ask yourself:

- Is this the simplest correct solution?
- Does this duplicate existing functionality?
- Can the design be generalized?
- Does it violate existing architectural patterns?
- Will another developer understand this in five years?
- Is this solution extensible?
- Is there unnecessary complexity?
- Is there a cleaner abstraction?
- Would this scale to thousands of organizations and millions of records?

If a substantially better solution exists, recommend it before implementation.

## Cathedral Philosophy

OpenPlan should be built like a cathedral rather than assembled like a startup prototype.

- Every subsystem should feel intentional.
- Every API should feel thoughtfully designed.
- Every database table should have a clear purpose.
- Every interface should appear coherent with the rest of the platform.
- Avoid temporary solutions unless they are explicitly documented as temporary.

Assume this software will still be actively developed decades from now. Design for future developers — including future AI agents — to understand not only what was built, but why it was built.

Progress is measured by architectural quality, coherence, correctness, and long-term value — not by lines of code written or features completed.

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

