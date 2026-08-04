-- Default-deny for FUTURE tables: new tables stop being born world-writable.
--
-- Supabase's bootstrap configures default privileges so that every table the
-- `postgres` role creates in `public` is granted FULL DML (`arwdDxtm`) to
-- `anon` and `authenticated` at creation. Migrations 20260730000008/9 revoked
-- those grants per-table BY NAME for the tables that existed then — and their
-- own header calls the underlying condition "one careless CREATE POLICY …
-- USING (true) away from total exposure." Nothing prevented the NEXT table
-- from regrowing the same grants silently (2026-08-03 review, default-
-- privileges gap).
--
-- This migration changes the default for tables and sequences created from
-- now on by `postgres` — which is the role every CLI-applied migration and
-- every Studio SQL statement runs as, i.e. the only path application tables
-- are created through. From here forward:
--
--   * A new table gets NO grants to anon/authenticated at birth. The
--     migration that creates it must GRANT exactly what it intends —
--     deny-by-default with explicit grants, the second lock the 0008 header
--     asked for. Forgetting the grant fails LOUD (permission denied on
--     first use in dev), never silent-exposed.
--   * Existing tables are untouched: their grants were already correct
--     (armed RLS everywhere per the migration inventory guard) or already
--     revoked (0008/0009).
--   * `service_role` keeps its default grants — it bypasses RLS by design
--     and the app's server-side paths depend on it.
--   * FUNCTION defaults (EXECUTE to anon/authenticated) are deliberately
--     left: RPCs are SECURITY INVOKER by default so RLS still governs the
--     rows they touch, and revoking would break every future RPC in a way
--     that invites blanket re-grants. Narrowing function defaults is its
--     own decision for its own migration.
--   * `supabase_admin`'s default ACLs are deliberately left: that role
--     creates Supabase-internal objects, not application tables, and on
--     hosted projects `postgres` may not alter another role's defaults.
--
-- Idempotent: ALTER DEFAULT PRIVILEGES … REVOKE re-runs as a no-op.
-- Enforced live by the pg_default_acl assertion in
-- src/test/policies-are-enforced-guard.test.ts (test:rls-live / nightly).

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
