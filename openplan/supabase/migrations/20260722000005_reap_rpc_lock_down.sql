-- Harden reap_model_run_if_stale (Wave 2 pilot hardening — security follow-up).
--
-- Migration 20260722000004 did `REVOKE ALL ... FROM PUBLIC` intending to lock
-- the reaper to the service role, but Supabase's ALTER DEFAULT PRIVILEGES grant
-- EXECUTE on every new public-schema function directly to `anon` and
-- `authenticated`. Those are SEPARATE grants that a revoke-from-PUBLIC does not
-- remove — so `anon` (the unauthenticated PostgREST key) could still call
-- /rpc/reap_model_run_if_stale and force any queued/running run to `failed`
-- (pass a far-future p_stale_before to satisfy the freshness guard). Revoke the
-- role grants explicitly so only the service role can reap runs.

revoke all on function public.reap_model_run_if_stale(uuid, timestamptz, text) from anon, authenticated;
grant execute on function public.reap_model_run_if_stale(uuid, timestamptz, text) to service_role;
