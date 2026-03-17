# OpenPlan Billing Chooser Production Promotion Proof — 2026-03-16

## Executive Summary
- **Production promotion:** **YES**
- **Promotion target confirmed before action:** `openplan-k6vgpbyy4-natford.vercel.app` remained the latest READY preview for commit `09d2eae` (`fix: require explicit billing workspace selection`).
- **Promotion result:** `vercel promote openplan-k6vgpbyy4-natford.vercel.app --scope natford --yes` created fresh production deployment `openplan-myhpkatuv-natford.vercel.app`.
- **Exact live result on public alias:** **PASS** — `https://openplan-zeta.vercel.app` now shows the billing workspace chooser behavior live.
- **v1 HOLD impact:** this closes the specific HOLD basis that the billing chooser fix was not yet proven on the public production alias due to deployment drift.

## Deployment State Before
- Public alias under prior evidence: `openplan-zeta.vercel.app`
- Prior production deployment behind alias: `openplan-h62835emk-natford.vercel.app`
- READY fix deployment not yet live before this lane: `openplan-k6vgpbyy4-natford.vercel.app`
- Commit on READY fix deployment: `09d2eaed5c0b365a77ca27bd0482315699ae64fc`
- Before-state evidence:
  - `docs/ops/2026-03-16-openplan-live-billing-chooser-verification.md`
  - `docs/ops/2026-03-16-test-output/2026-03-16-billing-chooser-vercel-state.json`

## Promotion Command / Result
Initial attempt failed because the local Vercel default scope was the wrong team:

```bash
vercel promote openplan-k6vgpbyy4-natford.vercel.app --yes
```

Error:
- `Error: Deployment doesn't belong to current team nat-ford-planning`

Successful command:

```bash
vercel promote openplan-k6vgpbyy4-natford.vercel.app --scope natford --yes
```

Observed result:
- Vercel created fresh production deployment `openplan-myhpkatuv-natford.vercel.app`
- Post-promotion `vercel list` shows `openplan-myhpkatuv-natford.vercel.app` as the newest **Production** deployment

Promotion evidence:
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-chooser-post-promotion-command.log`
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-chooser-post-promotion-vercel-state.json`

## Compact Live Verification on Public Alias
Base URL:
- `https://openplan-zeta.vercel.app`

Authenticated QA proof user:
- `openplan-billing-proof-post-promo-2026-03-17T01-01-22-830Z@natfordplanning.com`

Target workspaces created for the proof:
- Alpha: `Proof Alpha Post Promotion 2026-03-17T01-01-22-830Z` → `e8dde6b2-f296-4099-9f62-0f79552858e0`
- Beta: `Proof Beta Post Promotion 2026-03-17T01-01-22-830Z` → `819138b9-37dd-4643-8825-419742d6b407`
- Invalid/inaccessible probe: `11111111-2222-4333-8444-555555555555`

### Live Route Results
1. `/billing`
   - **PASS**
   - Rendered `Choose a workspace for billing`
   - Listed accessible workspaces instead of silently auto-selecting one

2. `/billing?workspaceId=e8dde6b2-f296-4099-9f62-0f79552858e0`
   - **PASS**
   - Rendered `Proof Alpha Post Promotion ... Billing`
   - Showed `Viewing workspace-specific billing`
   - Current workspace chip matched Alpha

3. `/billing?workspaceId=819138b9-37dd-4643-8825-419742d6b407`
   - **PASS**
   - Rendered `Proof Beta Post Promotion ... Billing`
   - Showed `Viewing workspace-specific billing`
   - Current workspace chip matched Beta

4. `/billing?workspaceId=11111111-2222-4333-8444-555555555555`
   - **PASS**
   - Returned chooser state
   - Displayed `The requested billing workspace was not found for this account.`

## Evidence Paths
Primary proof bundle:
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-chooser-prod-post-promotion-proof.json`

Screenshots:
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-chooser-prod-post-promotion-plain-billing.png`
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-chooser-prod-post-promotion-alpha-target.png`
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-chooser-prod-post-promotion-beta-target.png`
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-chooser-prod-post-promotion-inaccessible-target.png`

Deployment / command evidence:
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-chooser-post-promotion-command.log`
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-chooser-post-promotion-vercel-state.json`

## Caveats / Remaining Blockers
- No blocker remains for the narrow billing-chooser-live-on-production question.
- The QA proof account surfaced more than two accessible workspaces because OpenPlan also presents the account's existing provisioned workspace; this does **not** weaken the result. It strengthens the proof that plain `/billing` now requires explicit choice when multiple memberships exist.
- This lane did **not** retest broader billing flows beyond the chooser-selection contract.

## Bottom Line
The READY billing chooser fix is now **live on `https://openplan-zeta.vercel.app` and behaving correctly**. The public alias no longer fails this lane because of stale deployment state, so this specific v1 HOLD basis is closed.