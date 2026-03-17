# OpenPlan Supervised Paid Canary Preflight Summary

- Captured at: 2026-03-17 04:17:16 UTC
- Public alias: https://openplan-zeta.vercel.app
- Workspace id: 819138b9-37dd-4643-8825-419742d6b407
- Workspace name: Proof Beta Post Promotion 2026-03-17T01-01-22-830Z
- Current workspace subscription status: checkout_pending
- Current workspace subscription plan: starter
- Starter price summary: price_1T5JiYFRyHCgEytn6DLs0Vt2	live	usd	249	month
- Starter price display: 249 usd/month
- Env file used: /tmp/openplan.vercel.env
- Evidence directory: /home/nathaniel/.openclaw/workspace/openplan/docs/ops/2026-03-16-test-output/20260317T041755Z-supervised-paid-canary-preflight

## Preflight checks completed
1. Pulled/loaded production env snapshot.
2. Confirmed public alias responds and the /billing route redirects through the live app.
3. Confirmed Starter price is live, active, recurring monthly, and non-zero.
4. Confirmed Stripe webhook endpoint exists at https://openplan-zeta.vercel.app/api/billing/webhook with the required billing events enabled.
5. Captured current workspace snapshot and recent billing events from production Supabase.
6. Captured a current monitor snapshot for this workspace.

## Exact operator route
- https://openplan-zeta.vercel.app/billing?workspaceId=819138b9-37dd-4643-8825-419742d6b407

## Exact monitor command to run during the supervised canary
```bash
cd /home/nathaniel/.openclaw/workspace/openplan/openplan
./scripts/openplan-starter-canary-monitor.sh --workspace-id 819138b9-37dd-4643-8825-419742d6b407 --since-minutes 180 --watch 15 --env-file /tmp/openplan.vercel.env
```

## Evidence files generated
- /home/nathaniel/.openclaw/workspace/openplan/docs/ops/2026-03-16-test-output/20260317T041755Z-supervised-paid-canary-preflight/public-alias-headers.txt
- /home/nathaniel/.openclaw/workspace/openplan/docs/ops/2026-03-16-test-output/20260317T041755Z-supervised-paid-canary-preflight/public-alias-status.txt
- /home/nathaniel/.openclaw/workspace/openplan/docs/ops/2026-03-16-test-output/20260317T041755Z-supervised-paid-canary-preflight/starter-price.json
- /home/nathaniel/.openclaw/workspace/openplan/docs/ops/2026-03-16-test-output/20260317T041755Z-supervised-paid-canary-preflight/webhook-endpoints.json
- /home/nathaniel/.openclaw/workspace/openplan/docs/ops/2026-03-16-test-output/20260317T041755Z-supervised-paid-canary-preflight/workspace-preflight-snapshot.json
- /home/nathaniel/.openclaw/workspace/openplan/docs/ops/2026-03-16-test-output/20260317T041755Z-supervised-paid-canary-preflight/monitor-snapshot.log

## Ready / abort guidance
- READY if the workspace shown above is the intended dedicated canary workspace and the operator identity is approved.
- ABORT if the workspace is wrong, the price posture changes unexpectedly, or the live alias no longer behaves as expected.
