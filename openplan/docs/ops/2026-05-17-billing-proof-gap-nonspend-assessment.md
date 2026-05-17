# Billing proof gap non-spend assessment

**Date:** 2026-05-17 Pacific  
**Scope:** OpenPlan checkout/billing confidence without initiating a paid charge, creating a Stripe Checkout Session, sending live meter events, or mutating production billing state.

## Finding

The remaining checkout/billing proof gap is not a missing local unit test around the current public checkout surface. The current `/api/billing/checkout` route intentionally disables direct OpenPlan tier checkout and routes legacy Starter/Professional requests to human fit-review intake. Existing tests assert that the response does not expose Stripe checkout/session/subscription identifiers and does not claim workspace activation.

The gap is proof-language precision around the billing readiness endpoint: `readyForPaidCanary=true` means the configured billing infrastructure and non-spend dry-run posture are clear enough to attempt a supervised paid canary. It does **not** itself authorize or perform that canary.

## Small safe slice implemented

Added explicit non-spend canary caveats to `POST /api/billing/readiness` responses:

- `nonSpendProofOnly: true`
- `paidCanaryRequiresApproval: true`
- `paidCanaryApprovalNote`: states the response does not create a Stripe Checkout Session, send meter events, mark usage reported, activate a workspace, or authorize a paid canary.

Updated route tests to lock that contract for both normal readiness checks and usage-flush dry-run checks.

## Files changed

- `src/app/api/billing/readiness/route.ts`
- `src/test/billing-readiness-route.test.ts`
- `docs/ops/2026-05-17-billing-proof-gap-nonspend-assessment.md`

## Validation

```bash
pnpm vitest run src/test/billing-readiness-route.test.ts src/test/billing-checkout-route.test.ts
```

Result: passing.

## Guardrails preserved

This slice did not:

- initiate Stripe Checkout,
- run a paid canary,
- send Stripe meter events,
- mark usage rows reported,
- mutate production billing state,
- change public checkout behavior.

## Requires Nathaniel approval

A fresh paid canary remains the only end-to-end proof that would close the live-money gap. That should be explicitly approved by Nathaniel with:

- workspace/customer to use,
- Starter vs Professional plan,
- accepted Stripe price terms,
- who is authorized to complete checkout.
