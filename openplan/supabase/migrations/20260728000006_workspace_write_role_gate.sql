-- The viewer tier becomes true in the database, not just in the API.
--
-- 20260728000003 added a read-only `viewer` role to the workspace role matrix,
-- and src/lib/auth/role-matrix.ts states its contract as "read everything,
-- change nothing". That contract was enforced in exactly one place: the API
-- route layer, policed by workspace-write-role-gate-guard.test.ts. The database
-- never learned about it.
--
-- Two facts made that a real hole rather than a theoretical one:
--
--   1. Supabase's ALTER DEFAULT PRIVILEGES grants ALL on every new public-schema
--      table directly to `authenticated` — the same gotcha 20260722000005 fixed
--      for functions and 20260727000013 fixed for one table. Confirmed against a
--      live database: `authenticated` holds INSERT/UPDATE/DELETE/TRUNCATE on
--      projects, plans, reports, rtp_cycles, engagement_campaigns and the rest.
--
--   2. Of the workspace-scoped write policies, 192 across 80 tables tested
--      MEMBERSHIP only and never ROLE. The single exception was
--      billing_invoice_records (20260717000082), which is the precedent this
--      migration generalizes.
--
-- With table grants wide open, RLS is the only gate, and a role-blind RLS gate
-- lets a viewer holding the public anon key and their own session JWT write
-- straight to PostgREST, past every route guard. The browser ships that anon key
-- by design (src/lib/supabase/client.ts), so this needed no privileged access.
--
-- Bounding it honestly: workspace_members carries only a SELECT policy
-- (members_read_own), so with RLS enabled every write to it is already denied.
-- A viewer could tamper with workspace CONTENT; a viewer could NOT promote
-- themselves. This is not a privilege-escalation fix.
--
-- WHY RESTRICTIVE POLICIES, AND NOT A REVOKE
--
-- Revoking write grants from `authenticated` — the 20260727000013 approach —
-- would break every write route in the product, because routes write with the
-- CALLER's client (src/app/api/projects/route.ts -> createClient()), not a
-- service-role one. That table could afford it; these cannot.
--
-- RESTRICTIVE policies AND with the existing permissive ones, so this constrains
-- 192 policies without rewriting or re-litigating a single one of them. Three
-- properties follow, and all three are the reason for this shape:
--
--   - `service_role` has rolbypassrls, so workers, the public engagement submit
--     path, and every other service-role write are untouched.
--   - Anonymous access is unaffected: every existing write policy already
--     requires auth.uid(), so `anon` was never able to write and still cannot.
--   - Policies are created for INSERT, UPDATE and DELETE on every table here,
--     whether or not a permissive policy exists for that command today. A
--     command with no permissive policy stays denied; a permissive policy added
--     LATER is constrained automatically. The guarantee is a property of the
--     table, not of the policy set at the time of writing.
--
-- Per-command rather than FOR ALL: a FOR ALL restrictive policy's USING clause
-- would also gate SELECT, which would take reading away from the very role this
-- exists to keep reading.
--
-- This migration covers the 45 tables that own a `workspace_id` column.
-- 20260728000007 covers the 35 that reach a workspace through a parent.
--
-- Six of those 45 were nearly missed. A FOR ALL policy grants writes as surely
-- as FOR INSERT does, and the inventory query that produced this list first
-- filtered on cmd IN ('INSERT','UPDATE','DELETE') — silently skipping the aerial
-- and modeling-evidence tables, every one of which is governed by FOR ALL.
-- viewer-write-denial-guard.test.ts is what caught it, and is why it counts
-- FOR ALL as a write.

-- The rank helper is already the single source of truth for role ordering
-- (owner 4, admin 3, member 2, viewer 1, unknown 0). It was revoked from
-- `authenticated` when it was only called by service-role code; an RLS policy
-- evaluates as the CALLER, so the caller now needs it. It is IMMUTABLE, takes a
-- text literal and returns an integer, so it discloses nothing.
GRANT EXECUTE ON FUNCTION public.workspace_role_rank(text) TO authenticated;

-- Whether the current actor may WRITE workspace-scoped content.
--
-- SECURITY INVOKER on purpose: it reads workspace_members as the caller, and
-- members_read_own already restricts that to the caller's own membership row —
-- exactly the row being tested. A DEFINER function would widen the read for no
-- gain and would need its own justification.
--
-- Unknown or legacy role strings rank 0 and are therefore DENIED, matching the
-- deny-by-default posture op001-role-matrix-conformance.test.ts asserts for the
-- application matrix. A NULL workspace id (a child row whose parent lookup
-- found nothing) also yields false, so the failure mode is refusal, not bypass.
CREATE OR REPLACE FUNCTION public.workspace_member_can_write(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.user_id = auth.uid()
      AND public.workspace_role_rank(wm.role) >= public.workspace_role_rank('member')
  );
$$;

COMMENT ON FUNCTION public.workspace_member_can_write(uuid) IS
  'True when the current actor holds a writing role (member or stronger) in the given workspace. Used by the RESTRICTIVE write policies that make the viewer tier real at the database layer. Unknown roles and a NULL workspace both return false.';

GRANT EXECUTE ON FUNCTION public.workspace_member_can_write(uuid) TO authenticated;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
    ('aerial_evidence_packages', 'workspace_id'),
    ('aerial_missions', 'workspace_id'),
    ('aerial_project_posture', 'workspace_id'),
    ('analyses', 'workspace_id'),
    ('client_invoices', 'workspace_id'),
    ('county_run_artifacts', 'workspace_id'),
    ('county_runs', 'workspace_id'),
    ('data_connectors', 'workspace_id'),
    ('data_datasets', 'workspace_id'),
    ('data_refresh_jobs', 'workspace_id'),
    ('document_narrative_drafts', 'workspace_id'),
    ('engagement_campaigns', 'workspace_id'),
    ('engagement_notifications', 'workspace_id'),
    ('funding_awards', 'workspace_id'),
    ('funding_opportunities', 'workspace_id'),
    ('funding_opportunity_application_exports', 'workspace_id'),
    ('funding_opportunity_application_sections', 'workspace_id'),
    ('funding_opportunity_attachments', 'workspace_id'),
    ('funding_opportunity_narrative_drafts', 'workspace_id'),
    ('funding_opportunity_section_drafts', 'workspace_id'),
    ('gtfs_feeds', 'workspace_id'),
    ('invoicing_clients', 'workspace_id'),
    ('invoicing_engagements', 'workspace_id'),
    ('invoicing_rate_tables', 'workspace_id'),
    ('invoicing_staff', 'workspace_id'),
    ('invoicing_time_entries', 'workspace_id'),
    ('model_runs', 'workspace_id'),
    ('modeling_claim_decisions', 'workspace_id'),
    ('modeling_source_manifests', 'workspace_id'),
    ('modeling_validation_results', 'workspace_id'),
    ('models', 'workspace_id'),
    ('network_packages', 'workspace_id'),
    ('plans', 'workspace_id'),
    ('programs', 'workspace_id'),
    ('project_bca_screenings', 'workspace_id'),
    ('project_corridors', 'workspace_id'),
    ('project_funding_profiles', 'workspace_id'),
    ('project_rtp_cycle_links', 'workspace_id'),
    ('projects', 'workspace_id'),
    ('reports', 'workspace_id'),
    ('rtp_cycle_chapters', 'workspace_id'),
    ('rtp_cycles', 'workspace_id'),
    ('runs', 'workspace_id'),
    ('scenario_sets', 'workspace_id'),
    ('stage_gate_decisions', 'workspace_id')
    ) AS t(tbl, ws_expr)
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I', r.tbl || '_writer_only_insert', r.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR INSERT WITH CHECK (public.workspace_member_can_write(%s))',
      r.tbl || '_writer_only_insert', r.tbl, r.ws_expr);

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I', r.tbl || '_writer_only_update', r.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR UPDATE USING (public.workspace_member_can_write(%s)) WITH CHECK (public.workspace_member_can_write(%s))',
      r.tbl || '_writer_only_update', r.tbl, r.ws_expr, r.ws_expr);

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I', r.tbl || '_writer_only_delete', r.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR DELETE USING (public.workspace_member_can_write(%s))',
      r.tbl || '_writer_only_delete', r.tbl, r.ws_expr);
  END LOOP;
END
$$;
