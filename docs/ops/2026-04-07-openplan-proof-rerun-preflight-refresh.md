# OpenPlan Proof Rerun Preflight Refresh — 2026-04-07

**Owner:** Bartholomew Hale  
**Scope:** fresh rerun of the supervised paid canary preflight against the canonical proof workspace  
**Workspace:** `819138b9-37dd-4643-8825-419742d6b407`  
**Workspace label from prior proof set:** `Proof Beta Post Promotion 2026-03-17T01-01-22-830Z`

## Why this rerun was done

The prior acceptance/proof lane failed before producing useful evidence because the subagent timed out and then fell through to a usage-limit failure. A fresh rerun was worth it to determine whether production proof is now actually runnable.

## What was rerun

Fresh production env was pulled:

```bash
vercel env pull /tmp/openplan.vercel.env --environment=production -y
```

Then the supervised canary preflight was rerun against the canonical workspace:

```bash
cd openplan
./scripts/openplan-supervised-paid-canary-preflight.sh \
  --workspace-id 819138b9-37dd-4643-8825-419742d6b407 \
  --env-file /tmp/openplan.vercel.env \
  --since-minutes 240 \
  --skip-env-pull
```

## Repo improvements landed during the rerun

To make the proof lane runnable from this machine, the following scripts were hardened to work without `jq`:

- `openplan/scripts/openplan-supervised-paid-canary-preflight.sh`
- `openplan/scripts/openplan-starter-canary-monitor.sh`

The preflight alias detector was also tightened so a Vercel-protected 401 with `_vercel_sso_nonce` is classified correctly as deployment protection rather than an ambiguous auth failure.

## Fresh findings

### What is now confirmed as good

- Production env snapshot can still be pulled successfully.
- Core env posture is present:
  - Stripe secret available
  - Starter price id available
  - public Supabase URL available
- Starter monthly live price is still valid:
  - `price_1T5JiYFRyHCgEytn6DLs0Vt2`
  - live
  - `$249/month`

### What is still blocking the proof lane

1. **Supabase service-role proof posture is still effectively unusable in the pulled env snapshot.**
   - The pulled env includes the key name, but the value is effectively blank/empty for proof use.
   - Result: workspace snapshot and monitor proof could not run.

2. **The canonical public alias is now clearly Vercel-protected.**
   - `https://openplan-natford.vercel.app/billing` returned `401`.
   - Response included `_vercel_sso_nonce`, which is consistent with Vercel deployment protection.
   - No bypass secret was supplied in this rerun, so browser-proof automation could not proceed.

3. **Stripe webhook target is still pointed at the old alias, not the canonical one.**
   - Fresh webhook evidence showed the enabled OpenPlan billing endpoint is:
     - `https://openplan-zeta.vercel.app/api/billing/webhook`
   - The rerun expected:
     - `https://openplan-natford.vercel.app/api/billing/webhook`
   - Therefore the canonical webhook endpoint check still fails.

## Evidence produced

Canonical fresh preflight packet:

- [preflight-summary.md](/home/narford/.openclaw/workspace/openplan/docs/ops/2026-04-06-test-output/20260407T032452Z-supervised-paid-canary-preflight/preflight-summary.md)
- [public-alias-headers.txt](/home/narford/.openclaw/workspace/openplan/docs/ops/2026-04-06-test-output/20260407T032452Z-supervised-paid-canary-preflight/public-alias-headers.txt)
- [public-alias-status.txt](/home/narford/.openclaw/workspace/openplan/docs/ops/2026-04-06-test-output/20260407T032452Z-supervised-paid-canary-preflight/public-alias-status.txt)
- [starter-price.json](/home/narford/.openclaw/workspace/openplan/docs/ops/2026-04-06-test-output/20260407T032452Z-supervised-paid-canary-preflight/starter-price.json)
- [webhook-endpoints.json](/home/narford/.openclaw/workspace/openplan/docs/ops/2026-04-06-test-output/20260407T032452Z-supervised-paid-canary-preflight/webhook-endpoints.json)

## Honest status after the fresh rerun

The proof lane did **not** close tonight, but it did produce a materially better truth state than before:

- the rerun no longer fails due to model timeout/usage noise,
- the production blockers are now freshly confirmed from live evidence,
- and the remaining holds are narrow, concrete, and operational:
  - restore a usable service-role key to the proof lane,
  - provide a legitimate Vercel protection bypass path or use an authenticated browser session,
  - repoint Stripe to `openplan-natford` if that is the true canonical alias.

## Update after the 2026-04-07 04:54 UTC rerun

A second fresh rerun was completed from this machine using the hardened script and a temporary local `vercel` wrapper that delegates to `npx vercel`, because the host shell did not have a standalone `vercel` binary on PATH.

Canonical evidence packet:
- `docs/ops/2026-04-06-test-output/20260407T045452Z-supervised-paid-canary-preflight/preflight-summary.md`

### What changed materially

The blocker set is now smaller than this note originally reported:

- `SUPABASE_SERVICE_ROLE_KEY` proof posture is now **READY**.
- production workspace snapshot capture is now **YES**.
- monitor snapshot capture is now **YES**.
- canonical Stripe webhook endpoint posture is now **YES** and matches `https://openplan-natford.vercel.app/api/billing/webhook`.

### What is still blocking the proof lane

Only one blocker remains from the latest rerun:

1. **Canonical alias/browser proof route is still blocked by Vercel deployment protection.**
   - `/billing` on `https://openplan-natford.vercel.app` returned `401`.
   - response still sets `_vercel_sso_nonce`, consistent with deployment protection.
   - no valid bypass secret was available in the pulled production env snapshot.

### Updated exact next step

Do this next, then rerun the same preflight before any money-moving canary:

1. Decide the browser proof mode:
   - supply `OPENPLAN_VERCEL_PROTECTION_BYPASS_SECRET`, or
   - run the canary from an intentionally authenticated browser session and document that posture in the packet.

At this point, the proof lane is no longer blocked by service-role posture or Stripe webhook targeting. It is blocked only by browser access to the protected canonical alias.

