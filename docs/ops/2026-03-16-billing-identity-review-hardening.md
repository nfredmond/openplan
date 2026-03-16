# OpenPlan Ops Note — Billing Identity Review Hardening

**Date:** 2026-03-16  
**Owner:** Bartholomew Hale / engineering lane  
**Status:** PASS — compact billing/auth closure slice shipped locally

## Chosen Slice
Close the historical **purchaser-email mismatch** gap in the billing lane by preventing silent auto-activation when Stripe checkout completes under a different purchaser email than the signed-in owner/admin who initiated checkout.

This was the cleanest next compact move because the old paid-access QA gate still carried a HOLD on this exact case, and the rebuilt app posture still lacked an explicit deterministic control for it.

## What Changed
### 1) Checkout metadata now carries the initiating operator email
OpenPlan now stores the normalized initiating owner/admin email in Stripe checkout metadata so the webhook layer can compare who started checkout versus who actually completed payment.

Updated:
- `openplan/src/lib/billing/checkout.ts`
- `openplan/src/test/billing-checkout.test.ts`

### 2) Stripe webhook now pauses activation for identity mismatch instead of silently granting access
When `checkout.session.completed` arrives and purchaser email differs from the initiating owner/admin email:
- workspace activation is **not** auto-applied
- the webhook receipt is marked ignored with explicit reason
- a billing event is recorded: `checkout_identity_review_required`
- the workspace can remain in `checkout_pending` pending manual ownership review

Updated:
- `openplan/src/lib/billing/webhook.ts`
- `openplan/src/app/api/billing/webhook/route.ts`
- `openplan/src/test/billing-webhook-utils.test.ts`
- `openplan/src/test/billing-webhook-route.test.ts`

### 3) Later Stripe subscription mutations are blocked while that mismatch review is still pending
If Stripe sends follow-on subscription events after the mismatch hold, OpenPlan now checks for a pending identity-review event while the workspace is still `checkout_pending` and blocks those mutations too.

That closes the main loophole where a later subscription webhook could otherwise have auto-activated access after the initial mismatch was noticed.

### 4) Billing UI now explains the hold clearly
The billing page now surfaces a specific operator-facing warning when checkout is paused for identity review, including the initiator email and purchaser email when present.

Updated:
- `openplan/src/app/(app)/billing/page.tsx`

## Why This Matters for Honest v1
This is not decorative polish. It materially improves pilot trust because it replaces a vague historical QA HOLD with an explicit product control:
- no silent entitlement grant on mismatched billing identity
- no ambiguous “why is access weird?” state
- no later Stripe event quietly bypassing the hold while workspace status is still pending
- operator-facing evidence is preserved in `billing_events`

In plain English: **a workspace now has to clear identity alignment before OpenPlan turns a completed payment into active access**.

## Validation
### Tests
Command run:
```bash
pnpm test -- src/test/billing-checkout.test.ts src/test/billing-webhook-utils.test.ts src/test/billing-webhook-route.test.ts
```
Observed result in current repo config: Vitest executed the full suite rather than only the named files.

Result:
- **50 test files passed**
- **228 tests passed**

Logged artifact:
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-identity-review-tests.log`

### Lint
```bash
pnpm lint
```
Result: **PASS**

Logged artifact:
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-identity-review-lint.log`

### Build
```bash
pnpm build
```
Result: **PASS**

Logged artifact:
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-identity-review-build.log`

## Remaining Blockers / Honest Limits
This does **not** finish the whole billing/auth lane.

Still open:
1. authenticated live production smoke/evidence for current billing posture
2. explicit failed-webhook replay/runbook closure
3. refreshed live commerce evidence packet against deployed app, not just local validation

## Bottom Line
This slice closes one of the last clearly documented red/hold items in the paid-access path without widening scope.

It helps OpenPlan v1 posture because it makes billing activation more trustworthy, more supportable, and more honest under real operator error conditions.