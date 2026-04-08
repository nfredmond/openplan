# 2026-04-07 OpenPlan orphaned branch reconciliation

## Scope
Audit the known remote-only commits not reachable from current `main`, decide whether each commit was already absorbed, should be preserved manually, or should be intentionally skipped.

Current safety posture at audit start:
- branch backup present: `backup/consolidation-pre-merge-2026-04-07`
- working branch: `main`
- no history rewrite performed

## Outcome summary
- **Already absorbed / superseded in current main:** `6e3b2b5`, `feb5186`
- **Preserved onto main as low-risk docs/templates:** `44a4d7c`, `d7185fc`, `4b7e581`, `c48b94e`, `bb519a7`
- **Intentionally skipped:** `20f69a6`

## Commit-by-commit reconciliation

### `6e3b2b5` `feat(openplan): add stage-gate decision history API, role-matrix enforcement, and closure evidence pack`
**Status:** already absorbed, then expanded on `main`

Why:
- `openplan/src/app/api/stage-gates/decisions/route.ts` exists on `main`.
- `openplan/supabase/migrations/20260306000010_op003_stage_gate_decision_log.sql` exists on `main`.
- stage-gate docs/test artifacts from this commit already exist on `main`.
- `openplan/src/lib/auth/role-matrix.ts` on `main` is a broader successor, with more actions covered than the orphaned branch version.

Decision:
- no cherry-pick needed
- treat branch commit as functionally merged/superseded

### `feb5186` `feat(models): re-port activitysim handoff proof lane`
**Status:** superseded, not ported directly

Why:
- the commit introduces an earlier app/API integration approach for ActivitySim handoff (`activitysim-handoff` route, orchestration helpers, worker wiring) that is absent from current `main`.
- current `main` has a later prototype posture instead of that direct API path:
  - `openplan/src/lib/models/run-modes.ts` exposes `behavioral_demand` as a prototype/preflight-backed lane, not a launchable production API path
  - later modeling docs on `main` preserve the replacement architecture and proof chain, including:
    - `docs/ops/2026-03-27-p2a3-activitysim-input-bundle-builder-prototype.md`
    - `docs/ops/2026-03-27-p2b1-activitysim-worker-runtime-prototype.md`
    - `docs/ops/2026-03-27-p2b2-activitysim-output-ingestion-prototype.md`
    - `docs/ops/2026-03-27-p2b4-behavioral-demand-prototype-orchestrator.md`
- direct cherry-pick would reintroduce a conflicting backend contract into a later planner-facing run-mode model.

Decision:
- do not cherry-pick
- if the older handoff route is ever wanted again, port it deliberately from the newer prototype chain rather than restoring this branch wholesale

### `44a4d7c` `docs(models): add Placer County salvage blocker memo`
**Status:** preserved onto `main`

Why:
- file was missing on `main`
- doc is low-risk historical/provenance material and does not alter runtime behavior

Preserved file:
- `docs/ops/2026-03-22-placer-county-salvage-blockers.md`

### `d7185fc` `docs(models): add Placer proof boundary and preservation plan`
**Status:** preserved onto `main`

Why:
- both docs were missing on `main`
- these are useful governance/provenance artifacts for understanding the proof-only Placer checkpoint

Preserved files:
- `docs/ops/2026-03-22-placer-proof-claim-boundary.md`
- `docs/ops/2026-03-22-placer-proof-preservation-plan.md`

### `20f69a6` `feat(models): preserve Placer proof checkpoint`
**Status:** intentionally skipped

Why:
- this commit is mostly county-local pilot scratch/runtime artifacts and exploratory scripts under `data/pilot-placer-county/`
- current `.gitignore` explicitly parks those assets as superseded local artifacts:
  - `data/pilot-placer-county/package/`
  - `data/pilot-placer-county/run_output/`
  - `data/pilot-placer-county/roads/`
  - `data/pilot-placer-county/tracts/`
  - `data/pilot-placer-county/build_network_package.py`
  - `data/pilot-placer-county/build_trip_tables.py`
  - `data/pilot-placer-county/step1_osm.py`
  - `data/pilot-placer-county/step2_assign.py`
- pulling that commit forward would fight the current repo policy and re-version data/scratch assets that `main` now intentionally treats as non-canonical.
- the governance docs from this lane are preserved separately via `44a4d7c` and `d7185fc`.

Decision:
- skip the data/runtime payload
- preserve only the missing docs from related commits

### `4b7e581` `docs(models): define Placer validation-ready gate`
**Status:** preserved onto `main`

Why:
- file was missing on `main`
- this is a useful stage-gate memo that complements the later Placer on-ramp docs without changing code

Preserved file:
- `docs/ops/2026-03-23-placer-validation-ready-gate.md`

### `c48b94e` `docs(models): add Placer count inventory mapping spec`
**Status:** preserved onto `main`

Why:
- doc and template were missing on `main`
- they are compatible with the later Placer validation on-ramp docs and provide stronger mapping discipline than the lighter starter scaffold alone

Preserved artifacts:
- `docs/ops/2026-03-24-placer-count-inventory-and-mapping-spec.md`
- `data/pilot-placer-county/validation/placer_count_inventory_template.csv`

### `bb519a7` `data(models): seed Placer Caltrans count inventory`
**Status:** preserved onto `main`

Why:
- this is a small tracked CSV refinement layered onto the count-inventory template, not a large ignored runtime package
- it complements `c48b94e` and fits current repo policy better than restoring the full Placer proof checkpoint commit

Preserved artifact:
- `data/pilot-placer-county/validation/placer_count_inventory_template.csv` (seeded Caltrans rows retained)

## Net recommendation
1. Keep the docs/template preservation commit.
2. Do **not** attempt to cherry-pick `20f69a6` or `feb5186` wholesale.
3. If behavioral-demand execution is revived, build from the 2026-03-27 prototype chain already on `main`, not the older salvage branch API surface.
4. If Placer proof reproducibility assets are needed later, recover them from the orphaned branch or local ignored files on demand, but keep them out of canonical tracked history unless repo policy changes.
