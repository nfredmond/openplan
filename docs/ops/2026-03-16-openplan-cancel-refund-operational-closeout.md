# OpenPlan V1 — Cancel / Refund Operational Closeout

**Date:** 2026-03-16  
**Owner:** Bartholomew Hale / ops-engineering lane  
**Status:** CONDITIONAL PASS FOR HOLD NARROWING — operational posture is now explicit and materially tighter, but this pass did **not** perform a fresh real-money live cancel/refund cycle

## Executive Summary
The cancel/refund lane was not actually blank; it was **partly proved, partly stale, and partly undocumented**.

### What was already proven before this pass
- OpenPlan already had historical **live Stripe evidence** from the 2026-03-01 starter canary showing:
  - a real refunded live charge,
  - a real canceled live subscription,
  - matching OpenPlan workspace mutation / revert evidence in the B-01 closure bundle.
- OpenPlan code already maps `customer.subscription.deleted` into workspace status `canceled` through the Stripe webhook route.

### What was stale or missing
- The current 2026-03-16 packet did **not** include a fresh real-money cancel/refund execution.
- There was **no current-cycle cancel/refund closeout memo** spelling out exact operating procedure and evidence boundaries.
- Stripe checkout return URLs were still pointing at **`/dashboard/billing`**, while the real app surface is **`/billing`**. That was a real operational drift affecting cancel/success return handling.
- Refund handling remains mostly **Stripe-operational**, not first-class OpenPlan product state. OpenPlan tracks subscription mutation; it does **not** currently map `charge.refunded` into a separate internal refund ledger/state transition.

### What this pass did
1. Re-verified the historical live Stripe refund/cancel objects directly in Stripe.
2. Confirmed the app’s actual current billing route posture.
3. Fixed the stale Stripe checkout return URLs to land on the real `/billing` page with explicit `workspaceId`.
4. Added user-facing success/cancel return notices on the billing page.
5. Ran `pnpm test`, `pnpm lint`, and `pnpm build` successfully after the change.
6. Wrote this closeout so the remaining uncertainty is now commercial/governance judgment, not hidden operational ambiguity.

## Current Cancel / Refund Posture
### 1) Cancellation of an active paid subscription
**Posture:** technically supported and evidenced.

OpenPlan’s Stripe webhook handling maps:
- `checkout.session.completed` -> workspace activation,
- `customer.subscription.created` / `updated` -> workspace subscription updates,
- `customer.subscription.deleted` -> workspace status `canceled`.

Evidence in code:
- `openplan/src/lib/billing/webhook.ts`
- `openplan/src/app/api/billing/webhook/route.ts`

Operational meaning:
- the actual monetary cancellation happens in **Stripe**,
- OpenPlan reflects the resulting subscription status through webhook processing.

### 2) Refund of a paid charge
**Posture:** operationally supported in Stripe; not modeled as a first-class OpenPlan billing state.

Important truth:
- OpenPlan monitors `charge.refunded` in historical evidence tooling,
- but current webhook mutation logic does **not** map `charge.refunded` into a workspace-level refund state.

Operational meaning:
- refunds are performed and verified in **Stripe**,
- OpenPlan’s app-level posture should be treated as subscription/access state, not as the canonical refund ledger.

### 3) Checkout cancel before payment completion
**Posture:** operationally manageable, but still partially manual.

Current behavior:
- checkout initialization sets the workspace to `checkout_pending` before payment completion,
- if the user abandons or cancels Stripe checkout before payment, there is no Stripe subscription-delete event to automatically restore prior workspace state,
- therefore abandoned checkout cleanup remains an **operations procedure**, not a fully automated product flow.

### 4) Purchaser-identity mismatch hold
**Posture:** production-proven on 2026-03-16.

If checkout completes under a different purchaser email than the initiating workspace owner/admin email, OpenPlan now:
- keeps the workspace in `checkout_pending`,
- records `checkout_identity_review_required`,
- blocks follow-on subscription mutations while review is pending,
- shows an operator-facing warning on `/billing`.

Reference:
- `docs/ops/2026-03-16-openplan-live-billing-hold-canary.md`

## What Was Verified This Pass
### A) Historical live refund evidence was re-verified directly in Stripe
Using the current production Stripe environment, I re-checked the historical live canary objects already cited in the repo.

Verified objects:
- Charge: `ch_3T5z5pFRyHCgEytn0cBVoWFz`
  - `livemode: true`
  - `status: succeeded`
  - `refunded: true`
  - `amount: 9900`
  - `amount_refunded: 9900`
- Refund list for that charge:
  - refund `re_3T5z5pFRyHCgEytn04rCtnXa`
  - `amount: 9900`
  - `status: succeeded`
- Subscription: `sub_1T5z5rFRyHCgEytnshdcrLAi`
  - `livemode: true`
  - `status: canceled`
  - `cancel_at_period_end: false`

This matters because it converts the older 2026-03-01 memo from “claimed historical evidence” to “historical evidence re-checked during this pass.”

### B) Current-cycle live cancel/refund was **not** executed
I did **not** perform a fresh real-money paid checkout followed by refund/cancel in this pass.

Reason:
- current production billing runs against live recurring Stripe prices,
- a fresh end-to-end cancel/refund proof would require a real charge,
- that is not appropriate to perform casually inside this lane without explicit supervised commercial approval.

### C) Return-path drift was found and fixed
I confirmed the app currently builds a real `/billing` route, not `/dashboard/billing`.

Before this fix, checkout URLs in code still pointed to:
- `/dashboard/billing?checkout=success...`
- `/dashboard/billing?checkout=cancel...`

This pass changed them to:
- `/billing?workspaceId=<id>&checkout=success...`
- `/billing?workspaceId=<id>&checkout=cancel...`

Files updated:
- `openplan/src/lib/billing/checkout.ts`
- `openplan/src/app/(app)/billing/page.tsx`
- `openplan/src/test/billing-checkout.test.ts`

Why this matters operationally:
- success/cancel returns now land on the real billing surface,
- the exact workspace is preserved in multi-workspace accounts,
- operators now get explicit success/cancel context on the page they actually use.

### D) Validation gate passed after the fix
Commands run from `openplan/openplan`:
```bash
pnpm test
pnpm lint
pnpm build
```

Artifacts:
- `docs/ops/2026-03-16-test-output/2026-03-16-cancel-refund-closeout-tests.log`
- `docs/ops/2026-03-16-test-output/2026-03-16-cancel-refund-closeout-lint.log`
- `docs/ops/2026-03-16-test-output/2026-03-16-cancel-refund-closeout-build.log`

Observed results:
- tests: **50 files / 231 tests passed**
- lint: **completed cleanly**
- build: **passed**

## Evidence vs Assumption
### Evidence now in hand
1. Historical live Stripe refund/cancel objects still exist and were re-verified this pass.
2. OpenPlan webhook code really does process subscription deletion into workspace `canceled` state.
3. Refunds are presently handled operationally in Stripe rather than in a separate internal refund-state model.
4. Checkout return URLs were stale and are now corrected.
5. The corrected code passes test/lint/build.

### Still assumption or judgment
1. A **fresh current-cycle real-money cancel/refund event** was not executed.
2. No claim should be made that this pass proved the entire money-moving lifecycle again on 2026-03-16.
3. Cleanup of **abandoned pre-payment checkout** still depends on operator judgment about the correct baseline state to restore for that workspace.
4. Refund bookkeeping should still be treated as Stripe-source-of-truth rather than OpenPlan-source-of-truth.

## Exact Operational Procedure for Cancellation / Refund Handling

## Procedure A — Customer cancels or abandons checkout before payment completes
**Use when:** there is a `checkout_initialized` event, workspace shows `checkout_pending`, but no completed charge/subscription should be treated as live.

1. **Open the exact workspace billing surface**
   - Use `/billing?workspaceId=<workspace-id>`.
   - Confirm you are looking at the intended workspace.

2. **Check recent OpenPlan billing events**
   - Confirm `checkout_initialized` exists.
   - Confirm there is no valid activation event that should keep the workspace active.

3. **Check Stripe for actual money movement**
   - If there is no completed charge/subscription, treat this as an abandoned checkout, not a paid cancellation.

4. **Choose the correct cleanup action**
   - If the customer wants to continue: re-initiate checkout from `/billing`.
   - If the customer does not want to continue: restore the workspace to its prior safe state.

5. **Restore prior workspace state carefully**
   - Do **not** hardcode a generic reset value unless you know the prior baseline.
   - Use the workspace’s last known safe pre-checkout state as the source of truth.
   - In QA history, that baseline was often `plan=free`, `subscription_plan=null`, `subscription_status=pilot`, Stripe IDs null — but production operations should restore the real prior state, not blindly copy QA values.

6. **Record the closeout**
   - Note workspace id, operator, reason, whether money moved, and final restored status.

## Procedure B — Customer requests cancellation of an active paid subscription
**Use when:** the subscription exists and should stop renewing.

1. Capture the current identifiers:
   - workspace id
   - Stripe customer id
   - Stripe subscription id
   - current workspace subscription status

2. Cancel the Stripe subscription.
   - Dashboard path: Stripe -> Customer -> Subscription -> Cancel subscription
   - API equivalent:
   ```bash
   curl -sS https://api.stripe.com/v1/subscriptions/$SUBSCRIPTION_ID \
     -X DELETE \
     -H "Authorization: Bearer $OPENPLAN_STRIPE_SECRET_KEY"
   ```

3. Verify Stripe result:
   - subscription status becomes `canceled`
   - `customer.subscription.deleted` is present

4. Verify OpenPlan result:
   - `billing_webhook_receipts` shows the delete event as `processed`
   - workspace `subscription_status` becomes `canceled`
   - recent billing events show `webhook_billing_updated`

5. Save evidence:
   - Stripe event id
   - subscription id
   - workspace snapshot after mutation

## Procedure C — Customer requests refund after charge completion
**Use when:** money already settled and customer should receive money back.

1. Capture the commercial record:
   - charge id or payment intent id
   - amount
   - reason for refund
   - related workspace id
   - whether the subscription should also be canceled

2. Create the refund in Stripe.
   - Dashboard path: Stripe -> Payment -> Refund
   - API equivalent:
   ```bash
   curl -sS https://api.stripe.com/v1/refunds \
     -X POST \
     -H "Authorization: Bearer $OPENPLAN_STRIPE_SECRET_KEY" \
     -d charge=$CHARGE_ID \
     -d reason=requested_by_customer
   ```

3. Verify Stripe result:
   - refund object exists
   - refund status is `succeeded`
   - charge shows `refunded=true` and `amount_refunded` as expected

4. If access should end, also cancel the subscription
   - follow **Procedure B**

5. Verify OpenPlan posture honestly
   - OpenPlan should be relied on for **subscription/access** state,
   - Stripe should be relied on for **refund ledger** state.

6. Save evidence:
   - refund id
   - charge id
   - subscription id if canceled
   - workspace state after webhook processing

## Procedure D — Purchaser-email mismatch / manual identity review
**Use when:** Stripe checkout completed under a different purchaser email than the initiating workspace owner/admin.

1. Open `/billing?workspaceId=<workspace-id>`.
2. Review the warning banner and compare:
   - initiating operator email
   - purchaser email
3. Decide one of two paths:
   - sign in under the purchaser email and complete ownership alignment, or
   - perform a manual commercial review and then decide whether to keep/cancel/refund.
4. If money should be reversed, use **Procedure C**.
5. If the subscription should end, use **Procedure B**.

## Monitoring / Verification Command
For engineering-grade evidence reconciliation, use the existing monitor:
```bash
./scripts/openplan-starter-canary-monitor.sh \
  --workspace-id <workspace-uuid> \
  --since-minutes 180 \
  --env-file /tmp/openplan.vercel.env
```

This is useful for gathering:
- Stripe event ids,
- workspace billing state,
- billing events,
- webhook receipt processing status.

## Recommendation
### Can this lane be treated as sufficiently closed for **v1 HOLD narrowing**?
**Yes — with a truthful qualifier.**

My recommendation:
- treat the **cancel/refund operational lane as sufficiently closed for HOLD narrowing**,
- because the remaining risk is now explicit and bounded,
- and because this pass converted hidden drift into documented operational truth.

### Why I recommend narrowing, not pretending full commercial closure
Because we now have:
- historical live refund/cancel proof re-verified,
- current production hold-path proof already documented elsewhere,
- corrected billing return-path behavior,
- explicit manual procedure for abandoned checkout / cancel / refund handling,
- full post-change validation gate.

But we still do **not** have:
- a fresh current-cycle real-money paid canary followed by refund/cancel.

### Practical decision framing
- **Internal v1 narrowing:** reasonable now.
- **External “fully commercially proven” language:** still a judgment call, and should remain conservative unless Nathaniel / Elena want an explicitly supervised paid canary.

## Bottom Line
This pass did **not** stage theater. It did not fake a fresh live refund/cancel cycle.

What it did do is tighter and more useful:
- re-verify the historical live refund/cancel evidence,
- surface the real current operational boundaries,
- fix a real checkout return-path defect,
- write the runbook that was actually missing,
- and reduce the HOLD basis from hidden ambiguity to explicit governance/commercial judgment.
