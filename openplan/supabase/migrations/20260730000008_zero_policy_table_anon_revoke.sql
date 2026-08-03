-- Four service-role-only tables stop being reachable by `anon` and
-- `authenticated` at all, rather than being reachable and returning nothing.
--
-- WHAT WAS ALREADY TRUE. All four have RLS enabled and ZERO policies, which in
-- Postgres means deny-all for every role that does not bypass RLS. Verified live
-- against PostgREST on 2026-08-03, as `anon` AND as an authenticated workspace
-- owner who owns the underlying rows: `assistant_action_approvals`,
-- `engagement_item_votes`, `aerial_processing_callbacks` and
-- `billing_webhook_receipts` each answer `200 []`. Nothing leaks today. The
-- authenticated-owner result is the important half — it proves these tables have
-- no legitimate non-service reader to lock out.
--
-- WHY 200-AND-EMPTY IS NOT GOOD ENOUGH HERE. Each table inherits Supabase's
-- default grants and holds the full set for both roles —
-- DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE. The only thing
-- standing between an anonymous caller and this data is the *absence* of a
-- policy. That is one careless `CREATE POLICY … USING (true)` away from total
-- exposure, written by someone who reasonably assumes a grant implies an
-- intended audience. Nothing would fail loudly when it happened. A grant plus a
-- deny-all that a future migration may edit is one mistake deep; no grant AND
-- deny-all are two defences that fail independently.
--
-- WHAT IS IN THESE TABLES.
--   * `assistant_action_approvals` — the consent records that gate every
--     assistant write, carrying the input hash that makes what a planner
--     approved provably what they saw. A caller who could edit a row here could
--     make an action the planner never saw pass verification.
--   * `engagement_item_votes` — members of the public voting on an agency's
--     engagement items, with the per-voter fingerprint used to deduplicate. It
--     is public-participation data about identifiable sessions, and a writable
--     vote table is a ballot box with the lid off.
--   * `aerial_processing_callbacks` — the worker callback ledger for imagery
--     processing over an agency's jurisdiction.
--   * `billing_webhook_receipts` — dead Stripe-era schema no code reads (see
--     20260730000007). Dead schema with live anonymous grants is still an
--     attack surface; it is exactly the table nobody will think to re-check.
--
-- THE PRECEDENT THIS MATCHES. 20260730000005 (aerial artifact custody) and
-- 20260729000004 (engagement content translations) revoke anonymous grants for
-- this same reason, and the custody audit recorded that being stricter than its
-- neighbours was the point.
--
-- WHAT THIS DOES NOT CHANGE. Every writer of all four tables is the service
-- role, which bypasses both grants and RLS — verified by reading the call sites:
-- `src/app/api/assistant/actions/approvals/route.ts` and
-- `src/lib/assistant/action-approval-server.ts` (approvals),
-- `src/app/api/engage/[shareToken]/items/[itemId]/vote/route.ts` (votes),
-- `src/app/api/aerial/processing-callback/{route,custody/route}.ts`
-- (callbacks), and nothing at all for the dead receipts table. Because there are
-- zero policies, no member could read these rows before this migration either,
-- so this revoke cannot take away access anyone had. No application code
-- changes.

revoke all on public.assistant_action_approvals from anon, authenticated;
revoke all on public.engagement_item_votes from anon, authenticated;
revoke all on public.aerial_processing_callbacks from anon, authenticated;
revoke all on public.billing_webhook_receipts from anon, authenticated;

-- Belt and braces, matching 20260730000005: PostgREST reaches tables as `anon`
-- for unauthenticated requests, and a grant to `public` would hand the
-- privileges straight back to every role including the two revoked above.
revoke all on public.assistant_action_approvals from public;
revoke all on public.engagement_item_votes from public;
revoke all on public.aerial_processing_callbacks from public;
revoke all on public.billing_webhook_receipts from public;
