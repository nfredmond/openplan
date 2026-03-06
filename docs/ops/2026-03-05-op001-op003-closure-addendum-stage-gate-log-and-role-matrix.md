# OP-001 / OP-003 Closure Addendum — Role Matrix Hardening + Stage-Gate Decision Log Queryability

Date (PT): 2026-03-05 23:56  
Branch: `ship/phase1-core`  
Owner: Iris Chen (expert-programmer)

## Scope completed in this addendum

1. **OP-001 role-matrix hardening (API-side deny-by-default)**
   - Added canonical matrix utility:
     - `openplan/src/lib/auth/role-matrix.ts`
   - Applied matrix checks in runtime routes:
     - `openplan/src/app/api/analysis/route.ts`
     - `openplan/src/app/api/report/route.ts`
     - `openplan/src/app/api/runs/route.ts`
     - `openplan/src/app/api/billing/checkout/route.ts`
   - Added criterion-level role proof tests:
     - `openplan/src/test/op001-role-matrix-conformance.test.ts`
     - `openplan/src/test/runs-route-auth.test.ts` (unsupported-role deny paths)
     - `openplan/src/test/stage-gate-decisions-route.test.ts` (unsupported-role deny path)

2. **OP-003 gate decision persistence + query endpoint**
   - Added persisted decision log schema + RLS:
     - `openplan/supabase/migrations/20260306000010_op003_stage_gate_decision_log.sql`
   - Extended report gate to persist each PASS/HOLD decision with rationale + missing artifacts:
     - `openplan/src/app/api/report/route.ts`
   - Added query endpoint for decision history:
     - `openplan/src/app/api/stage-gates/decisions/route.ts`
   - Added route tests for persistence and queryability:
     - `openplan/src/test/report-route.test.ts`
     - `openplan/src/test/stage-gate-decisions-route.test.ts`

## Validation evidence

- Full gate run (lint + tests + build):
  - `docs/ops/2026-03-05-test-output/2026-03-05-2359-op001-op003-closure-qa-gate.log`
- Gate run outcome:
  - Lint: PASS
  - Tests: PASS (`21 files`, `76 tests`)
  - Build: PASS (Next.js route map includes `/api/stage-gates/decisions`)

## Crosswalk effect

Updated `docs/ops/2026-03-05-op001-op003-acceptance-crosswalk.md` status summary:

- **PASS 5 / PARTIAL 3 / MISSING 0**

Residual PARTIAL criteria after this addendum:
1. OP-001 role matrix criterion: UI-surface conformance proof set not yet published.
2. OP-001 audit criterion: queryable proof set for auth/role/config lanes still incomplete.
3. OP-003 template-selection criterion: canonical project-create binding still deferred (current binding remains workspace bootstrap interim).
