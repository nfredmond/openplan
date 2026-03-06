# OP-001 / OP-003 Acceptance Crosswalk — 2026-03-05

Date (PT): 2026-03-05 19:00  
Branch: `ship/phase1-core`  
Owner: Iris Chen (expert-programmer)

Purpose: map each Phase-1 acceptance criterion (OP-001 + OP-003) to exact current-cycle evidence (tests + runtime/API artifacts) with explicit closure status.

Legend: **PASS** = criterion evidenced for current cycle; **PARTIAL** = meaningful evidence exists but criterion is not fully satisfied; **MISSING** = required evidence not present.

## OP-001 — Identity, Tenancy, and Security Baseline

| Criterion | Test evidence (exact paths) | Runtime/API evidence (exact paths) | Status | Notes / remaining gap |
|---|---|---|---|---|
| Tenant data isolation enforced server-side and DB-side (RLS) for protected entities. | `openplan/supabase/migrations/20260219000002_workspace_schema.sql` (RLS + policies for `workspaces`, `workspace_members`, `analyses`)  <br>`openplan/supabase/migrations/20260224000001_runs_schema.sql` (RLS + policies for `runs`)  <br>`openplan/src/test/runs-route-auth.test.ts` (401/403/200 membership enforcement paths)  <br>`docs/ops/2026-03-05-test-output/2026-03-05-1859-phase1-core-qa-gate-post-proof.log` (suite pass) | `docs/ops/2026-03-05-test-output/2026-03-05-1859-phase1-core-qa-gate-post-proof.log` | **PASS** | DB-side and API-side tenancy controls are evidenced in migrations + passing tests for current cycle. |
| Role matrix applied to API and UI actions with deny-by-default behavior. | `openplan/src/test/billing-checkout-route.test.ts` (member denied; owner/admin required)  <br>`openplan/src/test/middleware.test.ts` (unauthenticated dashboard redirect)  <br>`openplan/src/test/runs-route-auth.test.ts` (unauthorized/forbidden branches)  <br>`docs/ops/2026-03-05-test-output/2026-03-05-1859-phase1-core-qa-gate-post-proof.log` | `docs/ops/2026-03-05-test-output/2026-03-05-1859-phase1-core-qa-gate-post-proof.log` | **PARTIAL** | Deny-by-default behavior is proven on covered routes, but a full UI/API role-matrix conformance set is not yet published. |
| Audit log entries generated for auth, role, and critical config changes. | `openplan/src/app/api/runs/route.ts` (audit events around authz + run actions)  <br>`openplan/src/app/api/workspaces/bootstrap/route.ts` (bootstrap + template binding audit events)  <br>`openplan/src/test/audit-logger.test.ts` (sanitization guard)  <br>`docs/ops/2026-03-05-test-output/2026-03-05-1859-phase1-core-qa-gate-post-proof.log` | `docs/ops/2026-03-05-test-output/2026-03-05-1859-phase1-core-qa-gate-post-proof.log` | **PARTIAL** | Audit hooks are present and exercised, but a dedicated proof set for auth + role-change + critical-config event queryability is still incomplete. |
| Regression test: signup -> tenant create -> invite -> role update passes. | `openplan/src/test/op001-signup-invite-role-lifecycle.test.ts` (explicit lifecycle regression flow)  <br>`openplan/src/test/workspaces-bootstrap-route.test.ts` (bootstrap correctness)  <br>`openplan/src/test/billing-checkout-route.test.ts` (authorization role gate) | `docs/ops/2026-03-05-test-output/2026-03-05-1859-op001-op003-targeted-proof.log`  <br>`docs/ops/2026-03-05-test-output/2026-03-05-1859-phase1-core-qa-gate-post-proof.log` | **PASS** | Criterion-level proof gap closed. Residual risk: Phase-1 still lacks a dedicated invite/role-update API route; lifecycle regression currently validates data-layer membership transitions plus route authorization behavior. |

## OP-003 — Stage-Gate Engine + California Template Scaffold

| Criterion | Test evidence (exact paths) | Runtime/API evidence (exact paths) | Status | Notes / remaining gap |
|---|---|---|---|---|
| Template-driven workflow can block gate advance when required artifacts are missing. | `openplan/src/lib/stage-gates/report-artifacts.ts`  <br>`openplan/src/test/report-artifacts-gate.test.ts` (PASS/HOLD artifact gate unit checks)  <br>`openplan/src/test/report-route.test.ts` (`409 HOLD` on missing artifacts)  <br>`docs/ops/2026-03-05-test-output/2026-03-05-1859-phase1-core-qa-gate-post-proof.log` | `docs/ops/2026-03-05-test-output/2026-03-05-1859-phase1-core-qa-gate-post-proof.log` | **PASS** | HOLD behavior and missing-artifact reporting are actively enforced and re-verified in current cycle. |
| Minimum CA template pack present and selectable at project creation. | `openplan/src/lib/stage-gates/templates/ca_stage_gates_v0.1.json`  <br>`openplan/src/lib/stage-gates/template-loader.ts`  <br>`openplan/src/test/stage-gate-template-loader.test.ts`  <br>`openplan/src/test/workspaces-bootstrap-route.test.ts` (default + explicit template selection)  <br>`openplan/supabase/migrations/20260305000009_op003_workspace_stage_gate_binding.sql` | `docs/ops/2026-03-05-test-output/2026-03-05-1859-op001-op003-targeted-proof.log` | **PARTIAL** | Template is present/selectable in **workspace bootstrap interim path**; canonical project-create binding remains deferred to v0.2. |
| Gate decision log (PASS/HOLD + rationale) persisted and queryable. | `openplan/src/app/api/report/route.ts` (emits `report_gate_decision`, captures decision + `missingArtifacts`)  <br>`openplan/src/test/report-route.test.ts` (HOLD + PASS response paths) | `docs/ops/2026-03-05-test-output/2026-03-05-1859-op001-op003-targeted-proof.log` | **PARTIAL** | Decision logging is emitted at runtime, but a dedicated persisted/query API for decision history is not yet evidenced. |
| Test: run project through two gates with one forced HOLD then PASS after evidence upload. | `openplan/src/test/op003-two-gate-hold-pass-workflow.test.ts` (explicit gate-1 and gate-2 HOLD->PASS progression over canonical template evidence states)  <br>`openplan/src/lib/stage-gates/templates/ca_stage_gates_v0.1.json` | `docs/ops/2026-03-05-test-output/2026-03-05-1859-op001-op003-targeted-proof.log`  <br>`docs/ops/2026-03-05-test-output/2026-03-05-1859-phase1-core-qa-gate-post-proof.log` | **PASS** | Criterion-level proof gap closed. Residual risk: proof is at template/workflow unit-test level; end-to-end persisted project gate history remains a separate v0.2 scope item. |

## Current-cycle conclusion (engineering evidence only)

- Dated evidence matrix requirement is satisfied.
- Previously missing criterion-level proofs are now posted and reproducible.
- Updated criterion status summary: **PASS 4 / PARTIAL 4 / MISSING 0**.
- Remaining risk concentration is in previously known PARTIAL criteria (not the two previously missing proof gaps).
