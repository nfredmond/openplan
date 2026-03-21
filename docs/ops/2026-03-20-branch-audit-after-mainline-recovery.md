# OpenPlan branch audit after mainline recovery

**Date (PT):** 2026-03-20
**Reviewer:** Bartholomew Hale
**Purpose:** verify whether any meaningful OpenPlan work remains stranded outside `main` after the production-branch correction (`master` -> `main`) and the `ship/phase1-core` consolidation pass.

## Executive summary

Current conclusion:
1. **`main` is now the canonical code line and production source.**
2. **No active product-critical code branch remains outside `main`.**
3. The only branches with commits not in `main` are:
   - `chore/planos-hold`
   - `origin/ship/phase1-core`
4. Both are **non-blocking** for v1 shipping:
   - `chore/planos-hold` is an old branding experiment.
   - `origin/ship/phase1-core` is a remote-only residual closure-evidence commit whose code paths are already superseded by current `main`.

## Branch-by-branch status

### Fully merged into `main`
- `camila-explore-polish-20260314`
- `camila-ui-polish-20260314`
- `integration/2026-03-20-main-cleanup`
- `ship/phase1-core`

Interpretation: these do **not** hold unique work that is missing from `main`.

### Not merged into `main` (local)
#### `chore/planos-hold`
- unique commits not in `main`: **1**
- tip: `5c25f95 feat(brand): position OpenPlan as powered by PlanOS`

Assessment:
- This is a **branding/naming** experiment, not a product-functionality branch.
- It changes public copy/layout language around "PlanOS" and adds two supporting brand notes.
- Recommendation: **keep unmerged / do not fold into v1 by default** unless Nathaniel intentionally revives the PlanOS positioning.

### Not merged into `main` (remote)
#### `origin/ship/phase1-core`
- unique commits not in `main`: **1**
- tip: `6e3b2b5 feat(openplan): add stage-gate decision history API, role-matrix enforcement, and closure evidence pack`

Assessment:
- This is a **remote-only residual tip** from the March 5/6 OP-001 / OP-003 closure lane.
- The commit contains older closure-pack material plus older versions of:
  - role-matrix enforcement
  - stage-gate decision-history route/tests
  - report/runs/auth touches
  - stage-gate migration
- Those capabilities already exist on current `main`, and later work materially supersedes the old versions.
- The residual value is mainly **historical evidence artifacts**, not missing product code.

Recommendation:
- Treat `origin/ship/phase1-core` as **archive-only residual history**, not a live delivery lane.
- Safe to delete later after Nathaniel confirms no desire to preserve the remote branch name for posterity.

## Default-branch / deploy posture

Verified current target state:
- GitHub working line: `main`
- Vercel production branch: `main`
- Direct-to-main policy restored

## Final recommendation

1. Treat `main` as the only live shipping lane.
2. Do **not** merge `chore/planos-hold` unless branding strategy intentionally changes.
3. Treat `origin/ship/phase1-core` as archived residual history; no urgent salvage action required.
4. If cleanup is desired later, delete/archive stale branches after explicit human approval.
