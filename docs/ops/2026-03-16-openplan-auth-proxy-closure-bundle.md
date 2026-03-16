# OpenPlan Auth/Proxy Closure Bundle — 2026-03-16

## Purpose
This note closes the loop on the March 15–16 auth/proxy debugging lane by putting the final code fix, proof note, screenshots, and supporting harness in one place.

## Final outcome
- **Status:** fixed and stable
- **Current auth entrypoint:** `openplan/src/proxy.ts`
- **Retired conflicting path:** archived reference copy of the temporary `middleware.ts` variant now lives at `docs/ops/archive/2026-03-15-middleware-entrypoint-reference.ts`
- **Build posture:** local production build green after returning to proxy-only
- **Production posture:** protected-route sign-in preserves redirect targets and authenticated smoke passes on the deployed app

## Canonical repo trail
- Code fix commit: `c1a9449` — `fix: use proxy-only auth entrypoint`
- Proof + roadmap commit: `e8e0f8b` — `docs: add production smoke proof and modeling roadmap`

## Primary proof note
- `docs/ops/2026-03-16-openplan-production-authenticated-smoke.md`

## Screenshot evidence
### Pre-fix failure-state references
- `docs/ops/2026-03-15-test-output/2026-03-15-prod-auth-smoke-01-signed-out-redirect.png`
- `docs/ops/2026-03-15-test-output/2026-03-15-prod-auth-smoke-02-unprovisioned-models.png`
- `docs/ops/2026-03-15-test-output/inspect-after-login-models.png`

### Post-fix passing smoke
- `docs/ops/2026-03-16-test-output/2026-03-16-prod-auth-smoke-01-signed-out-redirect.png`
- `docs/ops/2026-03-16-test-output/2026-03-16-prod-auth-smoke-02-models-after-login.png`
- `docs/ops/2026-03-16-test-output/2026-03-16-prod-auth-smoke-03-projects-list.png`
- `docs/ops/2026-03-16-test-output/2026-03-16-prod-auth-smoke-04-models-list.png`
- `docs/ops/2026-03-16-test-output/2026-03-16-prod-auth-smoke-05-model-detail.png`
- `docs/ops/2026-03-16-test-output/2026-03-16-prod-auth-smoke-06-plan-detail.png`
- `docs/ops/2026-03-16-test-output/2026-03-16-prod-auth-smoke-07-program-detail.png`
- `docs/ops/2026-03-16-test-output/2026-03-16-prod-auth-smoke-08-billing.png`

## Supporting harness
- `qa-harness/openplan-prod-auth-smoke.js`
- `qa-harness/package.json`
- `qa-harness/package-lock.json`
- `qa-harness/README.md`
- `qa-harness/.gitignore`

## Cleanup choice applied
- Removed the disabled middleware reference from the active app source tree and archived it under `docs/ops/archive/`.
- Kept the QA harness, but excluded transient local install output via `.gitignore` rather than committing `node_modules`.

## Remaining follow-up
- Decide later whether to delete or retain the QA-created production records/workspace.
- Refresh command-board / priority docs so every truth surface reflects that auth/proxy is no longer an active blocker.
