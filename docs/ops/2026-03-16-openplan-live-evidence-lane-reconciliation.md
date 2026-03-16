# OpenPlan Live Evidence Lane Reconciliation — 2026-03-16

**Owner:** Bartholomew Hale / engineering lane  
**Status:** PARTIAL PASS — public production planning-domain evidence remains real; latest billing hardening is not yet truthfully proven on the public production alias

## Chosen Slice
Tighten the live-evidence lane by reconciling three truth surfaces into one honest status:
1. what is directly verified on the public production alias,
2. what the latest same-day authenticated smoke already proved for planning-domain + billing interiors,
3. whether the newest shipped commits are actually on the public production deployment.

This was the highest-leverage compact slice because the app already had real smoke evidence, but the remaining v1 risk was stale certainty: treating "shipped to main" as equivalent to "live on the public production alias."

## What Was Verified Live
### Public production alias is still up and preserving protected-route continuity
Checked live on the public alias:
- URL: `https://openplan-zeta.vercel.app/models`
- Command: `curl -I https://openplan-zeta.vercel.app/models`
- Result: **HTTP 307** with `location: /sign-in?redirect=%2Fmodels`

That confirms the current public production alias still preserves the protected-route redirect target for `/models`.

### Same-day authenticated interior smoke already exists for the public production alias
Existing same-day live evidence remains at:
- `docs/ops/2026-03-16-openplan-production-authenticated-smoke.md`

That smoke recorded live PASS results on the public alias for these exact routes/flows:
- signed-out `/models` → `/sign-in?redirect=%2Fmodels`
- sign-in return-path to `/models`
- authenticated creation via production API/session of:
  - project/workspace
  - plan
  - model
  - program
- authenticated list/detail continuity on:
  - `/projects`
  - `/models`
  - `/models/[modelId]`
  - `/plans/[planId]`
  - `/programs/[programId]`
- authenticated billing surface load on:
  - `/billing`

That remains the best direct public-production interior evidence in the repo today.

## What Was Verified About Current Deployment Posture
### Vercel deployment metadata shows the public alias is behind newer deploys
At check time, `vercel ls` in the linked project showed:
- multiple fresh **preview** deployments from the last ~45 minutes
- only older **production** deployments at roughly **12 hours** old

`vercel inspect openplan-zeta.vercel.app` resolved the public alias to:
- `openplan-pzm9wu6e0-natford.vercel.app`

That matters because the most recent shipped commits in scope here are newer than that production deploy window:
- `7a8c9a9` — provisioning cleanup hardening
- `518b342` — planning save rollback hardening
- `cdd2404` — billing purchaser-identity review hardening

## What Remains Unverified or Blocked
### Blocker 1 — newest shipped billing hardening is not yet proven on the public production alias
The current public alias evidence proves:
- planning-domain continuity is real on production
- billing page loads for an authenticated provisioned workspace on production

It does **not** yet prove that the newest billing identity-review hold (`cdd2404`) is live on the public production alias.

Why: the alias appears to still point at an older production deployment.

### Blocker 2 — fresh browser smoke on the newest preview deployment is blocked by Vercel auth
A one-off Playwright smoke attempt was made against the freshest preview deployment:
- `https://openplan-3302qac77-natford.vercel.app`

Observed behavior:
- request to `/models` redirected to Vercel login instead of OpenPlan sign-in
- result: no browser-authenticated route-by-route smoke could be completed for the newest preview without Vercel-authenticated browser state

Blocker log:
- `docs/ops/2026-03-16-test-output/2026-03-16-preview-smoke-blocked.log`

## Exact Routes / Flows Checked or Reconciled
### Directly checked live in this pass
- `GET https://openplan-zeta.vercel.app/models`
  - expected/observed: `307` → `/sign-in?redirect=%2Fmodels`

### Reconciled from same-day authenticated production evidence
- `/models` signed-out redirect continuity
- `/models` post-login landing
- `/projects`
- `/models`
- `/models/[modelId]`
- `/plans/[planId]`
- `/programs/[programId]`
- `/billing`
- authenticated API-backed create flow for project → plan → model → program

### Attempted but blocked in this pass
- `/models` on latest preview deployment `https://openplan-3302qac77-natford.vercel.app`
  - blocked by Vercel login gate before app auth flow

## Why This Advances Honest v1 Closure
This note narrows the remaining v1 ambiguity with evidence instead of vibes:
- it preserves the fact that public production planning-domain smoke is already real,
- it avoids falsely claiming the latest billing hardening is already live on production,
- it identifies the exact blocker as **deployment-state drift plus preview auth gating**, not an app regression,
- it gives the next clean closure move: **promote or otherwise expose the latest deployment to the public production alias, then rerun the authenticated smoke harness against that alias.**

## Bottom Line
**Truth state now:**
- public production alias still has real authenticated planning-domain + billing-page evidence,
- newest billing hardening is locally validated and shipped to `main`,
- but the latest live browser evidence cannot honestly be called current-production for that billing slice until the public alias is updated or a Vercel-authenticated browser lane is available.
