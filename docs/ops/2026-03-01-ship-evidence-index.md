# OpenPlan Ship Week Day 1 — Ship Evidence Index

**Date (PT):** 2026-03-01  
**Owner:** Mateo Ruiz (Assistant Planner)  
**Source matrix:** `openplan/docs/ops/2026-03-01-team-tasking-matrix.md`  
**Gate target:** 17:30 ship gate

---

## 1) Daily Evidence Pack Index (Required lanes)

| Required pack item | Current status | Evidence path(s) | Owner |
|---|---|---|---|
| Auth regression result | **PASS (test-level)** | `openplan/docs/ops/2026-03-01-test-output/2026-03-01-p0-auth-workspace-billing-vitest.log` | Iris |
| Workspace/role API guardrail checks | **MIXED** | `openplan/docs/ops/2026-03-01-test-output/2026-03-01-p0-api-auth-coverage-scan.log`<br>`openplan/docs/ops/2026-03-01-test-output/2026-03-01-p0-api-smoke-report.log`<br>`openplan/docs/ops/2026-03-01-engineering-p0-burn-plan.md` | Iris |
| Core planner E2E result | **MISSING evidence artifact** | Acceptance contract exists: `openplan/docs/ops/2026-03-01-pilot-acceptance-criteria.md`<br>Expected evidence drop (pending): `openplan/docs/ops/2026-03-01-test-output/` (planner run capture/log) | Owen + Iris |
| Grant-lab E2E result | **MISSING evidence artifact** | Cadence requirement reference: `openplan/docs/ops/2026-03-01-openplan-qa-qc-rhythm.md`<br>Expected evidence drop (pending): `openplan/docs/ops/2026-03-01-test-output/` (grant-lab run capture/log) | Owen + Iris + Camila |
| Billing/webhook reliability evidence | **MIXED / OPEN P0** | `openplan/docs/ops/2026-03-01-test-output/2026-03-01-p0-billing-workspace-mutation-check.log`<br>`openplan/docs/ops/2026-03-01-test-output/2026-03-01-p0-billing-live-canary-monitor.log`<br>`openplan/docs/ops/2026-03-01-engineering-p0-burn-plan.md`<br>`openplan/docs/ops/2026-02-28-team/23-cross-lane-status-lock-2026-02-28-1856pt.md` | Iris |
| Geospatial QA/trust gate (pilot-safe constraints) | **READY WITH CAVEATS** | `openplan/docs/ops/2026-03-01-geospatial-qa-gate.md` | Priya |
| Support fallback + entitlement delay scripts | **READY** | `openplan/docs/ops/2026-02-28-team/23-mateo-paid-access-onboarding-copy-and-fallback-v1.md` | Mateo |
| Principal governance cadence + gate rules | **READY** | `openplan/docs/ops/2026-03-01-principal-qa-assembly-plan.md` | Elena |
| Critical UX risk audit (ship-critical only) | **MISSING deliverable** | Expected file (pending): `openplan/docs/ops/2026-03-01-critical-ux-risk-audit.md` | Camila |

---

## 2) Ship-Board Traceability (P0 Must-Ship)

| Ship-board P0 item | Status @ Day 1 | Evidence path(s) |
|---|---|---|
| Auth/session regression suite passes | PASS (test-level) | `openplan/docs/ops/2026-03-01-test-output/2026-03-01-p0-auth-workspace-billing-vitest.log` |
| Workspace + role enforcement verified server-side | MIXED (coverage gaps remain) | `openplan/docs/ops/2026-03-01-test-output/2026-03-01-p0-api-auth-coverage-scan.log`<br>`openplan/docs/ops/2026-03-01-engineering-p0-burn-plan.md` |
| Core planner workflow E2E pass | NOT YET VERIFIED | `openplan/docs/ops/2026-03-01-pilot-acceptance-criteria.md` (criteria only; run evidence pending) |
| Grant-lab workflow E2E pass | NOT YET VERIFIED | `openplan/docs/ops/2026-03-01-openplan-qa-qc-rhythm.md` (requirement) + pending Day 1 run artifact |
| Billing checkout + webhook + cancel/refund canary evidence captured | MIXED (events observed, ingestion closure open) | `openplan/docs/ops/2026-03-01-test-output/2026-03-01-p0-billing-live-canary-monitor.log`<br>`openplan/docs/ops/2026-03-01-test-output/2026-03-01-p0-billing-workspace-mutation-check.log` |
| Production smoke + rollback checklist complete | PARTIAL | `openplan/docs/ops/2026-03-01-test-output/2026-03-01-p0-api-smoke-report.log` (rollback artifact pending) |

**Day 1 provisional posture:** **HOLD** until unresolved P0 blockers in Section 3 are closed or explicitly carried with approved mitigation.

---

## 3) 17:30 Gate — Unresolved Blocker Digest (Structure + Current Entries)

### 3.1 Digest structure (mandatory fields)
Use this table structure at gate time for every open blocker.

| Blocker ID | Severity | Blocker summary | Owner | Decision needed | Evidence path(s) | Mitigation in place | Exit criteria | ETA |
|---|---|---|---|---|---|---|---|---|
| B-XX | P0/P1/P2 | One-sentence blocker statement | Named owner | What must be approved/decided | File/log/screenshot/PR path | Current fallback | Exact condition to close | Time |

### 3.2 Current unresolved blockers (pre-17:30)

| Blocker ID | Severity | Blocker summary | Owner | Decision needed | Evidence path(s) | Mitigation in place | Exit criteria | ETA |
|---|---|---|---|---|---|---|---|---|
| B-01 | P0 | Live billing webhook ingestion closure not fully evidenced against Stripe canary lifecycle | Iris | Approve replay/verification sequence and final closure criteria | `openplan/docs/ops/2026-03-01-test-output/2026-03-01-p0-billing-live-canary-monitor.log`<br>`openplan/docs/ops/2026-03-01-engineering-p0-burn-plan.md` | Unit/idempotency tests pass; mutation check pass | Replayed events show matching `billing_webhook_receipts` + `billing_events` and correct workspace subscription state | Pending owner rerun |
| B-02 | P0 | Explicit route-level auth checks missing on `report` and `runs` APIs | Iris | Confirm patch + regression rerun before gate | `openplan/docs/ops/2026-03-01-test-output/2026-03-01-p0-api-auth-coverage-scan.log`<br>`openplan/docs/ops/2026-03-01-engineering-p0-burn-plan.md` | Partial protection in existing route patterns | Coverage scan no longer lists `report`/`runs` as missing auth + tests pass | Pending patch |
| B-03 | P0 | Core planner E2E run evidence not posted for Day 1 | Owen + Iris | Confirm test owner and artifact path now | `openplan/docs/ops/2026-03-01-pilot-acceptance-criteria.md` (criteria only) | Acceptance definitions prepared | Planner baseline run artifacts posted in `2026-03-01-test-output` and mapped to acceptance criteria | Pending run |
| B-04 | P0 | Grant-lab E2E run evidence not posted for Day 1 | Owen + Iris + Camila | Assign owner + capture method for required-fields/save-reload/output actions | `openplan/docs/ops/2026-03-01-openplan-qa-qc-rhythm.md` | Requirement acknowledged in cadence docs | Grant-lab E2E evidence posted and verified | Pending run |
| B-05 | P1 | Critical UX ship-risk audit file not yet published | Camila | Confirm if this becomes P0 due to trust/clarity findings | Expected path: `openplan/docs/ops/2026-03-01-critical-ux-risk-audit.md` | Prior contrast/readability guidance exists in 2026-02-28 lane docs | Day 1 audit file published with ship-relevant fixes only | Pending deliverable |

---

## 4) Evidence Path Conventions (for consistent gate hygiene)
1. Prefer immutable path + timestamped log files under:
   - `openplan/docs/ops/2026-03-01-test-output/`
2. For each PASS claim, include at least one of:
   - test log,
   - artifact screenshot/video,
   - commit/PR path,
   - production-like smoke output.
3. For each HOLD claim, include:
   - exact failing evidence path,
   - owner,
   - closure ETA,
   - mitigation note.

---

## 5) 17:30 Gate Ready-Check (quick checklist)
- [ ] All required evidence pack rows have current status + links.
- [ ] Every open P0 has owner + ETA + closure criteria.
- [ ] PASS/HOLD recommendation reflects unresolved P0 truthfully.
- [ ] Principal gate memo can copy blocker table without reformat.
