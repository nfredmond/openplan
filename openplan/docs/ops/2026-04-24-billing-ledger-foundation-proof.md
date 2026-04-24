# Billing ledger foundation proof

**Shipped:** 2026-04-24 Pacific
**Scope:** First C.1 implementation slice: normalized subscription and usage ledgers behind the existing strict billing gates.

## What shipped

Added migration `20260424000072_billing_ledger_foundation.sql` with two normalized billing tables:

- `subscriptions`, keyed by `workspace_id`, as the durable per-workspace subscription ledger.
- `usage_events`, keyed by generated event id with optional idempotency keys, as the internal per-workspace usage ledger for later period-close Stripe reporting.

Both tables have RLS enabled, workspace-member read policies, authenticated read grants constrained by RLS, and service-role write posture. The migration also backfills `subscriptions` from existing `workspaces` billing snapshot columns and keeps the existing `workspaces` columns as the cached gate/read model.

Added billing helpers for:

- applying subscription mutations to both `subscriptions` and `workspaces`,
- loading the current workspace subscription snapshot with workspace fallback,
- recording usage events idempotently,
- aggregating period usage by bucket,
- marking usage events as reported for a later Stripe flush.

Extended the existing Stripe checkout and webhook routes so checkout-pending and subscription webhook events write the normalized ledger and the workspace snapshot. The webhook mapper now handles `invoice.payment_failed` and extracts workspace metadata from both subscription and invoice-shaped Stripe payloads.

Updated `/billing` to prefer the normalized subscription snapshot, show ledger/fallback state, period start/end, masked Stripe references, and internal usage bucket totals alongside the existing invoice register.

## Usage recording

The current strict quota gates still decide access before work starts. Successful durable actions now record best-effort internal usage after the application write succeeds:

- `/api/analysis` -> `analysis.run`
- `/api/models/[modelId]/runs/[modelRunId]/launch` -> `model_run.launch`
- `/api/reports/[reportId]/generate` -> `report.generate`
- `/api/scenarios/[scenarioSetId]/spine/comparison-snapshots` -> `scenario.comparison_snapshot`
- `/api/network-packages/[packageId]/versions/[versionId]/ingest` -> `network_package.ingest`

Usage writes are service-role only, idempotent where the route has a durable output id, and intentionally best-effort. A missing or temporarily unavailable usage ledger logs an audit warning but does not turn a completed customer action into a failed response.

## Safety posture

- No pricing numbers, public pricing commitments, Stripe procurement, or live usage reporting were introduced.
- No destructive database operation was used.
- Code is migration-tolerant: if the ledger schema is pending, checkout/webhook mutations still sync the existing workspace billing snapshot and emit an audit warning.
- User-facing subscription reads are still workspace-scoped through RLS.
- Stripe period-close reporting is still deferred; `usage_events.stripe_reported_at` and `stripe_report_event_id` are ready for the next flush slice.

## Files shipped

Added:

- `openplan/supabase/migrations/20260424000072_billing_ledger_foundation.sql`
- `openplan/src/lib/billing/subscriptions.ts`
- `openplan/src/lib/billing/usage-events.ts`
- `openplan/src/lib/billing/usage-recording.ts`
- `openplan/src/test/billing-ledger-migration.test.ts`
- `openplan/src/test/billing-subscriptions.test.ts`
- `openplan/src/test/billing-usage-events.test.ts`
- `openplan/src/test/billing-usage-recording.test.ts`

Modified:

- `openplan/src/app/(app)/billing/page.tsx`
- `openplan/src/app/api/analysis/route.ts`
- `openplan/src/app/api/billing/checkout/route.ts`
- `openplan/src/app/api/billing/webhook/route.ts`
- `openplan/src/app/api/models/[modelId]/runs/[modelRunId]/launch/route.ts`
- `openplan/src/app/api/network-packages/[packageId]/versions/[versionId]/ingest/route.ts`
- `openplan/src/app/api/reports/[reportId]/generate/route.ts`
- `openplan/src/app/api/scenarios/[scenarioSetId]/spine/comparison-snapshots/route.ts`
- `openplan/src/lib/billing/webhook.ts`
- `openplan/src/test/billing-checkout-route.test.ts`
- `openplan/src/test/billing-webhook-route.test.ts`
- `openplan/src/test/billing-webhook-utils.test.ts`
- `openplan/src/test/op001-signup-invite-role-lifecycle.test.ts`

## Gates

- Focused billing ledger suite: 7 files / 36 tests passing.
- `pnpm exec tsc --noEmit`: clean.
- `pnpm qa:gate`: clean.
  - Lint: clean.
  - `pnpm test`: 213 files / 1087 tests passing.
  - `pnpm audit --prod --audit-level=moderate`: 0 known vulnerabilities.
  - `pnpm build`: production build clean.
- `pnpm supabase db push --linked --dry-run`: one pending migration, `20260424000072_billing_ledger_foundation.sql`.
- `pnpm supabase db push --linked --yes`: migration applied to prod project.
- Prod service-role verification: `subscriptions` count = 101; `usage_events` count = 0 before new billable actions.

## Deferred

The next billing slice should add the period-close usage flush path. It should group unreported `usage_events` by workspace/subscription/bucket, report aggregate quantities to Stripe only after the period closes, and mark rows reported only after Stripe accepts the write. The implementation still needs Nathaniel's decision on operator mode: manual admin action, Vercel Cron, or a local service-role script for the first customer.
