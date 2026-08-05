-- Restore the audited grant posture on databases created by newer Supabase CLIs.
--
-- WHAT BROKE, PROVEN ON A PRISTINE STACK (2026-08-05, Stage B). Upgrading the
-- pinned CLI 2.76.14 -> 2.111.0 (commit 2d0049e5) changed the local bootstrap's
-- default privileges for tables the `postgres` role creates in `public`:
--
--   old bootstrap:  anon / authenticated / service_role each get FULL DML
--   new bootstrap:  postgres=arwdDxtm, anon=Dxtm, authenticated=Dxtm,
--                   service_role=Dxtm   -- i.e. NO SELECT/INSERT/UPDATE/DELETE
--                   for ANY client role, service_role included
--
-- Because default privileges apply AT CREATE TIME, every table this repo's
-- migrations create on a FRESH database now carries no client DML at all. The
-- app's server side runs as service_role, so a fresh install cannot read or
-- write a single row: the first CI run of the (newly PR-blocking) live RLS
-- suite failed exactly here — `permission denied for table workspaces` from
-- the SERVICE client. Long-lived databases (every existing deployment, and the
-- local dev stack) are grandfathered: their tables were created under the old
-- defaults and keep their grants, which is why nothing failed locally.
--
-- WHAT THIS RESTORES — the exact posture the live RLS suite audits, no wider:
--
--   * service_role: full DML on every public table, plus sequence usage. It
--     carries BYPASSRLS by design and every server-side path depends on it.
--     (BYPASSRLS bypasses row policies, never GRANTs — both gates must open.)
--   * authenticated / anon: DML on the workspace tables, where row access is
--     governed by the RLS policies this repo audits live — EXCEPT the four
--     service-role-only ledgers whose grants 20260730000008 deliberately
--     revoked, which stay revoked, and the two public reference tables whose
--     WRITES 20260730000009 revoked, which stay read-only.
--   * sequences: usage+select for the client roles (setval is deliberately NOT
--     restored to anon/authenticated — nothing legitimate calls it), full for
--     service_role.
--   * functions: untouched. Postgres's own PUBLIC-EXECUTE default covers them
--     and the sensitive ones already carry explicit REVOKE/GRANTs in their own
--     migrations (verified against a fresh stack before writing this).
--
-- FUTURE tables: 20260804000001's default-deny for anon/authenticated STANDS —
-- a new table still gets no client grants until its migration states them. Its
-- own header promised "service_role keeps its default grants"; the new CLI
-- broke that promise from underneath it, so the service_role default is
-- restored here explicitly.
--
-- Idempotent: GRANT and REVOKE re-run as no-ops. On grandfathered databases
-- every statement below is a no-op by construction.

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    BEGIN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t.tablename);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon, authenticated', t.tablename);
    EXCEPTION WHEN insufficient_privilege THEN
      -- Extension-owned tables (spatial_ref_sys is PostGIS's, owned by
      -- supabase_admin) cannot be granted by postgres and were never part of
      -- the app's surface. Skipping is correct, silence would not be:
      RAISE NOTICE 'skipping GRANT on public.% (not grantable by %)', t.tablename, current_user;
    END;
  END LOOP;
END $$;

DO $$
DECLARE
  s record;
BEGIN
  FOR s IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' LOOP
    BEGIN
      EXECUTE format('GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.%I TO service_role', s.sequencename);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO anon, authenticated', s.sequencename);
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'skipping GRANT on sequence public.% (not grantable by %)', s.sequencename, current_user;
    END;
  END LOOP;
END $$;

-- Re-assert the deliberate revocations the blanket grants above just widened,
-- so this migration composes to the AUDITED posture rather than the naive one.
-- 20260730000008 — service-role-only ledgers (RLS on, zero policies, and no
-- client grant so a future permissive policy alone cannot expose them):
REVOKE ALL ON public.assistant_action_approvals FROM anon, authenticated;
REVOKE ALL ON public.engagement_item_votes FROM anon, authenticated;
REVOKE ALL ON public.aerial_processing_callbacks FROM anon, authenticated;
REVOKE ALL ON public.billing_webhook_receipts FROM anon, authenticated;
-- 20260730000009 — public reference data: reads stay open, writes stay revoked:
REVOKE INSERT, UPDATE, DELETE ON public.census_tracts FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.lodes_od FROM anon, authenticated;

-- FUTURE tables: restore the service_role default the new CLI dropped.
-- anon/authenticated deliberately NOT restored — 20260804000001's default-deny
-- for them is this repo's own decision and stands.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO service_role;
