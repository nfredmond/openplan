# Stripe P0 Readiness Oversight Checkpoint

- **Date (PT):** 2026-02-28 06:39
- **Owner:** Elena (Principal Planner)
- **Context:** Post Tier1 v2.3 CLOSED-PASS handoff

## Current Snapshot
- Checkout routing guardrails exist in code:
  - `/api/commerce/checkout` validates HTTPS + Stripe allowed hosts and falls back to contact when links are missing/invalid.
  - `/api/commerce/readiness` returns configured/missing tier counts.
- Offer catalog currently expects **12 Stripe payment-link env keys** (`STRIPE_LINK_*`).
- Local runtime shell check shows all 12 keys missing in this environment (this is a local check, not authoritative for Vercel runtime).

## P0 Coordination Priorities (immediate)
1. **Production env completeness check**
   - Confirm all 12 `STRIPE_LINK_*` keys are configured in Vercel production for `nat-ford-website`.
2. **Readiness endpoint verification**
   - Validate `/api/commerce/readiness` in production returns `readyForDirectStripeCheckout: true`.
3. **Checkout redirect smoke tests (3-path minimum)**
   - Test one tier each from OpenPlan, Ads, and Drone lines.
   - Confirm redirect lands on approved Stripe hosts only.
4. **Fallback integrity test**
   - Temporarily unset one non-critical test key in preview only; confirm `/contact` fallback includes product/tier context.
5. **Copy/ethics confirmation**
   - Ensure pricing/checkout language keeps transparent-pricing and no-guarantee claims in public product page copy.

## Blocking Risks to Monitor
- Missing Stripe links at runtime causing contact fallback instead of checkout.
- Misconfigured link host outside allowlist causing safe redirect rejection.
- Inconsistent product-page disclosures versus ethics standard.

## Next Milestone
- Deliver Stripe P0 readiness decision packet:
  - **READY** (all 12 configured + smoke pass) **or**
  - **HOLD** (with explicit missing keys/tests and fix owner/ETA).
