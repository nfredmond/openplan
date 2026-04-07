# OpenPlan Canonical Alias Protection Path Unblock — 2026-04-07

**Date:** 2026-04-07  
**Owner:** Bartholomew Hale (COO)  
**Status:** PARTIAL UNBLOCK  
**Purpose:** record the current truth after testing the canonical alias with an approved Vercel protection bypass path.

## Executive Summary

The canonical alias protection problem is now materially narrowed.

A supplied Vercel protection bypass path was tested against:
- `https://openplan-natford.vercel.app`

Result:
- raw `/billing` access without bypass returned **401**,
- `/billing` with bypass returned **307 redirect to sign-in**,
- which is the expected browser-proof behavior for a protected but reachable authenticated route.

That means the canonical alias is no longer blocked by unknown protection posture.

## What this proves

The current proof lane can now honestly say:

1. `openplan-natford` remains the canonical proof alias.
2. The alias is protected by Vercel deployment protection.
3. An approved bypass path exists and is sufficient to reach the normal authenticated redirect flow for `/billing`.

This is enough to treat the **protection-path question as operationally solved** for proof execution.

## What it does not prove

This test did **not** complete the supervised paid canary.

The preflight remained blocked for a different reason:
- the specific workspace id used in the rerun did not resolve in the current production workspace snapshot step.

The preflight summary recorded:
- browser proof route reachable in current proof mode: **YES**
- canonical Stripe webhook endpoint posture valid: **YES**
- production workspace snapshot captured: **NO**

So the remaining blocker is now **workspace selection / workspace validity**, not Vercel protection access.

## Evidence captured

Canonical preflight packet:
- `docs/ops/2026-04-07-test-output/20260407T200856Z-supervised-paid-canary-preflight/preflight-summary.md`

Key supporting files:
- `docs/ops/2026-04-07-test-output/20260407T200856Z-supervised-paid-canary-preflight/public-alias-status.txt`
- `docs/ops/2026-04-07-test-output/20260407T200856Z-supervised-paid-canary-preflight/public-alias-bypass-status.txt`

## Updated blocker list

### Resolved
- canonical alias protection path uncertainty

### Still active
- proof workspace id currently used for the canary rerun is stale, missing, or otherwise not available to the snapshot query

## Exact next step

Before rerunning the supervised paid canary:

1. identify the correct dedicated canary workspace id,
2. verify it resolves via the service-role workspace snapshot step,
3. rerun the preflight on `openplan-natford` using the existing protection bypass path,
4. then execute the canary.

## Decision consequence

The proof lane should **not** fall back to `openplan-zeta` for convenience.

The current honest state is better:
- canonical alias access is now proven workable,
- the blocker is now a concrete workspace-resolution issue,
- and the team can proceed with one clean target.

## Bottom line

The Vercel protection bypass path worked.

The next blocker is now operational and specific:
- **use the right canary workspace id, then rerun preflight on `openplan-natford`.**
