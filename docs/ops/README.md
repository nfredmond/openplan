# OpenPlan — docs/ops Index

**Last updated:** 2026-04-05
**Maintainer:** Mateo Ruiz (Assistant Planner — package-control lane)

---

## Start Here

| Document | What it is |
|---|---|
| [v1-command-board.md](2026-03-15-openplan-v1-command-board.md) | **Single-source status board** — GREEN / YELLOW / RED lanes |
| [v1-proof-packet.md](2026-03-16-openplan-v1-proof-packet.md) | **Evidence index** — internal pre-close review |
| [v1-status-memo.md](2026-03-17-openplan-v1-status-memo.md) | **Executive truth-state** — post-principal-adjudication |
| [launch-truth-adr](2026-04-05-openplan-launch-readiness-truth-memo.md) | **Canonical April 2026 launch boundary** — supervised pilot / no broad self-serve launch |
| [supervised pilot packet](2026-04-05-openplan-supervised-external-pilot-packet.md) | **External pilot packet** — scope, onboarding, support, AI, billing truth |
| [pricing-positioning decision](2026-04-05-openplan-pricing-positioning-decision-note.md) | **Canonical pricing/positioning note** — resolves public pricing drift |
| [frontend design constitution](2026-04-08-openplan-frontend-design-constitution.md) | **Canonical frontend anti-generic design rules** — worksurface, rails, low-card, low-pill UI posture |
| [frontend execution checklist](2026-04-08-openplan-frontend-execution-checklist.md) | **Practical screen-by-screen UI implementation checklist** — use during redesign and QA |
| [v1-internal-ship-gate.md](2026-03-16-openplan-v1-internal-ship-gate.md) | Internal ship gate checklist |
| [PRINCIPAL_QA_APPROVAL.md](PRINCIPAL_QA_APPROVAL.md) | **Canonical** Elena approval (2026-03-17) |

---

## By Category

### Governance & Decisions
- [PRINCIPAL_QA_APPROVAL.md](PRINCIPAL_QA_APPROVAL.md) — canonical principal approval
- [launch-truth-adr](2026-04-05-openplan-launch-readiness-truth-memo.md) — current April launch boundary / supervised pilot posture
- [supervised pilot packet](2026-04-05-openplan-supervised-external-pilot-packet.md) — external pilot scope and support path
- [pricing-positioning decision](2026-04-05-openplan-pricing-positioning-decision-note.md) — canonical pricing / positioning resolution
- [frontend design constitution](2026-04-08-openplan-frontend-design-constitution.md) — canonical anti-generic UI rules for OpenPlan frontend work
- [frontend execution checklist](2026-04-08-openplan-frontend-execution-checklist.md) — practical implementation and QA checklist for redesign slices
- [product-governance historian](2026-04-05-openplan-product-governance-historian-memo.md) — reconciled current-truth synthesis
- [proof ops runbook](2026-04-05-openplan-proof-ops-runbook.md) — proof lane, canary monitor, cleanup
- [multi-agent execution architecture](2026-04-05-openplan-multi-agent-execution-architecture.md) — lane orchestration and direct-to-main execution model
- [principal-gate-decision.md](2026-03-17-openplan-principal-gate-decision.md) — scoped approval
- [commercial-proof-waiver.md](2026-03-17-openplan-commercial-proof-waiver.md) — CEO paid-canary waiver
- [coo-verification.md](2026-03-16-openplan-v1-coo-verification.md) — COO verification
- [elena-review-packet.md](2026-03-16-openplan-v1-elena-review-packet.md) — Elena review packet
- [client-safe-positioning.md](2026-03-17-openplan-client-safe-positioning-note.md) — external language guardrails
- [branch-audit.md](2026-03-20-branch-audit-after-mainline-recovery.md) — mainline recovery audit

### Pilot Geography
- [nevada-county-decision.md](2026-03-19-pilot-geography-decision-nevada-county.md) — pilot geography + rationale

### Modeling Stack
- [technical-spec.md](2026-03-17-openplan-modeling-stack-technical-spec.md) — AequilibraE + ActivitySim + MATSIM
- [build-backlog.md](2026-03-17-openplan-modeling-stack-build-backlog-and-execution-plan.md) — execution plan
- [phase1-prd.md](2026-03-18-modeling-stack-phase1-artifacts-prd.md) — Phase 1 PRD
- [p1a1 network schema](2026-03-18-p1a1-canonical-network-package-schema.md) · [p1a2 zones](2026-03-18-p1a2-zone-corridor-connector-contract.md) · [p1a3 ingestion QA](2026-03-18-p1a3-ingestion-qa-pipeline.md)
- [p1b2 AequilibraE worker](2026-03-18-p1b2-aequilibrae-worker-prototype.md) · [p1b3 skim artifacts](2026-03-18-p1b3-skim-artifact-generation.md) · [p1b4 KPI extractors](2026-03-18-p1b4-assignment-accessibility-extractors.md)
- [p1c1 run mode UI](2026-03-18-p1c1-run-mode-surface-ui.md) · [p1c2 evidence packet](2026-03-18-p1c2-evidence-packet-output.md)
- [p2 ActivitySim spec](2026-03-19-p2-activitysim-synthetic-population-spec.md)
- [modeling-roadmap.md](2026-03-16-openplan-modeling-roadmap.md)
- [model-engine-options.md](2026-03-15-openplan-model-engine-options-note.md)

### Auth / Billing / Hardening
- [auth-proxy-closure.md](2026-03-16-openplan-auth-proxy-closure-bundle.md)
- [auth-access-evidence.md](2026-03-15-openplan-v1-auth-access-evidence.md)
- [billing-identity-review.md](2026-03-16-billing-identity-review-hardening.md)
- [provisioning-hardening.md](2026-03-16-v1-provisioning-hardening.md)
- [live-billing-hold-canary.md](2026-03-16-openplan-live-billing-hold-canary.md)
- [cancel-refund-closeout.md](2026-03-16-openplan-cancel-refund-operational-closeout.md)
- [billing-reliability-evidence.md](2026-03-15-openplan-v1-billing-reliability-evidence.md)
- [billing-chooser-verification.md](2026-03-16-openplan-live-billing-chooser-verification.md)

### Production Smoke Evidence
- `2026-03-17-test-output/` — **current canonical** (auth, engagement, managed-run, report-traceability screenshots + QA cleanup)
- `2026-03-16-test-output/` — prior cycle (auth, edit, billing hold canary, billing chooser)
- `2026-03-18-test-output/` — scenario comparison
- `2026-03-15-test-output/` — older auth + billing logs
- `2026-03-01-test-output/` — oldest cycle (historical baseline)

### Module Plans (Future)
- [reports-v1.md](2026-03-14-reports-v1-module-plan.md) · [engagement-v1.md](2026-03-14-engagement-v1-module-plan.md) · [scenarios-v1.md](2026-03-14-scenarios-v1-module-plan.md) · [plans-v1.md](2026-03-15-plans-v1-module-plan.md)
- [engagement-report-handoff (shipped)](2026-03-17-engagement-report-handoff-slice.md) · [report-traceability-backlink (shipped)](2026-03-17-report-traceability-backlink-slice.md)

### Package Control (this review)
- [inventory-and-handoff-checklist.md](2026-03-20-package-control-inventory-and-handoff-checklist.md) — full inventory + grouped checklist + gaps
- [dedup-stale-naming-log.md](2026-03-20-package-control-dedup-stale-naming-log.md) — superseded/canonical tags + naming fixes
- [cross-verification-report.md](2026-03-21-proof-packet-cross-verification-report.md) — disk verification of all proof-packet references

---

## File Counts
- Markdown docs in `docs/ops/`: **178**
- Test output files (PNG/JSON/log/txt): **132**
- Subdirectories: **14**
