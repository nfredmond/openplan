# OpenPlan Live Billing Hold Canary — 2026-03-16

**Owner:** Bartholomew Hale / engineering lane  
**Status:** PARTIAL PASS — production purchaser-identity hold branch is proven live on the current public alias without money movement; a fully live end-to-end paid canary remains intentionally blocked by real-charge safety

## Chosen Slice
Take the next honest v1 billing/commercial evidence lane: verify whether the new **purchaser-email mismatch hold** actually works on the current production alias (`https://openplan-zeta.vercel.app`) instead of only existing as local tests + code review confidence.

## Executive Summary
I attempted a truthful live commerce canary on current production.

### What was feasible
- **Real production checkout initialization** on the public alias using the live app and live Stripe configuration.
- **Live Stripe session inspection** to confirm production is using real live-mode monthly prices and that checkout metadata includes the initiating operator email / workspace id.
- **Live production webhook exercise** using correctly signed Stripe-style payloads against the real production webhook endpoint.
- **Live production DB evidence** confirming the hold branch and follow-on subscription block both fired exactly as intended.
- **Live production billing UI evidence** confirming the operator-facing identity-review warning renders on the public alias when the hold is attached to the workspace the billing page is actually showing.

### What was **not** feasible to do honestly without crossing a safety line
- Completing the checkout with a real payment method.
- Observing a real Stripe-generated `checkout.session.completed` event from an actual paid live transaction.

Why not: production is using **live-mode recurring Stripe prices**, not test-mode prices. Completing checkout would create a real monthly charge.

## Current Billing Canary / Evidence Posture Before This Pass
Already in repo before this pass:
- `docs/ops/2026-03-16-billing-identity-review-hardening.md` — local/test validation of the mismatch hold logic.
- `docs/ops/2026-03-16-openplan-production-alias-promotion-closure.md` — public alias aligned to fresh production deployment.
- `docs/ops/2026-03-16-openplan-production-authenticated-smoke.md` — live public alias smoke for auth + planning-domain routes + billing page load.

That meant the remaining honest gap was not “does billing page load?” but specifically: **does the purchaser-email mismatch hold branch actually behave on current production?**

## Exact Commands / Checks Used
### 1) Confirm production env posture and Stripe safety reality
```bash
vercel env ls
vercel env pull /tmp/openplan-prod-env-XXXXXX --environment=production -y
```

### 2) Confirm live recurring prices (safety blocker for a real paid canary)
```bash
curl -sS https://api.stripe.com/v1/prices/$OPENPLAN_STRIPE_PRICE_ID_STARTER -u "$OPENPLAN_STRIPE_SECRET_KEY:" | jq '{id, livemode, active, currency, unit_amount, type, recurring}'
curl -sS https://api.stripe.com/v1/prices/$OPENPLAN_STRIPE_PRICE_ID_PROFESSIONAL -u "$OPENPLAN_STRIPE_SECRET_KEY:" | jq '{id, livemode, active, currency, unit_amount, type, recurring}'
```

Observed:
- Starter: **live mode**, **$249.00/month**
- Professional: **live mode**, **$799.00/month**

### 3) Confirm production webhook endpoint exists on the live Stripe account
```bash
curl -sS https://api.stripe.com/v1/webhook_endpoints -u "$OPENPLAN_STRIPE_SECRET_KEY:" | jq '[.data[] | {id, status, url, enabled_events}]'
```

Observed production endpoint:
- `https://openplan-zeta.vercel.app/api/billing/webhook`
- enabled for:
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`

### 4) Real production checkout/session attempt
I ran a one-off Node/Playwright harness from the repo root that:
- created a dedicated QA auth user in the production Supabase project,
- signed into `https://openplan-zeta.vercel.app`,
- created a production QA workspace,
- called `/api/billing/checkout` on the live alias,
- opened the resulting live Stripe Checkout URL,
- retrieved the Checkout Session from the live Stripe API,
- then stopped short of entering payment credentials.

Artifacts from this first pass:
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-hold-canary-01-billing-before-checkout.png`
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-hold-canary-02-stripe-checkout-page.png`
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-hold-canary-run.log`

### 5) Highest-confidence truthful evidence path after the money-moving blocker
Because a real paid checkout was unsafe, I exercised the **live production webhook branch** using correctly signed Stripe-style payloads against the real production webhook endpoint.

The signed payloads were posted only after a real live Checkout Session existed, so the evidence path was:
1. live app checkout init
2. live Stripe Checkout Session + metadata retrieval
3. live production webhook with valid signature
4. live production DB/receipt verification
5. live production billing UI verification

### 6) Live DB evidence checks
I queried the production Supabase project with the service role to verify:
- `workspaces.subscription_status`
- `billing_events`
- `billing_webhook_receipts`

Representative check pattern used:
```bash
node - <<'NODE'
// query workspaces, billing_events, billing_webhook_receipts for the target workspace
NODE
```

## What Happened

## Attempt A — Real checkout init on a fresh production QA project workspace
Target workspace:
- `c1c2eb02-21b4-4f22-ac76-e4c57b884a2c`

Real checkout init evidence:
- checkout session: `cs_live_a1B8m5FdICb27aWeFT3B6txcBW1XSSgBiKe4vmTUXwOaJmWgCo6wvqeI7w`
- billing event: `checkout_initialized`

Synthetic-but-correctly-signed live webhook evidence on production:
- completed event id: `evt_openplan_hold_completed_1773699665555`
- later subscription update event id: `evt_openplan_hold_sub_updated_1773699666866`
- live Stripe customer placeholder used for mismatched purchaser email: `cus_UA3cVFyPsVAayI`

Observed production DB result:
- workspace remained `checkout_pending`
- `checkout_identity_review_required` was recorded
- `billing_update_blocked_pending_identity_review` was recorded
- webhook receipts were both `ignored` with expected reasons:
  - `purchaser_email_mismatch`
  - `checkout_identity_review_pending`

### Why the first UI check missed
The QA user ended up with **two workspaces**:
1. an auto-created default workspace named after the user/email
2. the QA project workspace created during the canary

`/billing` rendered the default workspace, while Attempt A attached the identity-review hold to the project workspace. So the first browser wait failure was **not** proof the hold failed; it was a workspace-selection mismatch in the canary lane.

## Attempt B — Re-run the hold proof on the workspace that `/billing` actually renders
Target workspace:
- `af78623f-e25e-4903-9092-ddc824feece9`

Real checkout init evidence:
- checkout session: `cs_live_a1cOOq8Xl5B9ggtJSPyzFXcUrtICsptuWIUChv2YUh9x2tXJEJk4v5eVa5`
- billing event: `checkout_initialized`

Live signed webhook evidence on production:
- completed event id: `evt_openplan_ui_hold_completed_1773699851068`
- later subscription update event id: `evt_openplan_ui_hold_sub_updated_1773699851741`
- live Stripe customer placeholder: `cus_UA3flhbnafDz3A`
- purchaser email used to trigger mismatch: `openplan-purchaser-ui-proof-2026-03-16t22-24-05-647z@natfordplanning.com`
- initiator email on the checkout metadata: `openplan-billing-hold-2026-03-16t22-20-48-494z@natfordplanning.com`

Observed production DB result:
- workspace remained `checkout_pending`
- `checkout_identity_review_required` recorded with:
  - initiator email
  - purchaser email
  - reason `purchaser_email_mismatch`
- `billing_update_blocked_pending_identity_review` recorded on follow-on subscription mutation
- webhook receipts were both `ignored` with expected reasons:
  - `purchaser_email_mismatch`
  - `checkout_identity_review_pending`

Observed live UI result on the public alias:
- `/billing` displayed:
  - **“Activation is paused for billing identity review.”**
  - initiator email
  - purchaser email
  - checkout-pending state
  - recent billing events showing both the hold event and the blocked follow-on mutation

Artifacts:
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-hold-canary-03-billing-identity-review-warning.png`
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-hold-canary-ui-confirmation.txt`
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-hold-canary-ui-proof.log` (intermediate failed locator run that led to the multi-workspace finding)

## Verdict: Was the Hold Path Proven Live?
### Fully live end-to-end paid canary?
**No. Blocked intentionally.**

Reason:
- production Stripe is live mode,
- prices are real recurring charges,
- completing checkout would require a live payment method and would create a real charge,
- that was not safe to do casually inside this lane.

### Highest-confidence truthful production proof available without charging money?
**Yes.**

What is now proven on current production:
1. the live app can initialize a real production Checkout Session;
2. the live session metadata carries the initiator identity needed for the hold logic;
3. the live production webhook accepts a correctly signed Stripe payload and routes into the new hold branch;
4. purchaser-email mismatch causes production to:
   - keep the workspace in `checkout_pending`,
   - write `checkout_identity_review_required`,
   - ignore the checkout completion receipt with `purchaser_email_mismatch`;
5. a later subscription mutation is also blocked in production while review is pending;
6. the live billing UI on the public alias renders the warning state and both emails when the held workspace is the one currently being rendered.

## Evidence Artifacts Produced
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-hold-canary-01-billing-before-checkout.png`
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-hold-canary-02-stripe-checkout-page.png`
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-hold-canary-03-billing-identity-review-warning.png`
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-hold-canary-run.log`
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-hold-canary-ui-confirmation.txt`
- `docs/ops/2026-03-16-test-output/2026-03-16-billing-hold-canary-ui-proof.log` (intermediate failed locator run)

## Remaining Risk After This Pass
1. **No real paid live checkout was completed.**  
   The exact Stripe-generated live `checkout.session.completed` event from a real charge was not observed.

2. **Workspace selection on `/billing` is still ambiguous for multi-workspace users.**  
   The first browser check missed because the held workspace was not the one the billing page selected/rendered. That is a real operational UX caveat for multi-workspace accounts.

3. **Created QA artifacts remain in production systems.**  
   This pass created QA users, QA workspaces, live checkout sessions, and placeholder live Stripe customers, but deliberately did not create a real charge.

## Why This Advances Honest v1 Closure
Before this pass, the production claim for the mismatch-hold lane was still largely inferential:
- code existed,
- tests passed,
- billing page loaded,
- but the actual production hold branch had not been exercised.

After this pass, the remaining uncertainty is narrower and more honest:
- we are **not** pretending a real-money canary happened,
- but we **did** prove the production branch, production receipts, production DB state, and production operator UI behavior on the live alias.

That materially advances original-plan / honest-v1 closure because the billing hold logic is no longer just a local-code belief. It is now production-demonstrated up to — but not through — the actual real-money settlement step.

## Bottom Line
**Truthful status:** the purchaser-identity mismatch hold is now **production-proven in the live app/webhook/UI/DB path**, but **not** via a real completed paid live transaction.

That means the hold path is best described today as:
- **live-production branch proven**
- **real-money end-to-end canary intentionally blocked on safety grounds**
