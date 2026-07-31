-- Say, in the schema itself, which billing-named objects are dead and which are
-- load-bearing — because the names do not tell you and two of them hold real data.
--
-- WHY THIS EXISTS
--   The Stripe/billing subsystem was deleted from the CODE in 2026-07-24. The
--   TABLES were deliberately left: dead schema no code reads is inert, and
--   dropping columns is irreversible against a hosted database. That decision
--   stands and this migration does not revisit it — nothing here drops anything.
--
--   What was never done is labelling them. Five tables match a
--   billing/subscription name search, and a maintainer reading the schema cold
--   cannot tell them apart:
--
--     billing_events            DEAD  (0 rows)
--     billing_webhook_receipts  DEAD  (11 rows — NOT empty)
--     subscriptions             DEAD  (0 rows)
--     billing_invoice_records   LIVE  (10 rows) — Caltrans LAPM grant invoicing
--     engagement_subscriptions  LIVE          — residents' campaign notifications
--
--   A cleanup pass that pattern-matched those names would destroy an agency's
--   grant-reimbursement register and a list of members of the public's email
--   addresses and unsubscribe tokens. The warning currently lives only in
--   CLAUDE.md, which is not where somebody doing schema surgery is looking.
--
-- TWO EXISTING COMMENTS ARE ACTIVELY WRONG, WHICH IS WORSE THAN MISSING
--   `subscriptions` is described as a "Normalized per-workspace subscription
--   ledger ... mirrored to workspaces billing snapshot columns", in the present
--   tense, and `billing_webhook_receipts` describes a live webhook handler using
--   a service-role key. Both describe a subsystem that no longer exists. A
--   comment that is merely absent makes a reader look; one that is confidently
--   wrong makes them stop looking.
--
--   Updating them is NOT the falsification CLAUDE.md prohibits. That rule
--   protects DATED RECORDS — a document asserting what was true on a given day.
--   A table comment is live metadata describing current state, and current state
--   changed. Correcting it is the same act as fixing any other stale docstring.
--
-- WHY NOT JUST DROP THEM, since two are empty
--   `billing_webhook_receipts` has 11 rows, so even a drop-if-empty guard would
--   not fire on it. And deployment makes this stricter rather than looser: once
--   agencies self-host, a destructive migration ships to databases nobody can
--   inspect or roll back. Labelling costs nothing and is reversible; dropping is
--   neither.

comment on table public.billing_events is
  'DEAD — residue of the deleted Stripe subsystem (removed from code 2026-07-24). Nothing reads or writes this. OpenPlan is free and has no paid tier; src/test/no-paid-tier-guard.test.ts fails the build if billing code returns. Retained because dropping is irreversible against a hosted database. Do NOT confuse with billing_invoice_records, which is live.';

comment on table public.billing_webhook_receipts is
  'DEAD — residue of the deleted Stripe subsystem (removed from code 2026-07-24). The webhook handler this describes no longer exists; the previous comment described it in the present tense. Holds ~11 historical rows, so it is NOT empty — a drop-if-empty sweep would not fire. Retained because dropping is irreversible against a hosted database.';

comment on table public.subscriptions is
  'DEAD — residue of the deleted Stripe subsystem (removed from code 2026-07-24). Nothing mirrors to the workspaces billing columns any more; the previous comment described that mirroring in the present tense. OpenPlan has no plan, seat count, quota or payment step. Retained because dropping is irreversible against a hosted database.';

comment on table public.billing_invoice_records is
  'LIVE AND LOAD-BEARING — this is NOT billing in the Stripe sense. It is Caltrans LAPM grant-reimbursement invoicing: the agency invoicing ITS OWN FUNDER for work already delivered. Read and written by src/lib/invoicing/ behind /invoicing. Nobody is charged for OpenPlan. Do not include this in any billing cleanup.';

comment on table public.engagement_subscriptions is
  'LIVE AND LOAD-BEARING — this is NOT billing. It is members of the public subscribing to updates on an engagement campaign: email address, confirmation token, unsubscribe token. Sensitive resident contact data, touched only by src/lib/notifications/engagement.ts. Do not include this in any billing cleanup.';

-- The workspaces columns are on a table with real rows in every deployment, so a
-- reader meets them constantly. Each says what it is and that nothing reads it.
comment on column public.workspaces.plan is
  'DEAD — Stripe-era plan tier. No code reads it. OpenPlan has no paid tier; the only run limit is the optional operator env cap in src/lib/config/run-cap.ts, which is configuration and not a tier.';
comment on column public.workspaces.subscription_plan is
  'DEAD — Stripe-era. No code reads it. See workspaces.plan.';
comment on column public.workspaces.subscription_status is
  'DEAD — Stripe-era. No code reads it. Five routes once answered 402 Payment Required from this column; that subsystem is deleted and a guard fails the build if a 402 returns.';
comment on column public.workspaces.stripe_customer_id is
  'DEAD — Stripe-era. No code reads it.';
comment on column public.workspaces.stripe_subscription_id is
  'DEAD — Stripe-era. No code reads it.';
comment on column public.workspaces.subscription_current_period_end is
  'DEAD — Stripe-era. No code reads it.';
comment on column public.workspaces.billing_updated_at is
  'DEAD — Stripe-era. No code reads it. Unrelated to billing_invoice_records, which is live LAPM grant invoicing.';
