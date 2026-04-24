# Phase C.1 — Billing / metering infrastructure plan

**Status:** Draft for Nathaniel review. Do not implement until approved.
**Goal:** Move OpenPlan from internal quota gates to production-ready workspace subscription + metered-usage infrastructure without creating pricing commitments or financial liability.

## External References Checked

- [Vercel Stripe integration docs](https://vercel.com/docs/integrations/ecommerce/stripe/), last updated 2026-03-05: Vercel's native Stripe integration provisions sandbox/live API keys as Vercel environment variables and supports connecting an existing Stripe account.
- [Vercel commerce/payments integration docs](https://vercel.com/docs/integrations/ecommerce), last updated 2026-03-12: Stripe is the native Vercel payments integration.
- [Vercel Marketplace Stripe page](https://vercel.com/marketplace/stripe/): Stripe is a Vercel Native payment integration with sandbox setup and existing-account import.

Implication: **use the Vercel Stripe integration if Nathaniel approves connecting/provisioning Stripe**, because it reduces manual secret handling. Do not install/procure it without approval.

## Current Billing Truth

Already live:

- Workspace billing snapshot columns on `workspaces`: `subscription_plan`, `subscription_status`, `stripe_customer_id`, `stripe_subscription_id`, `subscription_current_period_end`, `billing_updated_at`.
- `/api/billing/checkout` creates Stripe Checkout sessions and marks `checkout_pending`.
- `/api/billing/webhook` verifies Stripe signatures, uses `billing_webhook_receipts` for idempotency, writes workspace billing snapshot fields, and logs `billing_events`.
- `billing_webhook_receipts` is intentionally service-role only with RLS enabled and no user policies.
- `/billing` displays workspace billing state, billing events, current quota posture, and the project-delivery invoice register.
- Quota gates exist on:
  - `/api/analysis`
  - `/api/models/[modelId]/runs/[modelRunId]/launch`
  - `/api/reports/[reportId]/generate`
  - `/api/scenarios/[scenarioSetId]/spine/comparison-snapshots`
  - `/api/network-packages/[packageId]/versions/[versionId]/ingest`
- Current gate posture is strict: inactive subscription returns `402`, exhausted quota returns `429`.

Gap:

- There is no normalized subscription table.
- Quota checks count source rows directly rather than recording usage events.
- Nothing reports usage to Stripe at period close.
- The billing page is still a mixed subscription + project-delivery invoice register, not a clear subscription-admin page.

## Recommended Architecture

Keep `workspaces` billing columns as a cached read model for current gates and UI, but introduce normalized billing tables as the source of truth for subscription + usage.

### Migration 1 — normalized subscription + usage tables

Append-only migration:

```sql
CREATE TABLE IF NOT EXISTS subscriptions (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  plan TEXT NOT NULL,
  status TEXT NOT NULL,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  quota_buckets JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  bucket_key TEXT NOT NULL DEFAULT 'runs',
  weight INTEGER NOT NULL CHECK (weight > 0),
  source_route TEXT,
  idempotency_key TEXT UNIQUE,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stripe_reported_at TIMESTAMPTZ,
  stripe_report_event_id TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

RLS:

- `subscriptions`: workspace members can read; writes service-role only.
- `usage_events`: workspace members can read aggregate-safe fields; writes service-role only.
- Pin all trigger/function `search_path`.
- No table drops. No migration that backfills from production user data without a bounded `WHERE`.

Backfill:

- One idempotent `INSERT INTO subscriptions (...) SELECT ... FROM workspaces ON CONFLICT (workspace_id) DO UPDATE`.
- Preserve `pilot` demo workspaces.

### Migration 2 — optional billing events index cleanup

Add indexes only if needed by query plans:

- `usage_events(workspace_id, occurred_at DESC)`
- `usage_events(workspace_id, stripe_reported_at, occurred_at)`
- `usage_events(bucket_key, stripe_reported_at, occurred_at)`
- `subscriptions(stripe_customer_id)`
- `subscriptions(stripe_subscription_id)`

## Application Changes

### 1. Billing repository helpers

New focused helpers under `src/lib/billing/`:

- `subscriptions.ts`
  - `loadWorkspaceSubscriptionSnapshot(workspaceId)`
  - `upsertSubscriptionFromStripeMutation(mutation)`
  - `syncWorkspaceBillingSnapshot(workspaceId)` to keep current `workspaces` columns aligned.
- `usage-events.ts`
  - `recordUsageEvent({ workspaceId, eventKey, bucketKey, weight, sourceRoute, idempotencyKey, metadata })`
  - `loadUsageForCurrentPeriod(workspaceId)`
  - `markUsageEventsReported(ids, stripeReportEventId)`
- `usage-flush.ts`
  - Groups unreported usage by workspace/subscription/bucket/current period.
  - Reports one aggregated usage quantity per bucket at period close.
  - Marks rows reported only after Stripe accepts the report.

### 2. Quota gate integration

Keep `checkMonthlyRunQuota` behavior strict for launch. Extend it or wrap it so every successful gated action records a usage event **after** the gate passes and **before/around** the expensive write:

| Route | Event key | Weight |
|---|---|---:|
| `/api/analysis` | `analysis.run` | 1 |
| `/api/models/[modelId]/runs/[modelRunId]/launch` | `model_run.launch` | 5 |
| `/api/reports/[reportId]/generate` | `report.generate` | 1 |
| `/api/scenarios/[scenarioSetId]/spine/comparison-snapshots` | `scenario.comparison_snapshot` | 1 |
| `/api/network-packages/[packageId]/versions/[versionId]/ingest` | `network_package.ingest` | 1 |

Idempotency:

- Use stable idempotency keys where possible:
  - report generation: `report:<reportId>:generate:<artifactKind or request id>`
  - scenario comparison: `scenario:<scenarioSetId>:comparison:<createdSnapshotId>`
  - network package ingest: `network_package:<packageId>:<versionId>:ingest:<requestId>`
  - model launch: `model_run:<modelRunId>:launch`
  - analysis: generated request id unless an analysis row id exists.
- If an expensive operation fails before producing durable output, either do not record usage or mark the usage row with failure metadata and exclude it from Stripe reporting. Launch recommendation: record billable usage only for durable successful work.

### 3. Stripe webhook route

Do not duplicate logic.

Current route is `/api/billing/webhook`; the handoff names `/api/webhooks/stripe`. Recommended implementation:

- Keep `/api/billing/webhook` as the canonical handler.
- Add `/api/webhooks/stripe` as a thin alias only if Stripe/Vercel setup expects that route.
- Extend existing mapping for:
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`
- Write both `subscriptions` and the cached `workspaces` billing fields in one service-role transaction-equivalent sequence.
- Continue using `billing_webhook_receipts` for idempotency.
- Keep identity-review handling already present in the route.

### 4. Period-close Stripe reporting

Do not report usage on every request.

Implement a service-only flush route or script:

- `POST /api/billing/usage/flush`
- Auth: Vercel Cron secret or service-only admin secret; no browser/session auth.
- Reads unreported `usage_events` whose period has closed or whose subscription period is ending.
- Groups by workspace/subscription/bucket.
- Sends aggregate usage to Stripe.
- Sets `stripe_reported_at` and `stripe_report_event_id`.

Review decision needed before implementation: whether this should be a Vercel Cron, a manual admin-only route for the first customer, or a local service-role script run during the initial pilot.

### 5. Billing page split

Current `/billing` mixes subscription posture and consulting/project-delivery invoices. C.1 should add an owner/admin subscription section without removing the invoice register:

- Current plan/status/current period.
- Stripe customer/subscription references masked or shortened.
- Period usage by bucket.
- Remaining quota/bucket balances.
- Last webhook receipt state.
- Last usage flush state.
- Clear warnings for `past_due`, `payment_failed`, `checkout_pending`, and identity review.

Keep the project-delivery invoice register below or behind an "Invoice register" section; it is not the same as SaaS subscription billing.

## Test Plan

Unit:

- Subscription upsert/backfill helpers.
- Usage event idempotency and success/failure policy.
- Usage aggregation and report marking.
- Stripe event mapping additions.
- Quota gate records exactly one usage event on successful durable work.

Route:

- `/api/webhooks/stripe` alias, if added, delegates without changing semantics.
- Webhook handles created/updated/deleted/payment_failed and duplicate events.
- Usage flush rejects unauthenticated callers.
- Usage flush partial failure leaves unreported rows untouched.

Page:

- `/billing` renders plan/current period/usage buckets.
- Non-owner/member visibility remains bounded by existing role matrix.

RLS/integration:

- Workspace A cannot read Workspace B subscriptions or usage events.
- Anon cannot read either table.
- Authenticated users cannot insert/update usage events directly.

Gate:

- `pnpm qa:gate`.
- If migrations are added: local `pnpm supabase db reset` if feasible, then prod `pnpm supabase db push` only after review approval.

## Rollout Sequence

1. Nathaniel review of this plan and the open decisions below.
2. Confirm Stripe setup path:
   - Vercel native Stripe integration sandbox/live, or
   - existing manually managed Stripe env vars.
3. Migration for `subscriptions` + `usage_events`.
4. Backfill `subscriptions` from existing `workspaces`.
5. Subscription helper + webhook extension.
6. Usage event helper + wire current quota gates.
7. Usage flush route/script.
8. Billing page subscription-admin section.
9. Tests + proof doc + CLAUDE continuity.
10. Commit, push, migration apply, and a sandbox Stripe end-to-end verification.

## Open Decisions For Nathaniel

1. **Stripe procurement path.** Use Vercel native Stripe integration, or keep manually managed Stripe keys?
2. **Stripe account.** Connect an existing Nat Ford Planning Stripe account, create a sandbox first, or defer live connection?
3. **Plan names only or prices now.** This implementation can use plan names/buckets without pricing numbers. Pricing numbers require Nathaniel approval.
4. **Usage flush operator.** For first customer, should period-close usage reporting be manual admin action, Vercel Cron, or local service-role script?
5. **Strict caps.** Recommendation is keep strict `402`/`429` for launch, as Phase O already does. Confirm before implementation.
6. **Invoice register split.** Keep `/billing` as one page with two sections, or split subscription admin to `/workspace/[id]/billing` and leave `/billing` as project-delivery invoice register?

## Stop Conditions

Stop and ask before:

- Installing/procuring the Vercel Stripe integration.
- Connecting a live Stripe account.
- Setting prices or public plan numbers.
- Sending any outbound payment/customer communication.
- Running prod migrations or usage flush against live customer data.
- Changing strict quota posture to soft cap.
