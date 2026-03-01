# OpenPlan Ship Week Day 1 — P0/P1 Defect Ownership List

**Date (PT):** 2026-03-01  
**Maintainer:** Elena Marquez (Principal Planner)  
**Source references:**
- `openplan/docs/ops/2026-03-01-openplan-ship-board.md`
- `openplan/docs/ops/2026-03-01-ship-evidence-index.md`
- `openplan/docs/ops/2026-03-01-engineering-p0-burn-plan.md`
- `openplan/docs/ops/2026-03-01-critical-ux-risk-audit.md`

## P0 Defects (must close or approved mitigation before ship gate)

| ID | Defect | Owner | Backup | Current Status | ETA | Evidence Paths |
|---|---|---|---|---|---|---|
| P0-D01 | Deterministic workspace-bound billing/webhook closure not fully evidenced in live canary lifecycle | Iris | Elena | OPEN | 17:30 gate | `openplan/docs/ops/2026-03-01-test-output/2026-03-01-p0-billing-live-canary-monitor.log`<br>`openplan/docs/ops/2026-03-01-test-output/2026-03-01-p0-billing-workspace-mutation-check.log`<br>`openplan/docs/ops/2026-03-01-engineering-p0-burn-plan.md` |
| P0-D02 | Explicit auth guard coverage gap on critical API routes (`report`, `runs`) | Iris | Owen | OPEN | 13:00 sweep | `openplan/docs/ops/2026-03-01-test-output/2026-03-01-p0-api-auth-coverage-scan.log`<br>`openplan/docs/ops/2026-03-01-engineering-p0-burn-plan.md` |
| P0-D03 | Core planner E2E evidence artifact not yet posted | Iris + Owen | Mateo | OPEN | 13:00 sweep | `openplan/docs/ops/2026-03-01-pilot-acceptance-criteria.md`<br>`openplan/docs/ops/2026-03-01-ship-evidence-index.md` |
| P0-D04 | Grant-lab E2E evidence artifact not yet posted | Iris + Owen + Camila | Mateo | OPEN | 17:30 gate | `openplan/docs/ops/2026-03-01-openplan-qa-qc-rhythm.md`<br>`openplan/docs/ops/2026-03-01-ship-evidence-index.md` |
| P0-D05 | Post-purchase “what happens next” UX clarity proof not yet linked to implementation artifact | Camila + Iris | Mateo | OPEN | 13:00 sweep | `openplan/docs/ops/2026-03-01-critical-ux-risk-audit.md`<br>`agents/team/urban-design-expert/reports/product_checkout_messaging_clear_safe_conversion_v1.md` |
| P0-D06 | Payment/activation safe-error messaging proof not yet linked to implemented state | Camila + Iris | Mateo | OPEN | 13:00 sweep | `openplan/docs/ops/2026-03-01-critical-ux-risk-audit.md`<br>`agents/team/urban-design-expert/reports/product_checkout_messaging_clear_safe_conversion_v1.md` |

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
