# Billing usage flush proof

**Shipped:** 2026-04-24 Pacific
**Scope:** C.1b period-close usage flush path for the normalized `usage_events` ledger.

## What shipped

Added a service-only `POST /api/billing/usage/flush` route and shared `src/lib/billing/usage-flush.ts` helper.

The helper:

- finds closed subscription periods from `subscriptions.current_period_end`,
- loads unreported `usage_events` inside each subscription period,
- groups rows by workspace, period, and bucket,
- emits one aggregate Stripe meter event per group when live reporting is explicitly enabled,
- marks source rows with `stripe_reported_at` and `stripe_report_event_id` only after Stripe accepts the meter event,
- leaves rows unmarked on Stripe failure,
- surfaces `reported_mark_failed` separately if Stripe accepts but the local mark write fails.

The route:

- requires `OPENPLAN_BILLING_USAGE_FLUSH_SECRET`,
- accepts either `Authorization: Bearer <secret>` or `x-openplan-billing-usage-flush-secret`,
- defaults to `dryRun: true`,
- rejects invalid payloads and future `closedBefore` cutoffs,
- uses service-role Supabase only after authorization,
- returns `207` for partial failures instead of hiding per-group failure states.

## Stripe configuration posture

Live reporting requires all of the following:

- `dryRun: false` in the request body,
- `OPENPLAN_BILLING_USAGE_FLUSH_SECRET` configured and supplied by the caller,
- `OPENPLAN_STRIPE_SECRET_KEY` or `STRIPE_SECRET_KEY`,
- a Stripe meter event name configured for the bucket, usually `OPENPLAN_STRIPE_METER_EVENT_NAME_RUNS`.

Bucket-specific meter event names are supported with `OPENPLAN_STRIPE_METER_EVENT_NAME_<BUCKET>`, where non-alphanumeric bucket characters normalize to underscores. `OPENPLAN_STRIPE_METER_EVENT_NAME` is a fallback.

No Stripe account was connected, no pricing was set, and no live usage flush was run in this slice.

## Files shipped

Added:

- `openplan/src/app/api/billing/usage/flush/route.ts`
- `openplan/src/lib/billing/usage-flush.ts`
- `openplan/src/test/billing-usage-flush.test.ts`
- `openplan/src/test/billing-usage-flush-route.test.ts`

Modified:

- `openplan/src/app/(app)/billing/page.tsx`

## Gates

- Focused billing usage suite: 6 files / 33 tests passing.
- `pnpm exec tsc --noEmit`: clean.
- `pnpm qa:gate`: clean.
  - Lint: clean.
  - `pnpm test`: 215 files / 1099 tests passing.
  - `pnpm audit --prod --audit-level=moderate`: 0 known vulnerabilities.
  - `pnpm build`: production build clean; route manifest includes `/api/billing/usage/flush`.

## Deferred

The route is intentionally operator-triggered. Before first paid access, decide whether to keep this as manual ops, put it behind a Vercel Cron, or wrap it in a narrower admin UI action. If Nathaniel wants Vercel Cron, configure the same endpoint with `dryRun: false` only after the Stripe meter event names and secret are explicitly set in the target environment.
