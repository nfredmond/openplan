# Billing readiness preflight proof

**Shipped:** 2026-04-24 Pacific
**Scope:** C.1c non-destructive paid-access readiness checks for billing checkout, webhook ingestion, normalized ledgers, and usage-flush configuration.

## What shipped

Added a service-protected `POST /api/billing/readiness` route and shared `src/lib/billing/readiness.ts` helper.

The helper builds a secret-safe readiness summary across:

- Stripe checkout configuration (`OPENPLAN_STRIPE_SECRET_KEY` / `STRIPE_SECRET_KEY`, Starter price, optional Professional price),
- Stripe webhook signing posture (`OPENPLAN_STRIPE_WEBHOOK_SECRET`),
- billing ops secrets (`OPENPLAN_BILLING_READINESS_SECRET` or the usage-flush secret, plus `OPENPLAN_BILLING_USAGE_FLUSH_SECRET`),
- Stripe usage meter configuration for the `runs` bucket,
- Supabase public/anon/service-role env posture,
- `subscriptions` ledger accessibility and active-like row count,
- `usage_events` ledger accessibility plus unreported event/weight count,
- optional canary workspace billing snapshot,
- optional dry-run usage flush grouping.

The route:

- requires `OPENPLAN_BILLING_READINESS_SECRET` or falls back to `OPENPLAN_BILLING_USAGE_FLUSH_SECRET`,
- accepts either `Authorization: Bearer <secret>`, `x-openplan-billing-readiness-secret`, or `x-openplan-billing-usage-flush-secret`,
- uses service-role Supabase only after authorization,
- never creates a Stripe client,
- runs usage flush only in `dryRun: true` mode when `includeUsageDryRun=true`,
- rejects invalid payloads and future `closedBefore` cutoffs,
- returns blocker/warning detail without echoing secret values.

The supervised paid-canary preflight script now blocks on the new C.1b/C.1c launch requirements: webhook signing secret, readiness/flush secret posture, and a configured `runs` meter event name. Its generated summary includes the exact readiness dry-run `curl` command for the canary workspace.

## Files shipped

Added:

- `openplan/src/app/api/billing/readiness/route.ts`
- `openplan/src/lib/billing/readiness.ts`
- `openplan/src/test/billing-readiness.test.ts`
- `openplan/src/test/billing-readiness-route.test.ts`

Modified:

- `openplan/.env.example`
- `openplan/scripts/openplan-supervised-paid-canary-preflight.sh`

## Gates

- Focused readiness suite: 2 files / 9 tests passing.
- Focused billing ops suite: 8 files / 34 tests passing.
- `pnpm exec tsc --noEmit`: clean.
- `bash -n scripts/openplan-supervised-paid-canary-preflight.sh`: clean.
- `pnpm qa:gate`: clean.
  - Lint: clean.
  - `pnpm test`: 217 files / 1108 tests passing.
  - `pnpm audit --prod --audit-level=moderate`: 0 known vulnerabilities.
  - `pnpm build`: production build clean; route manifest includes `/api/billing/readiness`.

## Deferred

No live Stripe meter writes were run. No live paid checkout canary was executed. The next operator step before first paid access is to configure the production readiness/usage secrets and meter event name, then run the generated readiness dry-run and supervised paid-canary preflight against the dedicated canary workspace.
