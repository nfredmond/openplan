# Billing production readiness activation proof

**Shipped:** 2026-04-24 Pacific
**Scope:** C.1d production activation of the non-destructive billing readiness lane.

## What changed

Configured the two production-only operator secrets that make the C.1c readiness route callable:

- `OPENPLAN_BILLING_USAGE_FLUSH_SECRET`
- `OPENPLAN_BILLING_READINESS_SECRET`

Both were added to Vercel as sensitive Production environment variables. No secret values were printed, committed, or placed on command-line arguments.

Then redeployed the already-committed app to production so the new environment was present at runtime:

- Deployment: `https://openplan-f5tcv09k1-natford.vercel.app`
- Deployment id: `dpl_EgKCfqoSc7KYGajNzdY5LG3iqCoW`
- Canonical alias verified: `https://openplan-natford.vercel.app`
- Alias response header referenced the new deployment id in the Next font preload URL.

## Read-only checks

Pulled production env into `/tmp` only for read-only diagnostics, then queried Stripe billing meters through the Stripe SDK. The connected Stripe account returned:

```text
stripe_meters_count=0
```

No Stripe billing meter was created. That remains an explicit operator/vendor configuration step because it changes the production Stripe account billing model.

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
- `ok`: `false`
- readiness status: `blocked`
- blockers: 1

The only blocker is:

```text
Stripe runs meter event: Missing OPENPLAN_STRIPE_METER_EVENT_NAME_RUNS or OPENPLAN_STRIPE_METER_EVENT_NAME.
```

Passing checks:

- Stripe API key present.
- Starter checkout price present.
- Professional checkout price present.
- Stripe webhook signing secret present.
- billing readiness secret present.
- usage flush secret present.
- Supabase public URL, anon key, and service-role key present.
- `subscriptions` ledger readable: 101 rows, 92 active-like rows.
- `usage_events` ledger readable: 0 unreported events, 0 unreported weighted units.
- NCTC demo workspace snapshot readable: `pilot` / `pilot`, no Stripe customer or subscription yet.
- usage flush dry run executed without Stripe writes: 0 subscriptions, 0 events, 0 groups, 0 failures.

Evidence:

- `docs/ops/2026-04-24-test-output/billing-readiness-activation/readiness-dry-run-response.json`
- `docs/ops/2026-04-24-test-output/billing-readiness-activation/readiness-dry-run-status.txt`

## Guardrail checks

Unauthenticated production readiness call returns:

```text
HTTP 401 {"error":"Unauthorized"}
```

No live Stripe meter events were sent. No checkout canary was run. No production user data was mutated.

## Remaining blocker

Before first paid access or a live usage flush, Nathaniel must decide the Stripe meter posture:

- create/confirm the Stripe billing meter for the `runs` usage bucket,
- provide the exact meter event name,
- configure `OPENPLAN_STRIPE_METER_EVENT_NAME_RUNS` in Vercel Production,
- redeploy,
- rerun the same readiness dry-run until `readyForPaidCanary=true`.

Until then, checkout/webhook/ledger readiness is proven, but metered usage reporting remains intentionally blocked.
