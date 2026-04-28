# OpenPlan Workspace URL Isolation Session-Continuity Handoff — 2026-04-28

## Scope

Bounded readiness slice for the remaining external-user gate: local synthetic workspace A vs workspace B URL/session isolation. No production data, customer credentials, emails, Stripe actions, or workspace creation for real people were used.

## Change

- Hardened `qa-harness/openplan-local-workspace-url-isolation-smoke.js` so every denied cross-workspace URL navigation is followed by an own-workspace URL load in the same browser session.
- Added `--validate-fixture` for no-browser fixture contract checks.
- Required fixture coverage where every denied user also has an own-workspace allowed URL.
- Expanded synthetic leak checks from project title only to project title plus workspace name.
- Updated the local seed fixture output, example fixture, QA README, and smoke prep memo.

## Validation Run

- `node --check qa-harness/openplan-local-workspace-url-isolation-smoke.js` — pass
- `npm run local-workspace-url-isolation-smoke -- --example-fixture` from `qa-harness/` — pass
- `OPENPLAN_SYNTH_WORKSPACE_A_PASSWORD=dummy OPENPLAN_SYNTH_WORKSPACE_B_PASSWORD=dummy npm run local-workspace-url-isolation-smoke -- --fixture fixtures/workspace-url-isolation.local.example.json --validate-fixture` from `qa-harness/` — pass
- Existing ignored local fixture validation with the two local synthetic password env vars set — pass
- `corepack pnpm exec tsc --noEmit --pretty false` from `openplan/` — pass
- `npm run lint` from `openplan/` — pass
- `git diff --check` — pass

## Not Run

- Full browser smoke was not run because local Next was not listening on `localhost:3000` or `localhost:3010`, local Supabase was not listening on `127.0.0.1:54321`, and `corepack pnpm supabase status -o env` could not access the Docker socket in this sandbox.
- `corepack pnpm seed:workspace-isolation -- --dry-run --base-url http://localhost:3000` did not reach the seed script because `tsx` failed to open its IPC pipe in this sandbox with `listen EPERM`.
- Commit/push was attempted but blocked because Git could not create `.git/index.lock` on the read-only repository metadata mount.

## Handoff

When the local app and Supabase are available, run:

```bash
cd openplan
corepack pnpm seed:workspace-isolation -- --base-url http://localhost:3010
cd ../qa-harness
export OPENPLAN_SYNTH_WORKSPACE_A_PASSWORD='<local synthetic password printed by the seed>'
export OPENPLAN_SYNTH_WORKSPACE_B_PASSWORD='<local synthetic password printed by the seed>'
npm run local-workspace-url-isolation-smoke -- --fixture fixtures/workspace-url-isolation.local.json
```

Expected added proof: each synthetic user is denied from the other workspace's URL, no project/workspace identifying text leaks in the denied view, and the same denied browser session still loads its own workspace URL afterward.
