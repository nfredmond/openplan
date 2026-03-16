# OpenPlan Production Alias Promotion Closure — 2026-03-16

**Owner:** Bartholomew Hale / engineering lane  
**Status:** PASS WITH NARROW REMAINING GAP — public production alias was brought forward to the current `main` checkout, then re-smoked honestly on the live alias

## Chosen Slice
Close the exact deployment-state gap identified in the prior reconciliation note:
1. confirm whether `openplan-zeta.vercel.app` was still behind current shipped work,
2. align the public production alias to the current `origin/main` checkout,
3. rerun compact authenticated live smoke on the public alias,
4. record what is now truly proven versus what still has not been directly exercised.

This keeps scope tight to honest v1 closure rather than drifting into new feature work.

## Deployment State Before
### Repo / checkout truth
Checked from the repo root:
```bash
git rev-parse --short HEAD
git rev-parse --short origin/main
```
Result:
- `HEAD`: `113441a`
- `origin/main`: `113441a`

That confirmed the local deploy source matched remote `main` before promoting anything.

### Public production alias was still behind newer work
Checked before promotion:
```bash
vercel ls --yes
curl -I https://openplan-zeta.vercel.app/models
```

Observed before promotion:
- newest deployments were previews (`openplan-8xjmeeqf8-natford.vercel.app`, `openplan-3302qac77-natford.vercel.app`, etc.)
- newest production deployment in the list was still the older `openplan-pzm9wu6e0-natford.vercel.app` at ~12h old
- public alias route check still returned:
  - `HTTP/2 307`
  - `location: /sign-in?redirect=%2Fmodels`

So the public alias was alive and preserving redirect continuity, but it was not yet aligned to the freshest shipped state.

## Promotion / Alignment Work Performed
### Local build check
Ran a fresh build against the current checkout:
```bash
npm run build
```
Result: **passed**.

### Production deployment
First attempt from the app subdirectory failed because the Vercel project is configured with `openplan/` as its root directory; deploying from that subdirectory double-applied the path. The successful production deployment was run from the repo root:
```bash
vercel deploy --prod --yes
```
Result:
- new production deployment: `https://openplan-h62835emk-natford.vercel.app`
- Vercel output explicitly reported:
  - `Production: https://openplan-h62835emk-natford.vercel.app`
  - `Aliased: https://openplan-zeta.vercel.app`

## Deployment State After
Checked after promotion:
```bash
vercel ls --yes
curl -I https://openplan-zeta.vercel.app/models
```

Observed after promotion:
- `vercel ls --yes` now shows `openplan-h62835emk-natford.vercel.app` as the newest **Production** deployment at the top of the list
- `curl -I https://openplan-zeta.vercel.app/models` still returns:
  - `HTTP/2 307`
  - `location: /sign-in?redirect=%2Fmodels`

That is the honest post-promotion alias truth state: the public alias now sits on a fresh production deployment and still preserves protected-route redirect continuity.

## Authenticated Live Smoke on the Public Alias
Because a reusable shell-driven Playwright harness already existed in the repo, authenticated smoke was possible without a separate browser-control lane.

Command used:
```bash
cd qa-harness
node openplan-prod-auth-smoke.js
```

Base URL exercised by the harness:
- `https://openplan-zeta.vercel.app`

Report refreshed:
- `docs/ops/2026-03-16-openplan-production-authenticated-smoke.md`

Artifacts refreshed:
- `docs/ops/2026-03-16-test-output/2026-03-16-prod-auth-smoke-01-signed-out-redirect.png`
- `docs/ops/2026-03-16-test-output/2026-03-16-prod-auth-smoke-02-models-after-login.png`
- `docs/ops/2026-03-16-test-output/2026-03-16-prod-auth-smoke-03-projects-list.png`
- `docs/ops/2026-03-16-test-output/2026-03-16-prod-auth-smoke-04-models-list.png`
- `docs/ops/2026-03-16-test-output/2026-03-16-prod-auth-smoke-05-model-detail.png`
- `docs/ops/2026-03-16-test-output/2026-03-16-prod-auth-smoke-06-plan-detail.png`
- `docs/ops/2026-03-16-test-output/2026-03-16-prod-auth-smoke-07-program-detail.png`
- `docs/ops/2026-03-16-test-output/2026-03-16-prod-auth-smoke-08-billing.png`

### Compact live smoke results
PASS on the live public alias for:
- signed-out `/models` redirect continuity
- sign-in return-path back to `/models`
- authenticated creation of:
  - project/workspace
  - plan
  - model
  - program
- authenticated route/detail continuity on:
  - `/projects`
  - `/models`
  - `/models/[modelId]`
  - `/plans/[planId]`
  - `/programs/[programId]`
- authenticated `/billing` page load

Current smoke record IDs from this post-promotion run are in:
- `docs/ops/2026-03-16-openplan-production-authenticated-smoke.md`

## What Is Now Proven
1. **Public production alias drift is closed for this lane.**  
   `openplan-zeta.vercel.app` was explicitly re-aliased by Vercel to the fresh production deployment `openplan-h62835emk-natford.vercel.app`.

2. **Protected-route continuity is still real on the live alias after promotion.**  
   `/models` redirects signed-out users to `/sign-in?redirect=%2Fmodels` on the public production alias.

3. **Authenticated planning-domain continuity is live on the current public alias.**  
   A fresh authenticated smoke pass succeeded on live production for models, plans, programs, and the linked create-through-detail chain.

4. **Authenticated billing surface load is live on the current public alias.**  
   The billing page loaded successfully for a provisioned authenticated QA user after promotion.

## What Is Still Not Directly Proven
1. **The billing purchaser-identity mismatch hold path itself was not re-enacted end-to-end in this pass.**  
   This pass proves the current billing surface is live on the promoted alias, but it does not stage a real identity-mismatch checkout scenario and watch the exact hold branch fire.

2. **Edit continuity was not exercised in this compact rerun.**  
   The smoke covered create + list + detail continuity, which was the highest-value compact proof available in this lane, but not a separate edit mutation.

These are narrower gaps than the pre-promotion state; they do not change the key closure result that the public alias is no longer lagging behind the latest shipped work for this lane.

## Why This Advances Honest v1 Closure
Before this pass, the repo had real evidence that the app worked on production, but the newest shipped work was not honestly proven on the public alias because the alias lagged behind fresher deployments.

After this pass:
- the alias lag was actively closed,
- the public production alias was re-verified,
- compact authenticated smoke was rerun against the actual live alias,
- and the evidence trail now rests on the post-promotion deployment rather than optimistic inference from `main`.

That materially strengthens original-plan / v1 closure posture because the remaining discussion can now focus on narrower behavioral gaps instead of the larger deployment-state ambiguity.

## Bottom Line
**Pass:** the public production alias is now aligned to a fresh production deployment from current `main`, and a fresh authenticated live smoke pass succeeded on the live alias across models, plans, programs, linked create continuity, and billing page load.

**Remaining honest caveat:** this pass did not directly reenact the specific billing identity-mismatch checkout branch or a separate edit mutation flow.