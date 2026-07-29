-- Two tables that routes UPDATE had no PERMISSIVE UPDATE policy at all.
--
-- Postgres composes RLS as: at least one PERMISSIVE policy must pass, and then
-- every RESTRICTIVE policy must also pass. A RESTRICTIVE policy can only ever
-- SUBTRACT. So a table carrying `<tbl>_writer_only_update` (20260728000006) and
-- no permissive partner accepts no updates from `authenticated` at all — the
-- row set is filtered to empty before the restrictive gate is even consulted.
--
-- The table-level UPDATE grant is present, so this is not a 42501 "permission
-- denied". It is an UPDATE that matches zero rows, which Postgres reports as a
-- SUCCESSFUL statement and PostgREST returns as 204. supabase-js hands the
-- caller `error: null`.
--
--   runs                    — /api/runs PATCH saves Analysis Studio map view
--                             state, has no .select() to count rows, and
--                             returns {success:true} while also audit-logging
--                             `run_updated`. It has silently discarded every
--                             save, for every user of every role, since the
--                             feature shipped. The audit log actively lied.
--
--   project_rtp_cycle_links — the same missing policy, but the route chains
--                             .select().single(), so zero rows surfaces as
--                             PGRST116 and answers HTTP 500. Broken loudly
--                             rather than silently, and MISCLASSIFIED: an
--                             authorization denial reported as a server error,
--                             with an audit code that points at result
--                             cardinality instead of at the missing policy.
--
-- 20260728000006's own header predicted this and accepted it deliberately:
-- "Policies are created for INSERT, UPDATE and DELETE on every table here,
-- whether or not a permissive policy exists for that command today. A command
-- with no permissive policy stays denied; a permissive policy added LATER is
-- constrained automatically." The gate is correct. The missing partner is the
-- defect, and this migration supplies it.
--
-- The predicate below is MEMBERSHIP only, matching each table's existing
-- `_insert` policy exactly. It deliberately does NOT call
-- workspace_member_can_write: the RESTRICTIVE `_writer_only_update` policy
-- already supplies the role check and will constrain these automatically.
-- Duplicating it here would create a second place for the writer rule to drift
-- from the one `viewer-write-denial-guard.test.ts` reasons about.
--
-- Guarded with IF NOT EXISTS so re-running against a database that already has
-- them is a no-op, matching the house style of 20260409000036.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'runs' AND policyname = 'runs_update'
  ) THEN
    CREATE POLICY runs_update ON runs
      FOR UPDATE
      USING (
        workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
      )
      WITH CHECK (
        workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'project_rtp_cycle_links'
      AND policyname = 'project_rtp_cycle_links_update'
  ) THEN
    CREATE POLICY project_rtp_cycle_links_update ON project_rtp_cycle_links
      FOR UPDATE
      USING (
        workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
      )
      WITH CHECK (
        workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
      );
  END IF;
END
$$;
