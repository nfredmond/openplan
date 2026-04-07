# OpenPlan Proof Rerun Target Refresh — 2026-04-06

Owner: Bartholomew Hale

## Executive summary
The previously documented proof workspace for the supervised paid canary rerun is no longer present in the current production `workspaces` table, so the original rerun target had become stale.

That meant the earlier rerun remained blocked for a **target-selection** reason even after the real configuration blockers were fixed.

I refreshed the target to a currently live QA workspace and reran preflight.

## What changed
### Prior stale target
- Workspace id: `819138b9-37dd-4643-8825-419742d6b407`
- Historical label: `Proof Beta Post Promotion 2026-03-17T01-01-22-830Z`
- Current status in production data: **not found**

### New active rerun target
- Workspace id: `3aba7677-1826-49ff-8df7-983fd78c7d3e`
- Workspace name: `Prod QA Project 4 2026-03-23T03-09-24-366Z`
- Subscription plan: `starter`
- Subscription status: `checkout_pending`
- Recent billing evidence present: `checkout_initialized`

## Fresh preflight result
Fresh preflight against the new workspace is now:

**READY FOR SUPERVISED EXECUTION**

Evidence directory:
- `docs/ops/2026-04-06-test-output/20260407T034022Z-supervised-paid-canary-preflight/`

Key result:
- env posture: ready
- service-role proof posture: ready
- alias reachability via bypass header: ready
- starter live price: valid
- canonical Stripe webhook endpoint: valid
- workspace snapshot: captured
- current monitor snapshot: captured
- explicit blockers: none

## Exact supervised canary route
- `https://openplan-natford.vercel.app/billing?workspaceId=3aba7677-1826-49ff-8df7-983fd78c7d3e`

## Exact monitor command
```bash
cd /home/narford/.openclaw/workspace/openplan/openplan
./scripts/openplan-starter-canary-monitor.sh --workspace-id 3aba7677-1826-49ff-8df7-983fd78c7d3e --since-minutes 240 --watch 15 --env-file /tmp/openplan.vercel.env
```

## Honest current status
The OpenPlan proof lane is now configuration-ready and target-ready.

What remains is the actual supervised money-moving checkout execution and the post-checkout webhook-proof verification pass.

## Practical next move
Run the supervised billing canary against the refreshed workspace target above, then immediately run the read-only webhook-proof checker and attach the resulting evidence packet.
