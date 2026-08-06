-- Restore the client-role revocations that 20260804000002 widened.
--
-- WHAT HAPPENED. 20260804000002 had to put back the client grants the Supabase
-- CLI dropped when it changed default privileges under this project. It did that
-- by looping every table in `public`:
--
--     FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
--       EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon, authenticated', …)
--
-- and then re-asserted the deliberate revocations from two earlier migrations
-- (20260730000008's service-role-only ledgers, 20260730000009's public reference
-- data). Those two are correct and remain correct. But this repository contains
-- roughly twenty-six such revocations, written across eleven months, and the
-- other twenty-odd were silently widened. Measured against the migration corpus:
-- 191 (table, role, privilege) triples across 31 tables and 54 (table, role)
-- pairs are held in contradiction of an explicit REVOKE. The same 191/31/54 was
-- reached independently from the live catalog's `pg_class.relacl`, which is why
-- these numbers are stated as fact rather than as an estimate.
--
-- HOW BAD IT ACTUALLY IS — stated precisely, because overstating a security
-- finding costs as much as missing one. Almost all of it is inert:
--
--   * `anon` is a NOLOGIN role reached only through PostgREST after JWT
--     validation, and every permissive write policy in `public` is auth-bound
--     (directly via auth.uid(), or through workspace_member_can_write() which
--     calls it). `auth.uid()` is NULL for `anon`, so `anon` can perform no write
--     anywhere in `public` no matter what it has been granted.
--   * Nine of these tables have RLS on and ZERO policies, so every command
--     including SELECT is refused regardless of grants.
--
-- ONE ITEM IS A LIVE WRITE PATH, and it is the reason this migration is not
-- merely hygiene. 20260727000013 gave `authenticated` `SELECT, INSERT` plus a
-- COLUMN-SCOPED `GRANT UPDATE (status, accepted_markdown, accepted_by,
-- accepted_at)` on `document_narrative_drafts`, and said why in its own header:
-- "the draft body, its grounding record, and its facts hash are immutable to
-- members." The blanket loop replaced that with a table-level UPDATE. A member
-- with write access can therefore PATCH `grounding_json` directly, set
-- `is_fully_grounded` and `faithfulness_checked` true, and then accept the draft
-- as-is — putting machine-drafted narrative into a funder-facing packet with the
-- citation-grounding and faithfulness gate bypassed, while the ledger records it
-- as grounded. That is a provenance promotion, which is the class this codebase
-- treats most seriously. DELETE on the same table is not reachable: it has a
-- restrictive DELETE policy and no permissive partner, so it matches zero rows.
--
-- WHY REVOKING IS SAFE. Every table below was checked for application writers on
-- a caller-RLS (non-service-role) client using the repo's own AST tool
-- (`collectSupabaseWriteSites`): 49 write sites across the 33 candidates, every
-- one either service-role or still granted here. The historical argument is
-- stronger still — each of these revocations was in force from its own migration
-- date until 2026-08-04, so this restores a posture the system demonstrably ran
-- in for weeks to months.
--
-- THREE THINGS A FUTURE READER WILL WANT EXPLAINED.
--
-- 1. SELECT is preserved wherever it was granted on purpose. `REVOKE ALL` would
--    have been shorter and wrong: `workspace_invitations`, `subscriptions` and
--    `usage_events` grant `authenticated` a deliberate SELECT, and the eight GTFS
--    child tables are readable by design (a feed with workspace_id IS NULL is
--    public reference data). Only the privileges the corpus actually denied are
--    revoked, which is also what makes this file's effect equal on a fresh and a
--    grandfathered database.
--
-- 2. The bootstrap `arwdDxtm` residue on the ~110 tables no migration ever
--    revoked is deliberately NOT converged down to what those migrations granted.
--    That is a much larger change with its own blast radius, the residue is
--    unreachable through PostgREST anyway, and doing it here would bury the one
--    live fix inside a hundred cosmetic ones. Recorded as a decision so nobody
--    later reads its absence as an oversight. Related and also measured, also
--    deliberately deferred: 258 (table, role, command) triples across 59 tables
--    hold a client write grant with no permissive policy for that command. That
--    is a real tightening, but expressing it would need a 59-entry allowlist,
--    which is the shape this repo has learned not to build. What IS adopted, as
--    an absolute rule with no exceptions, is the strictly-worst subset: a table
--    with RLS on and zero policies may hold no client grant at all. See
--    `policies-are-enforced-guard.test.ts`.
--
-- 3. `spatial_ref_sys`, `geometry_columns` and `geography_columns` are NOT
--    touched. They are PostGIS's, owned by `supabase_admin`; `postgres` holds
--    their privileges without grant option, so a REVOKE here would emit
--    "no privileges could be revoked" and change nothing — and would then sit in
--    the corpus as a denial the guard could never see satisfied. PostGIS living
--    in `public` is a Supabase platform default; it is tracked separately and is
--    not something a migration in this repository can fix.
--
-- THE GUARD THAT MAKES THIS THE LAST TIME. `src/test/migrations/grant-inventory.ts`
-- replays every GRANT and REVOKE in the corpus, in application order, and
-- `inventory.test.ts` asserts the invariant this file satisfies:
--
--     any (table, role, privilege) a migration REVOKED may be held at HEAD only
--     if a later statement granted it BY NAME.
--
-- A blanket grant says nothing about any particular table, so it can never
-- re-establish a deliberate denial. Blanket grants stay legal — the next platform
-- change will need one — they just have to compose. When the guard fails it
-- prints the exact REVOKE block that would fix it, so the author of the next one
-- never types a table name twice. This file's body was generated by that guard.

BEGIN;

-- ── Access-request intake (20260424000074, 20260424000076) ───────────────────
-- Service-role only, RLS on with zero policies.
REVOKE DELETE, INSERT, SELECT, UPDATE ON public.access_requests FROM anon;
REVOKE DELETE, INSERT, SELECT, UPDATE ON public.access_requests FROM authenticated;
REVOKE DELETE, INSERT, SELECT, UPDATE ON public.access_request_review_events FROM anon;
REVOKE DELETE, INSERT, SELECT, UPDATE ON public.access_request_review_events FROM authenticated;

-- ── Members of the public: their email addresses, their answers, their
--    demographics (20260719000094, 20260722000007, 20260722000009, 20260730000003)
-- Every writer is a service-role route behind a share token. RLS on, zero
-- policies, so this is the second lock rather than the first — which is the point.
REVOKE DELETE, INSERT, SELECT, UPDATE ON public.engagement_subscriptions FROM anon;
REVOKE DELETE, INSERT, SELECT, UPDATE ON public.engagement_subscriptions FROM authenticated;
REVOKE DELETE, INSERT, SELECT, UPDATE ON public.engagement_email_outbox FROM anon;
REVOKE DELETE, INSERT, SELECT, UPDATE ON public.engagement_email_outbox FROM authenticated;
REVOKE DELETE, INSERT, SELECT, UPDATE ON public.engagement_item_demographics FROM anon;
REVOKE DELETE, INSERT, SELECT, UPDATE ON public.engagement_item_demographics FROM authenticated;
REVOKE DELETE, INSERT, SELECT, UPDATE ON public.engagement_survey_response_sessions FROM anon;
REVOKE DELETE, INSERT, SELECT, UPDATE ON public.engagement_survey_response_sessions FROM authenticated;
REVOKE DELETE, INSERT, SELECT, UPDATE ON public.engagement_survey_answers FROM anon;
REVOKE DELETE, INSERT, SELECT, UPDATE ON public.engagement_survey_answers FROM authenticated;
REVOKE DELETE, INSERT, SELECT, UPDATE ON public.engagement_survey_response_drafts FROM anon;
REVOKE DELETE, INSERT, SELECT, UPDATE ON public.engagement_survey_response_drafts FROM authenticated;

-- ── Integration secrets (20260728000001) ─────────────────────────────────────
-- Read and written only through createServiceRoleClient().
REVOKE DELETE, INSERT, SELECT, UPDATE ON public.workspace_integration_keys FROM anon;
REVOKE DELETE, INSERT, SELECT, UPDATE ON public.workspace_integration_keys FROM authenticated;

-- ── Invitation tokens (20260424000073) ───────────────────────────────────────
-- `authenticated` keeps SELECT: /api/workspaces/invitations lists them on the
-- caller's own client. Every write goes through the service role.
REVOKE DELETE, INSERT, SELECT, UPDATE ON public.workspace_invitations FROM anon;
REVOKE DELETE, INSERT, UPDATE ON public.workspace_invitations FROM authenticated;

-- ── Dead billing schema (20260424000072) ─────────────────────────────────────
-- No code reads or writes these; kept because dropping schema against a hosted
-- database is irreversible. `authenticated` keeps the SELECT it was granted.
REVOKE DELETE, INSERT, SELECT, UPDATE ON public.subscriptions FROM anon;
REVOKE DELETE, INSERT, UPDATE ON public.subscriptions FROM authenticated;
REVOKE DELETE, INSERT, SELECT, UPDATE ON public.usage_events FROM anon;
REVOKE DELETE, INSERT, UPDATE ON public.usage_events FROM authenticated;

-- ── anon-only lockdowns: operator surfaces whose `authenticated` grants are
--    the intended surface (20260717000083, 20260718000089, 20260728000012,
--    20260729000002, 20260729000004, 20260730000005, 20260727000014) ──────────
REVOKE DELETE, INSERT, SELECT, UPDATE ON public.aerial_artifact_custody FROM anon;
REVOKE DELETE, INSERT, SELECT, UPDATE ON public.engagement_content_translations FROM anon;
REVOKE DELETE, INSERT, SELECT, UPDATE ON public.engagement_context_layers FROM anon;
REVOKE DELETE, INSERT, SELECT, UPDATE ON public.vmt_significance_screenings FROM anon;
REVOKE DELETE, INSERT, SELECT, UPDATE ON public.project_bca_screenings FROM anon;
REVOKE DELETE, INSERT, SELECT, UPDATE ON public.funding_opportunity_narrative_drafts FROM anon;
REVOKE DELETE, INSERT, SELECT, UPDATE ON public.funding_opportunity_application_sections FROM anon;
REVOKE DELETE, INSERT, SELECT, UPDATE ON public.funding_opportunity_attachments FROM anon;

-- ── Append-only from the client (20260727000014) ─────────────────────────────
-- These two are INSERT+SELECT for `authenticated` by design; no route updates or
-- deletes them. Restoring that keeps a future permissive UPDATE policy from
-- silently becoming a live edit path.
REVOKE DELETE, INSERT, SELECT, UPDATE ON public.funding_opportunity_section_drafts FROM anon;
REVOKE DELETE, UPDATE ON public.funding_opportunity_section_drafts FROM authenticated;
REVOKE DELETE, INSERT, SELECT, UPDATE ON public.funding_opportunity_application_exports FROM anon;
REVOKE DELETE, UPDATE ON public.funding_opportunity_application_exports FROM authenticated;

-- ── The one live write path (20260727000013) ─────────────────────────────────
-- ORDER MATTERS AND THE ORDER IS THE WHOLE POINT. Postgres: "When revoking
-- privileges on a table, the corresponding column privileges are automatically
-- revoked on each column of the table as well." So the table-level REVOKE below
-- destroys the four column grants that ARE the control, and they must be
-- re-granted immediately after. A bare revoke here would leave members unable to
-- accept a narrative draft at all.
--
-- Verified before writing this: the only two caller-RLS updates in the codebase
-- (reports/[reportId]/narrative-draft/[draftId] and
-- rtp-cycles/[rtpCycleId]/chapters/[chapterId]/draft) set exactly these four
-- columns or a subset, and the table carries no trigger that would touch others.
REVOKE DELETE, INSERT, SELECT, UPDATE ON public.document_narrative_drafts FROM anon;
REVOKE DELETE, UPDATE ON public.document_narrative_drafts FROM authenticated;
GRANT UPDATE (status, accepted_markdown, accepted_by, accepted_at)
  ON public.document_narrative_drafts TO authenticated;

-- ── GTFS child tables (20260730000010) ───────────────────────────────────────
-- SELECT stays for both roles: a feed with workspace_id IS NULL is public
-- reference data and the child policies inherit that. Writes are service-role.
-- This is the revoke whose own header argued at length that RLS and the grant
-- fail independently — and then it was the one the re-assertion list omitted.
REVOKE DELETE, INSERT, UPDATE ON public.agencies FROM anon, authenticated;
REVOKE DELETE, INSERT, UPDATE ON public.routes FROM anon, authenticated;
REVOKE DELETE, INSERT, UPDATE ON public.stops FROM anon, authenticated;
REVOKE DELETE, INSERT, UPDATE ON public.trips FROM anon, authenticated;
REVOKE DELETE, INSERT, UPDATE ON public.stop_times FROM anon, authenticated;
REVOKE DELETE, INSERT, UPDATE ON public.shapes FROM anon, authenticated;
REVOKE DELETE, INSERT, UPDATE ON public.calendar FROM anon, authenticated;
REVOKE DELETE, INSERT, UPDATE ON public.calendar_dates FROM anon, authenticated;

COMMIT;
