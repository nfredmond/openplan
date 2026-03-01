# OpenPlan Day 1 — Production Rollback Checklist (P0-D07)

- Date (PT): 2026-03-01
- Owner: Iris Chen
- Governance tie: `openplan/docs/ops/2026-03-01-openplan-ship-board.md`
- Evidence tie: `openplan/docs/ops/2026-03-01-ship-evidence-index.md`

## Trigger conditions (rollback required)
1. New deploy introduces auth/session regression on critical routes.
2. Billing checkout/webhook path degrades or fails deterministically.
3. Core planner or grant-lab flow becomes unavailable or unsafe for pilot use.

## Rollback sequence (Vercel)
1. Identify latest known-good deployment in Vercel for project `natford/openplan`.
2. Promote known-good deployment to production (`vercel promote <deployment-url>` or dashboard Promote action).
3. Confirm production domain points to promoted deployment.

## Post-rollback validation commands
Run from `openplan/openplan`:
```bash
npm run lint
npm test
npm run build
```

## Post-rollback smoke checks (must pass)
1. `/sign-in` and `/dashboard` auth redirect behavior works.
2. `/api/runs` and `/api/report` reject unauthorized access and allow authorized member access.
3. Billing page loads and checkout init path responds safely.
4. API smoke guardrails pass for invalid inputs.

## Required gate artifacts after rollback
- Clean gate log:
  - `openplan/docs/ops/2026-03-01-test-output/2026-03-01-1257-clean-gate-lint-test-build.log`
- Route auth/membership evidence:
  - `openplan/docs/ops/2026-03-01-test-output/2026-03-01-1202-p0-route-auth-membership-tests.log`
  - `openplan/docs/ops/2026-03-01-test-output/2026-03-01-1206-p0-api-auth-coverage-scan.log`
- Billing reliability evidence:
  - `openplan/docs/ops/2026-03-01-test-output/2026-03-01-1155-p0-billing-tests.log`
  - `openplan/docs/ops/2026-03-01-test-output/2026-03-01-1156-p0-billing-workspace-mutation-check.log`
  - `openplan/docs/ops/2026-03-01-test-output/2026-03-01-1158-p0-billing-live-canary-monitor.log`

## Day-1 rollback readiness status
- Checklist artifact published.
- Awaiting Principal QA linkage in final 17:30 gate packet.
