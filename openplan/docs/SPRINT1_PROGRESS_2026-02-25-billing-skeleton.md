# Sprint 1 Progress — Billing Skeleton + Subscription Enforcement (2026-02-25)

## Scope
Implemented the first operational billing skeleton for Starter/Professional conversion and enforced subscription state for analysis execution.

## Changes shipped

1. **Workspace billing schema extension**
   - Added migration:
     - `supabase/migrations/20260226000006_workspace_billing_skeleton.sql`
   - New workspace fields:
     - `subscription_plan`
     - `subscription_status`
     - `stripe_customer_id`
     - `stripe_subscription_id`
     - `subscription_current_period_end`
     - `billing_updated_at`

2. **Billing checkout API (skeleton)**
   - Added `src/app/api/billing/checkout/route.ts`
   - Supports owner/admin checkout initialization for:
     - `starter`
     - `professional`
   - Behavior:
     - If Stripe payment-link env vars exist, redirects to configured URL.
     - Otherwise uses mock redirect mode for deterministic QA.
   - Workspace is marked `checkout_pending` with selected plan on initialization.

3. **Billing UI surface**
   - Added `src/app/(workspace)/billing/page.tsx`
   - Shows current subscription state + plan + update timestamp.
   - Adds checkout initialization actions for Starter/Professional.
   - Integrated billing into authenticated nav and dashboard quick-actions.

4. **Subscription enforcement in analysis API**
   - Updated `src/app/api/analysis/route.ts` to require:
     - authenticated user
     - workspace membership
     - active/trialing/pilot subscription status
   - Returns a clear gate message for inactive/pending billing states.

5. **Billing helper utilities**
   - Added `src/lib/billing/subscription.ts` for status normalization, gate checks, and operator-facing messages.

## Environment notes
- Optional Stripe payment-link env vars:
  - `OPENPLAN_STRIPE_CHECKOUT_URL_STARTER`
  - `OPENPLAN_STRIPE_CHECKOUT_URL_PROFESSIONAL`
- If absent, checkout route uses mock redirect mode for testability.

## Next refinement
- Replace payment-link mode with true Stripe Checkout Session + webhook handling.
- Promote checkout completion to `active` and persist Stripe IDs from webhook events.
- Add plan-feature entitlements and hard usage caps by subscription tier.
