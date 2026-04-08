# OpenPlan Supervised Paid Canary Preflight Summary

- Captured at: 2026-04-07 03:24:06 UTC
- Status: BLOCKED — operator action required
- Public alias: https://openplan-natford.vercel.app
- Canonical webhook URL: https://openplan-natford.vercel.app/api/billing/webhook
- Alias protection state: unknown
- Alias protection detail: Not yet checked
- Alias effective proof mode: none
- Workspace id: 819138b9-37dd-4643-8825-419742d6b407
- Workspace name: unknown
- Current workspace subscription status: unavailable
- Current workspace subscription plan: unavailable
- Starter price summary: price_1T5JiYFRyHCgEytn6DLs0Vt2	live	usd	249.0	month
- Starter price display: 249.0 usd/month
- Env file used: /tmp/openplan.vercel.env
- Evidence directory: /home/narford/.openclaw/workspace/openplan/docs/ops/2026-04-06-test-output/20260407T032405Z-supervised-paid-canary-preflight

## Preflight check status
1. Production env snapshot file loaded: YES
2. Required core env posture present (Stripe key, Starter price id, public Supabase URL): YES
3. Supabase service-role proof posture present: NO
4. Canonical alias/browser proof route reachable in current proof mode: NO
5. Starter price posture valid: YES
6. Canonical Stripe webhook endpoint posture valid: NO
7. Production workspace snapshot captured via Supabase service role: NO
8. Current monitor snapshot captured: NO

## Env posture details
- Env file present: YES
- Core env posture: READY
- Service-role proof posture: BLOCKED
- Current env blocker note: Missing SUPABASE_SERVICE_ROLE_KEY prevents service-role-backed workspace and monitor proof.

## Alias proof details
- Raw /billing status without bypass header: 401
- Protection posture: unknown
- Effective proof mode: none
- Detail: Not yet checked
- Supplied bypass secret: NO

## Exact operator route
- https://openplan-natford.vercel.app/billing?workspaceId=819138b9-37dd-4643-8825-419742d6b407

## Exact monitor command to run during the supervised canary
```bash
cd /home/narford/.openclaw/workspace/openplan/openplan
./scripts/openplan-starter-canary-monitor.sh --workspace-id 819138b9-37dd-4643-8825-419742d6b407 --since-minutes 240 --watch 15 --env-file /tmp/openplan.vercel.env
```

## Explicit blockers
- Missing SUPABASE_SERVICE_ROLE_KEY in /tmp/openplan.vercel.env (this is the current production-proof blocker for deeper reruns)
- Canonical alias returned HTTP 401 for /billing and did not clearly identify as Vercel protection
- Stripe does not show an enabled webhook endpoint at https://openplan-natford.vercel.app/api/billing/webhook with the required subscription events

## Evidence files generated
- /home/narford/.openclaw/workspace/openplan/docs/ops/2026-04-06-test-output/20260407T032405Z-supervised-paid-canary-preflight/public-alias-headers.txt
- /home/narford/.openclaw/workspace/openplan/docs/ops/2026-04-06-test-output/20260407T032405Z-supervised-paid-canary-preflight/public-alias-status.txt
- /home/narford/.openclaw/workspace/openplan/docs/ops/2026-04-06-test-output/20260407T032405Z-supervised-paid-canary-preflight/public-alias-bypass-headers.txt
- /home/narford/.openclaw/workspace/openplan/docs/ops/2026-04-06-test-output/20260407T032405Z-supervised-paid-canary-preflight/public-alias-bypass-status.txt
- /home/narford/.openclaw/workspace/openplan/docs/ops/2026-04-06-test-output/20260407T032405Z-supervised-paid-canary-preflight/starter-price.json
- /home/narford/.openclaw/workspace/openplan/docs/ops/2026-04-06-test-output/20260407T032405Z-supervised-paid-canary-preflight/webhook-endpoints.json
- /home/narford/.openclaw/workspace/openplan/docs/ops/2026-04-06-test-output/20260407T032405Z-supervised-paid-canary-preflight/workspace-preflight-snapshot.json
- /home/narford/.openclaw/workspace/openplan/docs/ops/2026-04-06-test-output/20260407T032405Z-supervised-paid-canary-preflight/monitor-snapshot.log

## Ready / abort guidance
- READY if blockers are empty, the workspace above is the intended dedicated canary workspace, and the operator identity is approved.
- ABORT or remediate first if any blocker remains. Most importantly: do not claim paid happy-path proof until the Supabase service-role snapshot and monitor evidence both exist.
- If the alias is Vercel-protected, either supply a valid bypass secret for automation or use an intentionally authenticated browser session and document that posture in the packet.
