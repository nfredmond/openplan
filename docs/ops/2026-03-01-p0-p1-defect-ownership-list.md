# OpenPlan Ship Week Day 1 — P0/P1 Defect Ownership List

**Date (PT):** 2026-03-01  
**Maintainer:** Elena Marquez (Principal Planner)  
**Decision lock:** APPROVED A + strict NO NEW FEATURES (closure-only lane)  
**Source references:**
- `openplan/docs/ops/2026-03-01-openplan-ship-board.md`
- `openplan/docs/ops/2026-03-01-ship-evidence-index.md`
- `openplan/docs/ops/2026-03-01-engineering-p0-burn-plan.md`
- `openplan/docs/ops/2026-03-01-critical-ux-risk-audit.md`

## P0 Defects (must close or approved mitigation before ship gate)

| ID | Defect | Owner | Backup | Current Status | ETA | Evidence Paths |
|---|---|---|---|---|---|---|
| P0-D01 | Deterministic workspace-bound billing/webhook closure not fully evidenced in live canary lifecycle (manual+synth lifecycle proved; real canary lineage still pending) | Iris | Elena | OPEN | Morning gate +45–60 min replay window | `openplan/docs/ops/2026-03-01-test-output/2026-03-01-2049-b01-closure-bundle.log`<br>`openplan/docs/ops/2026-03-01-test-output/2026-03-01-2051-b01-workspace-revert.log`<br>`openplan/docs/ops/2026-03-01-test-output/2026-03-01-2219-b01-synthetic-lifecycle-proof.log`<br>`openplan/docs/ops/2026-03-01-b01-external-replay-blocker-mitigation.md` |
| P0-D02 | Explicit auth guard coverage gap on critical API routes (`report`, `runs`) | Iris | Owen | CLOSED | Closed @ 13:00 | `openplan/docs/ops/2026-03-01-test-output/2026-03-01-1202-p0-route-auth-membership-tests.log`<br>`openplan/docs/ops/2026-03-01-test-output/2026-03-01-1206-p0-api-auth-coverage-scan.log` |
| P0-D03 | Core planner E2E artifact posted, but production-like runtime proof not yet linked | Iris + Owen | Mateo | OPEN | Morning 09:00 gate | `openplan/docs/ops/2026-03-01-test-output/2026-03-01-1615-core-planner-e2e.log`<br>`openplan/docs/ops/2026-03-01-pilot-acceptance-criteria.md` |
| P0-D04 | Grant-lab E2E evidence artifact not yet posted | Iris + Owen + Camila | Mateo | OPEN | Morning 09:00 gate | `openplan/docs/ops/2026-03-01-openplan-qa-qc-rhythm.md`<br>`openplan/docs/ops/2026-03-01-test-output/2026-03-01-2220-evidence-presence-scan.log` |
| P0-D05 | Post-purchase “what happens next” UX implementation extraction exists; runtime verification proof still missing | Camila + Iris | Mateo | OPEN | Morning 09:00 gate | `openplan/docs/ops/2026-03-01-test-output/2026-03-01-1622-b05-post-purchase-proof.log`<br>`openplan/docs/ops/2026-03-01-critical-ux-implementation-verification-checklist.md` |
| P0-D06 | Payment/activation safe-error implementation test exists; runtime verification proof still missing | Camila + Iris | Mateo | OPEN | Morning 09:00 gate | `openplan/docs/ops/2026-03-01-test-output/2026-03-01-1620-b06-safe-error-route-tests.log`<br>`openplan/docs/ops/2026-03-01-critical-ux-implementation-verification-checklist.md` |
| P0-D07 | Production rollback checklist proof artifact missing for P0 ship-board claim | Iris + Elena | Mateo | CLOSED | Closed @ 15:59 | `openplan/docs/ops/2026-03-01-openplan-rollback-checklist-day1.md`<br>`openplan/docs/ops/2026-03-01-test-output/2026-03-01-1257-clean-gate-lint-test-build.log` |

## P1 Defects (fix before ship unless approved mitigation)

| ID | Defect | Owner | Backup | Current Status | ETA | Evidence Paths |
|---|---|---|---|---|---|---|
| P1-D01 | Light-mode header nav contrast below readability comfort | Camila | Iris | OPEN | 17:30 gate | `agents/team/assistant-planner/reports/2026-02-28-light-mode-contrast-punch-list.md`<br>`openplan/docs/ops/2026-03-01-critical-ux-risk-audit.md` |
| P1-D02 | Light-mode logo trust cue too weak | Camila | Iris | OPEN | 17:30 gate | `agents/team/assistant-planner/reports/2026-02-28-light-mode-contrast-punch-list.md` |
| P1-D03 | Small helper/status text legibility weak on light surfaces | Camila | Iris | OPEN | 17:30 gate | `agents/team/assistant-planner/reports/2026-02-28-light-mode-contrast-punch-list.md` |
| P1-D04 | Outline controls/onboarding CTAs not visually assertive enough | Camila | Iris | OPEN | 17:30 gate | `openplan/docs/ops/2026-03-01-critical-ux-risk-audit.md` |
| P1-D05 | Focus-visible state likely too weak for keyboard trust/accessibility | Camila | Iris | OPEN | 17:30 gate | `openplan/docs/ops/2026-03-01-critical-ux-risk-audit.md` |

## Governance Rule
- Any unresolved **P0** at 17:30 gate = **automatic HOLD**.
- Every status change must include at least one updated evidence path.
- No new feature claims enter gate packet unless tied to explicit blocker closure evidence.

## Scope Control Lock (2026-03-02 01:00 PT)
- **Executive decision:** APPROVED A.
- **Hard rule:** no new features until P0 blockers are closed with evidence.
- **Permitted execution only:** B-01/B-03/B-04/B-05/B-06 closure, evidence updates, and QA packet prep.
