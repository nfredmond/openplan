# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**OpenPlan** — a free, open-source, AI-powered **operating system for planners**. It brings transportation demand modeling, community-engagement mapping (a SocialPinpoint-style public-input platform), and project + grant management into one workbench for the people who plan and build communities: RTPAs, MPOs, cities, counties, state agencies (e.g. Caltrans), planning and environmental consulting firms, tribes, non-profits, and independent planners. The goal is one all-in-one system for transportation, urban, city, environmental, and land-use planning — the operating system for planners of the future.

**Stack:** Next.js 16 (App Router) · React 19 · Supabase (Postgres + PostGIS + Auth + Storage) · Mapbox GL JS v3 (direct, not react-map-gl) · Claude API via Vercel AI SDK · TypeScript · Tailwind CSS v4 · shadcn/ui · Vercel.

## Product non-negotiables — READ BEFORE PLANNING ANY WORK

These are binding constraints from Nathaniel, not preferences. They have been violated before; do not
violate them again. If a proposed task conflicts with one of these, say so and propose an alternative
instead of proceeding.

**0. NOTHING IS HARDCODED. Ever.**
No place, jurisdiction, agency, or organization may be baked into code as a constant. Anything that
varies between users is **configuration or data**, never a literal. If you find yourself typing a
county name, a bounding box, a FIPS code, an agency name, a specific coordinate, or "58" because
California has 58 counties — stop, and make it a parameter, a registry entry, or a database row.

The test: *could a planner in a different place, with different data, use this without a code
change?* If not, it is hardcoded, and it is a defect.

**And the architecture must not assume the United States.** The US is the current scope; **worldwide
is the eventual target**, so anything country-specific — FIPS codes, Census/ACS, TIGERweb, KABCO
severity, state DOT feeds, CCRS — belongs behind an adapter or registry, never in a core type or a
shared schema. Adding a new country, state, or data source should mean adding a descriptor, not
editing call sites. Core concepts (a study area, a crash, a claim tier) must stay
jurisdiction-neutral.

**1. It must work for ANYONE in the United States today. All of California is the floor.**
No feature ships fitted to one county, one agency, or one pilot. A planner in Ohio, Texas, or Fresno
must be able to select their own geography and have the feature work — or be told plainly and
specifically that their area is not covered and why.

- **Never hardcode a study area.** No baked-in Nevada County / NCTC / Grass Valley bboxes, county
  codes, coordinates, or FIPS. A map's initial camera position may default to the continental US
  (`CONTINENTAL_US_CENTER`); the *analysis geography* must always come from the user.
- **Reuse the existing any-place front door** — `src/lib/geographies/place-resolver.ts`,
  `/api/geographies/places`, `/api/geographies/place-boundary`, and
  `src/components/models/study-area-picker.tsx` (TIGERweb-backed: county / place / CDP / metro / micro).
  Do not invent a second geography selector.
- **Geographic limits must be disclosed, never silently applied.** Where a data source genuinely
  cannot cover an area (e.g. CCRS crash data is California-only), the UI states the limit and the
  reason. An empty result must never be presentable as "nothing found here".
- A single-state or single-source capability is acceptable ONLY if it is labeled as such and the app
  degrades honestly outside it.

**2. Deepen and connect the existing modules. Do not add new ones.**
OpenPlan already has ~16 modules and none is finished. The work is making them deeper and making them
compose — a planner should carry one piece of work across modules without re-entering it. Proposing a
new module is almost always the wrong answer; extending an existing one is almost always right.

**3. Build the product; do not plan outreach.**
Do not propose conferences, pilots, lighthouse users, demos, design partners, or "get one agency to
try it". Nathaniel drives all outreach and has explicitly cancelled that lane. The app must be good
enough for any agency or consultant to use fully and unaided **before** it is shown to anyone.

**4. Self-service is the bar, and it is now the official product posture.** Any agency, MPO/RTPA,
city, county, tribe, non-profit, or private planning/environmental consultancy — anywhere in the
United States — must be able to sign up and use OpenPlan fully on their own: their geography, their
data, no founder involvement, no hand-configured environment, no access queue. When a change requires
operator setup or a manual step, that is a defect to be designed out, not a documented workaround.

**Decided 2026-07-23 (Nathaniel):** the product is **self-serve**. The earlier "not self-serve,
request-access, founder fit-review" posture was introduced unintentionally and is **reversed**. The
public site should offer real sign-up, a workspace should be usable by a whole team without founder
involvement, and `/request-access` is no longer the intended front door.

**5. OpenPlan is free and open source. There is no paid tier and no payment step.**
**Decided 2026-07-23 (Nathaniel):** the Stripe/billing subsystem is **legacy** — it predates this
posture and is not part of the product. Do not route self-service through it, do not "fix" the
disabled checkout, and do not add plan/subscription gating to any new feature. Sign-up is free and
immediate. (`src/lib/billing/*`, `src/app/api/billing/*`, the Stripe env vars, and the plan/quota
seams are pending removal; treat them as dead code, not as a system to extend.)

**Posture flip status (as of 2026-07-23): DONE.** The capability, the claims, and the guard were
flipped in sequence, in this order — never claim ahead of capability:

1. **Capability built:** sign up → workspace auto-provisioned by the `on_auth_user_created` trigger
   (`handle_new_user`) → teammate invites (dashboard team panel, `/api/workspaces/invitations`
   GET/POST/DELETE) → password recovery (`/auth/callback`, `/forgot-password`, `/reset-password`).
   All free, no founder, no payment.
2. **Claims changed:** the landing hero and header (`src/app/(public)/page.tsx`, `layout.tsx`) lead
   with "Create your free workspace" → `/sign-up`. `/request-access` remains ONLY as a paid-services
   inquiry path (hosting/implementation), never as the way to reach the software.
3. **Guard rewritten to the NEW truth:** `src/test/public-page-claims-guardrails.test.ts` now asserts
   the front door leads with self-serve sign-up and that no founder gate is reinstated — while KEEPING
   the modeling-overclaim and no-paid-checkout prohibitions (the product is free and still
   screening-grade). It was rewritten, not deleted.

**Leave `sales-proof-claim-boundaries.test.ts` and the `docs/` proof packets alone.** That guard scans
DATED proof documents that were accurate as of their date; editing a dated record to match today's
posture would falsify it. It is not part of the live claim.

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

Nathaniel wants **exactly one clean `main`**: no long-lived branches, no open PRs, nothing dangling. Review is done by an **agent (Claude), not a human** — do not wait on human PR review. Once a change is written and verified (lint + tests + build green, plus the relevant `workers/**/test_*.py` script for Python changes — see Commands; there is no pytest), **land it on `main`, push, and keep everything synced**; delete any working branch afterward. A short-lived working branch during a single change is fine, but converge back to `main` — keep all OpenPlan work consolidated on `main` unless there is a genuinely strong reason to hold something on a branch (and if so, say why).

## Critical gotchas

- **The Next.js app lives in `openplan/`.** There is no root `package.json`, so run every `npm`/`supabase` command for the app from that subdirectory. The one other npm project is `qa-harness/` (Playwright browser smoke checks, its own `package.json` + 25 `local-*`/`prod-*` scripts) — run those from `qa-harness/`, not `openplan/`.
- **Package manager is npm** (`packageManager: npm@11.11.0`), not pnpm — despite historical proof logs citing `pnpm`. The one exception: `qa:gate` deliberately shells `corepack pnpm@10.33.0 audit` for the dependency audit. Don't "fix" that to npm.
- **`build` uses the webpack builder** (`next build --webpack`), not Turbopack. If you run `next dev` from a git worktree with a symlinked `node_modules`, Turbopack rejects the symlink — use `next dev --webpack`.
- **Python modeling workers live in `workers/`** (not `openplan/`) — the AequilibraE screening worker, county onramp, and ActivitySim scaffold.
- **There is no pytest in this repo.** The worker suites are dependency-free stdlib scripts, each run directly: `python3 workers/aequilibrae_worker/test_count_validation.py`. Run them all with `for f in workers/aequilibrae_worker/test_*.py; do python3 "$f" || break; done` (17 files). `pytest` is not installed and not in any `requirements*.txt`.
- **`npm exec` swallows `--` flags.** `npm exec supabase gen types typescript --local` fails with *"Must specify one of --local, --linked…"* because npm consumes the flag. Use `npm exec -- supabase …` whenever passing a flag.
- **Prefer `supabase migration up` over `db reset` locally.** `db reset` re-applies every migration from scratch and destroys local data (seeded workspaces, runs, in-flight session state). `migration up` applies only the new ones and is non-destructive.

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

npm exec -- supabase start           # local Supabase stack
npm exec -- supabase migration up    # apply NEW migrations only (non-destructive — prefer this)
npm exec -- supabase db reset        # re-apply ALL migrations; DESTROYS local data
```

**Supabase clients are intentionally untyped — there is no `supabase gen types` step.** `src/types/supabase.ts`
does not exist, nothing imports a generated `Database` type, and the three factories in
`src/lib/supabase/{client,server,middleware}.ts` take no type parameter. This is a documented convention,
not an oversight: `src/lib/knowledge-base/documents.ts:4-6` states it — *"the passed-in Supabase client is
typed loosely and query results are cast, avoiding the Database generic"* (see also `src/lib/models/api.ts`).
Do not add a type-regeneration step to a schema change; the output would have no consumer. The practical
consequence: `.select()` strings are **not** type-checked against the schema, so a column typo surfaces at
runtime rather than at build — cast query results deliberately. Adopting generated types would mean threading
a `Database` generic through every client, which is a deliberate architectural change, not a chore.

Python worker tests (from the repo root, not `openplan/`):

```bash
python3 workers/aequilibrae_worker/test_count_validation.py           # one suite
for f in workers/aequilibrae_worker/test_*.py; do python3 "$f" || break; done   # all 17
```

Run a single test: `npm test -- src/test/<file>.test.ts` or `npm test -- -t "<test name>"`.

