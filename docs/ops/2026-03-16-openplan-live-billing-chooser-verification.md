# OpenPlan Live Billing Workspace Chooser Verification — 2026-03-16

## Executive Summary
- **Result on current production alias:** **BLOCKED / NOT LIVE** for the new chooser behavior.
- The public production alias `https://openplan-zeta.vercel.app` is still serving an older production deployment that does **not** contain commit `09d2eae` (`fix: require explicit billing workspace selection`).
- A newer READY deployment for that fix exists at `https://openplan-k6vgpbyy4-natford.vercel.app`, but it is **not promoted to production** (`target: null`, branch alias only).
- Because the live alias is stale, the requested billing-chooser behavior does **not** pass on current production.

## Production Alias / Deploy State Checked
- **Production alias:** `openplan-zeta.vercel.app`
- **Current production deployment:** `openplan-h62835emk-natford.vercel.app`
- **Production deploy state:** `READY`
- **Production deploy created:** `2026-03-16T21:14:11.536Z` (`2026-03-16 14:14 PDT`)
- **Latest READY deploy containing the fix:** `openplan-k6vgpbyy4-natford.vercel.app`
- **Fix deploy commit:** `09d2eaed5c0b365a77ca27bd0482315699ae64fc`
- **Fix deploy message:** `fix: require explicit billing workspace selection`
- **Fix deploy READY at:** `2026-03-17T00:12:00.361Z` (`2026-03-16 17:12 PDT`)
- **Blocker:** latest fix deployment exists and is READY, but it has not been promoted to the production alias.

Evidence:
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-chooser-vercel-state.json`

## Exact Live Routes / Flows Verified
Using a fresh authenticated QA user with **two new workspaces** created on production:
- `Proof Alpha 2026-03-17T00-29-50-259Z` → `3ccf71b8-63ff-4eeb-97cf-421e5b4e092e`
- `Proof Beta 2026-03-17T00-29-50-259Z` → `531855e8-1e87-4dce-b89e-d6462008326f`

Routes checked on the **public production alias**:
1. `/billing`
2. `/billing?workspaceId=3ccf71b8-63ff-4eeb-97cf-421e5b4e092e`
3. `/billing?workspaceId=531855e8-1e87-4dce-b89e-d6462008326f`
4. `/billing?workspaceId=b2f70e11-84c1-4a97-80d5-2fcfb898138c` (existing inaccessible workspace UUID from earlier production QA evidence)

## Live Findings
### 1) Multi-workspace billing still silently auto-selects on current production
**Observed:** `PASS` as a blocker finding / `FAIL` versus intended new behavior.

On plain `/billing`, the live alias did **not** present the chooser. It rendered a single workspace billing page immediately.

### 2) Users are **not** prompted to choose a workspace on current production
**Observed:** `FAIL` on current production.

Expected new heading:
- `Choose a workspace for billing`

Actual live behavior:
- direct render of one workspace billing page
- no chooser list
- no explicit selection prompt
- no workspace-specific switcher banner

### 3) `/billing?workspaceId=<uuid>` does **not** target the intended accessible workspace on current production
**Observed:** `FAIL` on current production.

Both accessible workspace-targeted URLs rendered the **same** billing page instead of their intended workspace surfaces.

### 4) Invalid / inaccessible selection does **not** show the new invalid-selection warning on current production
**Observed:** `FAIL` on current production.

The inaccessible workspace URL also rendered the same billing page instead of:
- chooser state, and
- `The requested billing workspace was not found for this account.`

## Evidence Locations
Primary browser evidence:
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-chooser-prod-proof.json`
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-chooser-prod-plain-billing.png`
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-chooser-prod-alpha-target.png`
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-chooser-prod-beta-target.png`
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-chooser-prod-inaccessible-target.png`

Supporting deploy-state evidence:
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-chooser-vercel-state.json`

## Conclusion
The **current production alias does not yet prove the billing chooser fix** because it is still on an older deployment. The latest fix deployment is READY, but it is not the deployment behind `openplan-zeta.vercel.app`.

## Remaining Caveats / Next Step
- This lane confirms a **deployment-promotion blocker**, not a new code defect in the checked-in branch.
- I did **not** change application code.
- I did **not** rerun `pnpm test`, `pnpm lint`, or `pnpm build` because no code changes were made in this verification lane.
- **Next required action:** promote the READY fix deployment (`openplan-k6vgpbyy4-natford.vercel.app`) to production, then rerun the same compact authenticated smoke against the production alias.
