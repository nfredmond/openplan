# OpenPlan Ship Week Day 1 — Ship Evidence Index

**Date (PT):** 2026-03-01  
**Refresh checkpoint:** 22:20 PT (overnight governance sync)  
**Owner:** Mateo Ruiz (Assistant Planner)  
**Source matrix:** `openplan/docs/ops/2026-03-01-team-tasking-matrix.md`  
**Gate target:** Morning kickoff -> 09:00 scope gate

---

## 1) Gate Claims -> Concrete Proof Map

| Gate claim | Status | Concrete proof path(s) | Owner |
|---|---|---|---|
| Auth/session regression suite passes | **PROVED** | `openplan/docs/ops/2026-03-01-test-output/2026-03-01-p0-auth-workspace-billing-vitest.log` | Iris |
| Clean merge gate (`lint`,`test`,`build`) | **PROVED** | `openplan/docs/ops/2026-03-01-test-output/2026-03-01-1257-clean-gate-lint-test-build.log` | Iris |
| Workspace + role enforcement verified server-side | **PROVED (webhook route exception expected)** | `openplan/docs/ops/2026-03-01-test-output/2026-03-01-1202-p0-route-auth-membership-tests.log`<br>`openplan/docs/ops/2026-03-01-test-output/2026-03-01-1206-p0-api-auth-coverage-scan.log` | Iris |
| Core planner E2E pass in production-like env | **PARTIAL PROOF (artifact posted; production-like runtime proof still pending)** | `openplan/docs/ops/2026-03-01-test-output/2026-03-01-1615-core-planner-e2e.log`<br>`openplan/docs/ops/2026-03-01-test-output/2026-03-01-2220-evidence-presence-scan.log` | Owen + Iris |
| Grant-lab E2E pass | **MISSING PROOF** | `openplan/docs/ops/2026-03-01-test-output/2026-03-01-2220-evidence-presence-scan.log` (no grant-lab artifact found) | Owen + Iris + Camila |
| Billing checkout + webhook + cancel/refund lifecycle evidence | **PARTIAL PROOF (OPEN P0)** | `openplan/docs/ops/2026-03-01-test-output/2026-03-01-2049-b01-closure-bundle.log`<br>`openplan/docs/ops/2026-03-01-test-output/2026-03-01-2051-b01-workspace-revert.log`<br>`openplan/docs/ops/2026-03-01-test-output/2026-03-01-2219-b01-synthetic-lifecycle-proof.log`<br>`openplan/docs/ops/2026-03-01-b01-external-replay-blocker-mitigation.md` | Iris |
| Production smoke + rollback checklist complete | **PROVED** | `openplan/docs/ops/2026-03-01-test-output/2026-03-01-1257-clean-gate-lint-test-build.log`<br>`openplan/docs/ops/2026-03-01-openplan-rollback-checklist-day1.md` | Iris + Elena |
| Post-purchase next-step clarity implemented | **PARTIAL PROOF (runtime verification pending)** | `openplan/docs/ops/2026-03-01-test-output/2026-03-01-1622-b05-post-purchase-proof.log`<br>`openplan/docs/ops/2026-03-01-critical-ux-implementation-verification-checklist.md` | Camila + Iris |
| Payment/activation safe-error messaging implemented | **PARTIAL PROOF (runtime verification pending)** | `openplan/docs/ops/2026-03-01-test-output/2026-03-01-1620-b06-safe-error-route-tests.log`<br>`openplan/docs/ops/2026-03-01-critical-ux-implementation-verification-checklist.md` | Camila + Iris |

---

## 2) Unresolved Blocker Digest (owner / ETA / evidence)

| Blocker ID | Severity | Status | Owner | ETA | Evidence path(s) |
|---|---|---|---|---|---|
| B-01 (P0-D01) | P0 | **OPEN** (manual + synthetic lifecycle proved; real canary lineage replay still incomplete) | Iris | Morning gate +45–60 min replay window | `openplan/docs/ops/2026-03-01-test-output/2026-03-01-2049-b01-closure-bundle.log`<br>`openplan/docs/ops/2026-03-01-test-output/2026-03-01-2219-b01-synthetic-lifecycle-proof.log`<br>`openplan/docs/ops/2026-03-01-b01-external-replay-blocker-mitigation.md` |
| B-03 (P0-D03) | P0 | **OPEN** (core planner artifact exists but production-like runtime proof not yet linked) | Owen + Iris | Morning 09:00 gate | `openplan/docs/ops/2026-03-01-test-output/2026-03-01-1615-core-planner-e2e.log`<br>`openplan/docs/ops/2026-03-01-pilot-acceptance-criteria.md` |
| B-04 (P0-D04) | P0 | **OPEN** (grant-lab artifact missing) | Owen + Iris + Camila | Morning 09:00 gate | `openplan/docs/ops/2026-03-01-test-output/2026-03-01-2220-evidence-presence-scan.log`<br>`openplan/docs/ops/2026-03-01-openplan-qa-qc-rhythm.md` |
| B-05 (P0-D05) | P0 | **OPEN** (implementation extraction exists; runtime verification proof missing) | Camila + Iris | Morning 09:00 gate | `openplan/docs/ops/2026-03-01-test-output/2026-03-01-1622-b05-post-purchase-proof.log`<br>`openplan/docs/ops/2026-03-01-critical-ux-implementation-verification-checklist.md` |
| B-06 (P0-D06) | P0 | **OPEN** (route test proof exists; runtime verification proof missing) | Camila + Iris | Morning 09:00 gate | `openplan/docs/ops/2026-03-01-test-output/2026-03-01-1620-b06-safe-error-route-tests.log`<br>`openplan/docs/ops/2026-03-01-critical-ux-implementation-verification-checklist.md` |

### Recently closed
- **B-02 (P0-D02)** route-auth gap: closed with `1202` + `1206` logs.
- **B-07 (P0-D07)** rollback checklist proof: closed with rollback doc + clean gate log.

---

## 3) Missing-Proof List by Owner (overnight)

| Owner | Missing-proof items | Required proof to close |
|---|---|---|
| Iris | B-01 (primary), shared B-03/B-04/B-05/B-06 | Fresh real-event lifecycle replay bundle in active Stripe scope; linked runtime proofs for shared UX items |
| Owen | B-03, B-04 | Production-like core planner runtime proof; grant-lab E2E artifact |
| Camila | B-04, B-05, B-06 | Grant-lab E2E artifact; runtime screenshots/verification notes for P0 UX states |
| Elena | Governance linkage only (no open blocker ownership) | Principal morning gate memo references latest evidence index + defect table |

---

## 4) Governance Rules (hard no-bypass)
1. Any unresolved **P0** at gate time = **HOLD**.
2. No external-ready posture without Principal QA artifact linkage.
3. Every claim must include a concrete artifact/log path; missing proof is recorded as blocker.
