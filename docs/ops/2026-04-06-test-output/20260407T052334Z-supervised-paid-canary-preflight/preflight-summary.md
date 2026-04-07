# OpenPlan Supervised Paid Canary Preflight Summary

- Captured at: 2026-04-07 05:23:44 UTC
- Status: BLOCKED — operator action required
- Public alias: https://openplan-zeta.vercel.app
- Canonical webhook URL: https://openplan-zeta.vercel.app/api/billing/webhook
- Alias protection state: open
- Alias protection detail: Canonical alias returned HTTP 307 without needing a bypass secret.
- Alias effective proof mode: direct
- Workspace id: 3aba7677-1826-49ff-8df7-983fd78c7d3e
- Workspace name: Prod QA Project 4 2026-03-23T03-09-24-366Z
- Current workspace subscription status: checkout_pending
- Current workspace subscription plan: starter
- Starter price summary: price_1T5JiYFRyHCgEytn6DLs0Vt2	live	usd	249.0	month
- Starter price display: 249.0 usd/month
- Env file used: /tmp/openplan.vercel.env
- Evidence directory: /home/narford/.openclaw/workspace/openplan/docs/ops/2026-04-06-test-output/20260407T052334Z-supervised-paid-canary-preflight

## Preflight check status
1. Production env snapshot file loaded: YES
2. Required core env posture present (Stripe key, Starter price id, public Supabase URL): YES
3. Supabase service-role proof posture present: YES
4. Canonical alias/browser proof route reachable in current proof mode: YES
5. Starter price posture valid: YES
6. Canonical Stripe webhook endpoint posture valid: NO
7. Production workspace snapshot captured via Supabase service role: YES
8. Current monitor snapshot captured: YES

## Env posture details
- Env file present: YES
- Core env posture: READY
- Service-role proof posture: READY
- Current env blocker note: None

## Alias proof details
- Raw /billing status without bypass header: 307
- Protection posture: open
- Effective proof mode: direct
- Detail: Canonical alias returned HTTP 307 without needing a bypass secret.
- Supplied bypass secret: NO

## Exact operator route
- https://openplan-zeta.vercel.app/billing?workspaceId=3aba7677-1826-49ff-8df7-983fd78c7d3e

## Exact monitor command to run during the supervised canary
```bash
cd /home/narford/.openclaw/workspace/openplan/openplan
./scripts/openplan-starter-canary-monitor.sh --workspace-id 3aba7677-1826-49ff-8df7-983fd78c7d3e --since-minutes 240 --watch 15 --env-file /tmp/openplan.vercel.env
```

## Explicit blockers
- Stripe does not show an enabled webhook endpoint at https://openplan-zeta.vercel.app/api/billing/webhook with the required subscription events

## Evidence files generated
- /home/narford/.openclaw/workspace/openplan/docs/ops/2026-04-06-test-output/20260407T052334Z-supervised-paid-canary-preflight/public-alias-headers.txt
- /home/narford/.openclaw/workspace/openplan/docs/ops/2026-04-06-test-output/20260407T052334Z-supervised-paid-canary-preflight/public-alias-status.txt
- /home/narford/.openclaw/workspace/openplan/docs/ops/2026-04-06-test-output/20260407T052334Z-supervised-paid-canary-preflight/public-alias-bypass-headers.txt
- /home/narford/.openclaw/workspace/openplan/docs/ops/2026-04-06-test-output/20260407T052334Z-supervised-paid-canary-preflight/public-alias-bypass-status.txt
- /home/narford/.openclaw/workspace/openplan/docs/ops/2026-04-06-test-output/20260407T052334Z-supervised-paid-canary-preflight/starter-price.json
- /home/narford/.openclaw/workspace/openplan/docs/ops/2026-04-06-test-output/20260407T052334Z-supervised-paid-canary-preflight/webhook-endpoints.json
- /home/narford/.openclaw/workspace/openplan/docs/ops/2026-04-06-test-output/20260407T052334Z-supervised-paid-canary-preflight/workspace-preflight-snapshot.json
- /home/narford/.openclaw/workspace/openplan/docs/ops/2026-04-06-test-output/20260407T052334Z-supervised-paid-canary-preflight/monitor-snapshot.log

## Ready / abort guidance
- READY if blockers are empty, the workspace above is the intended dedicated canary workspace, and the operator identity is approved.
- ABORT or remediate first if any blocker remains. Most importantly: do not claim paid happy-path proof until the Supabase service-role snapshot and monitor evidence both exist.
- If the alias is Vercel-protected, either supply a valid bypass secret for automation or use an intentionally authenticated browser session and document that posture in the packet.
