# Billing runs meter activation proof

**Shipped:** 2026-04-24 Pacific
**Scope:** C.1e production Stripe meter activation for the launch `runs` usage bucket.

## What changed

Created the production Stripe billing meter required by OpenPlan's period-close usage flush path:

- Meter id: `mtr_61UZ1P8zjRw2RgpPu41FRyHCgEytn6Oe`
- Event name: `openplan_runs`
- Status: `active`
- Livemode: `true`
- Aggregation: `sum`
- Customer mapping: meter event payload key `stripe_customer_id`
- Value mapping: meter event payload key `value`

This matches the existing usage flush payload shape in `src/lib/billing/usage-flush.ts`, which reports one aggregate meter event per closed workspace/period/bucket group:

- `stripe_customer_id`
- `value`
- `workspace_id`
- `stripe_subscription_id`
- `bucket_key`
- `period_start`
- `period_end`

Configured Vercel Production:

- `OPENPLAN_STRIPE_METER_EVENT_NAME_RUNS=openplan_runs`

Then redeployed production so the readiness route could see the new meter event env:

- Deployment: `https://openplan-3665l5hlo-natford.vercel.app`
- Deployment id: `dpl_4j5ANyTQTdcgpF8cP1zAsZvvqN7p`
- Canonical alias verified: `https://openplan-natford.vercel.app`
- Alias response header referenced `dpl_4j5ANyTQTdcgpF8cP1zAsZvvqN7p`.

## Production readiness dry run

Called:

```text
POST https://openplan-natford.vercel.app/api/billing/readiness
```

Payload:

```json
{
  "workspaceId": "d0000001-0000-4000-8000-000000000001",
  "includeUsageDryRun": true,
  "bucketKey": "runs",
  "limit": 250
}
```

Result:

- HTTP status: `200`
- `ok`: `true`
- readiness status: `ready`
- blockers: 0
- warnings: 0
- `readyForPaidCanary`: `true`

Passing checks:

- Stripe API key present.
- Starter checkout price present.
- Professional checkout price present.
- Stripe webhook signing secret present.
- billing readiness secret present.
- usage flush secret present.
- Supabase public URL, anon key, and service-role key present.
- Stripe `runs` meter event configured.
- `subscriptions` ledger readable: 101 rows, 92 active-like rows.
- `usage_events` ledger readable: 0 unreported events, 0 unreported weighted units.
- NCTC demo workspace snapshot readable: `pilot` / `pilot`, no Stripe customer or subscription yet.
- usage flush dry run executed without Stripe writes: 0 subscriptions, 0 events, 0 groups, 0 failures.

Evidence:

- `docs/ops/2026-04-24-test-output/billing-runs-meter-activation/stripe-runs-meter.json`
- `docs/ops/2026-04-24-test-output/billing-runs-meter-activation/readiness-dry-run-response.json`
- `docs/ops/2026-04-24-test-output/billing-runs-meter-activation/readiness-dry-run-status.txt`

## Guardrails

No live meter events were sent. No usage rows were marked reported. No checkout canary was run. No production user data was mutated.

The readiness dry run scanned the production ledgers and found no closed paid subscription periods with unreported usage, so it proved configuration and grouping posture without touching Stripe meter events.

## Remaining commercial gate

The billing infrastructure is now ready for a supervised paid canary, but first paid access still needs a human-owned commercial decision:

- which workspace/customer to use for the canary,
- whether the canary should use Starter or Professional,
- whether the existing Stripe price numbers are the terms Nathaniel wants to test,
- who is authorized to complete the checkout.

Those are not code blockers; they are sales/ops decisions.
