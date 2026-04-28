# OpenPlan Local Workspace URL Isolation Smoke Prep — 2026-04-25

## Purpose

Prepare the next non-Stripe proof lane after commit `671256a`: a browser-level workspace A vs workspace B URL smoke that uses only local synthetic users and does not mutate production data.

## Artifact added

- Harness: `qa-harness/openplan-local-workspace-url-isolation-smoke.js`
- Example fixture: `qa-harness/fixtures/workspace-url-isolation.local.example.json`
- npm script: `npm run local-workspace-url-isolation-smoke -- --fixture <fixture.json>` from `qa-harness/`

## What it proves

For each workspace-scoped URL in the fixture:

1. Synthetic user A can sign in locally and load an A-owned URL.
2. Synthetic user B can sign in locally and is clearly denied from the same A-owned URL.
3. The denied view does not leak the fixture's A-only identifying text.
4. The denied user's same browser session can still load its own workspace URL after the denial, proving the cross-workspace navigation did not poison or switch the session.
5. The same pattern can be mirrored for B-owned URLs.

The harness writes a dated evidence memo to `docs/ops/<date>-openplan-local-workspace-url-isolation-smoke.md` and screenshots to `docs/ops/<date>-test-output/` when run with real local fixture values.

## Safety posture

- Defaults to `http://localhost:3000` and refuses non-local base URLs unless `--allow-nonlocal` is explicitly passed.
- Performs browser navigation/sign-in checks only.
- Does not use Supabase service-role keys.
- Does not create, update, or delete auth users, workspaces, projects, plans, models, or reports.
- Rejects inline fixture passwords; use `passwordEnv` or a Playwright `storageStatePath` so real secrets do not get committed.

## Local prerequisites

1. Run OpenPlan locally against local/synthetic Supabase data.
2. Seed two synthetic users and two separate workspaces in the local database.
3. Create at least one workspace-scoped record per workspace, preferably a project detail URL first:
   - A-only project title: `Synthetic A Project`
   - B-only project title: `Synthetic B Project`
4. Copy `qa-harness/fixtures/workspace-url-isolation.local.example.json` to an ignored local fixture or edit a throwaway fixture outside git.
5. Replace the placeholder URLs and expected text with the local synthetic record IDs/text.
6. Export the local synthetic passwords, for example:

```bash
export OPENPLAN_SYNTH_WORKSPACE_A_PASSWORD='<local-only-password>'
export OPENPLAN_SYNTH_WORKSPACE_B_PASSWORD='<local-only-password>'
```

## Commands

Syntax/fixture sanity:

```bash
cd qa-harness
node --check openplan-local-workspace-url-isolation-smoke.js
npm run local-workspace-url-isolation-smoke -- --example-fixture
OPENPLAN_SYNTH_WORKSPACE_A_PASSWORD=dummy OPENPLAN_SYNTH_WORKSPACE_B_PASSWORD=dummy \
  npm run local-workspace-url-isolation-smoke -- --fixture fixtures/workspace-url-isolation.local.example.json --validate-fixture
```

Real local smoke, after local users/records exist:

```bash
cd qa-harness
npm run local-workspace-url-isolation-smoke -- --fixture fixtures/workspace-url-isolation.local.json
```

## Supabase note

Supabase was not touched for this prep slice. The harness intentionally assumes the local synthetic auth/workspace fixture already exists so the proof lane can be prepared without production mutation or service-role access. The next implementation step, if desired, is a separate local seed fixture/script that creates only local Supabase records and is clearly barred from production.

## Follow-up enablement

- Added app-side local-only seed script: `openplan/scripts/seed-local-workspace-isolation.ts`.
- Added npm script: `pnpm seed:workspace-isolation` from `openplan/openplan`.
- The seed script refuses non-local Supabase/app URLs, creates/updates only `@example.test` local synthetic users, upserts deterministic synthetic workspaces/projects, removes accidental cross-memberships between the two synthetic users, verifies project RLS read/cross-read behavior with anon-authenticated clients, and writes the ignored fixture at `qa-harness/fixtures/workspace-url-isolation.local.json`.

## Blocker / not yet executed

Resolved for local environments with Supabase and the Next dev server running. If either service is down, run `corepack pnpm supabase status -o env` / `corepack pnpm dev` from `openplan/openplan`, then seed and run the harness.
