# OpenPlan QA Harness

Purpose: keep one-off but reusable production QA scripts outside the app runtime while preserving the exact evidence-generation path used for ship-critical checks.

## Current scripts
- `openplan-prod-auth-smoke.js` — creates a dedicated QA auth user plus QA records in production, verifies redirect continuity and authenticated route flow, and writes screenshots/report artifacts into `docs/ops/<date>-test-output/` and `docs/ops/<date>-openplan-production-authenticated-smoke.md`.
- `openplan-prod-engagement-smoke.js` — creates a dedicated QA auth user, proves the unprovisioned `/engagement` state, bootstraps a workspace, and then drives the live engagement catalog/detail UI through campaign creation, category creation, intake item entry, moderation approval, and catalog refresh. Writes screenshots/report artifacts into `docs/ops/<date>-test-output/` and `docs/ops/<date>-openplan-production-engagement-smoke.md`.

## Usage
From `openplan/qa-harness`:

```bash
npm install
node openplan-prod-auth-smoke.js
node openplan-prod-engagement-smoke.js
```

## Notes
- Reads OpenPlan env from `../openplan/.env.local`.
- Uses Playwright in headless mode.
- Intended for controlled operator use, not CI.
- Creates QA production data; cleanup is a deliberate follow-up step.
