# OpenPlan QA Harness

Purpose: keep one-off but reusable production QA scripts outside the app runtime while preserving the exact evidence-generation path used for ship-critical checks.

## Current script
- `openplan-prod-auth-smoke.js` — creates a dedicated QA auth user plus QA records in production, verifies redirect continuity and authenticated route flow, and writes screenshots/report artifacts into `docs/ops/<date>-test-output/` and `docs/ops/<date>-openplan-production-authenticated-smoke.md`.

## Usage
From `openplan/qa-harness`:

```bash
npm install
node openplan-prod-auth-smoke.js
```

## Notes
- Reads OpenPlan env from `../openplan/.env.local`.
- Uses Playwright in headless mode.
- Intended for controlled operator use, not CI.
- Creates QA production data; cleanup is a deliberate follow-up step.
