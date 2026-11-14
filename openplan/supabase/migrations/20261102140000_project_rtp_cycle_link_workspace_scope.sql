-- Keep every RTP project link inside one workspace (KI-2026-11-02-053).
--
-- project_rtp_cycle_links (20260409000036) carries its own workspace_id beside
-- plain foreign keys to projects and rtp_cycles, and its INSERT and UPDATE
-- policies check only that the caller belongs to the workspace the row names.
-- Through the Data API a member of one workspace could therefore store a link
-- that names their own workspace and another workspace's cycle (the row then
-- appears on that cycle's public plan pages) or another workspace's project
-- (whose name, summary and site the service-role public pages embed). The app
-- route already refuses both (src/app/api/projects/[projectId]/rtp-links/
-- route.ts: the project and cycle are read through RLS and the cycle must share
-- the project's workspace; the band and the evidence run are checked the same
-- way). A constraint outlives a route, so the database now refuses the row.
--
-- A link row is refused on INSERT, and on UPDATE of any column that names
-- another record, unless:
--   - its project and its cycle belong to the workspace the row names;
--   - a horizon band, when set, belongs to the same cycle and workspace;
--   - an evidence model run, when set, belongs to the same workspace.
-- A project or cycle that has links cannot move to another workspace.
--
-- Rows already stored are not checked or rewritten here. The install packet
-- counts them first; the expected count is zero. An existing mismatched row
-- would still be refused by any later UPDATE of a named column, including the
-- ON DELETE SET NULL of its band or run.
--
-- The guard refuses a parent that EXISTS in another workspace. A missing parent
-- is left to the foreign keys, which refuse it at the end of the statement on
-- INSERT and UPDATE. That keeps cascades working: deleting a workspace or a
-- cycle can delete a project or band and then set a link's band or run to NULL
-- in the same statement, before the link itself is deleted.
--
-- SECURITY DEFINER so the comparison reads the real workspace of each parent,
-- not the caller's RLS view of it, and gives the same answer to every caller.
-- EXECUTE is revoked from every client role; a trigger does not need it to
-- fire. A restore that loads rows with session_replication_role = replica, as
-- scripts/ops/disposable-restore-drill.sh does, does not fire these triggers.

CREATE OR REPLACE FUNCTION public.guard_project_rtp_cycle_link_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF EXISTS (
       SELECT 1 FROM public.projects p
       WHERE p.id = NEW.project_id AND p.workspace_id <> NEW.workspace_id
     )
     OR EXISTS (
       SELECT 1 FROM public.rtp_cycles c
       WHERE c.id = NEW.rtp_cycle_id AND c.workspace_id <> NEW.workspace_id
     )
     OR EXISTS (
       SELECT 1 FROM public.rtp_horizon_bands b
       WHERE b.id = NEW.horizon_band_id
         AND (b.rtp_cycle_id <> NEW.rtp_cycle_id OR b.workspace_id <> NEW.workspace_id)
     )
     OR EXISTS (
       SELECT 1 FROM public.model_runs r
       WHERE r.id = NEW.evidence_model_run_id AND r.workspace_id <> NEW.workspace_id
     )
  THEN
    RAISE EXCEPTION 'An RTP project link must stay inside one workspace'
      USING ERRCODE = '23514',
            DETAIL = 'The project, cycle, horizon band and evidence run must all belong to the workspace the link names.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_project_rtp_cycle_link_scope() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS project_rtp_cycle_links_workspace_scope ON public.project_rtp_cycle_links;
CREATE TRIGGER project_rtp_cycle_links_workspace_scope
  BEFORE INSERT OR UPDATE OF workspace_id, project_id, rtp_cycle_id, horizon_band_id, evidence_model_run_id
  ON public.project_rtp_cycle_links
  FOR EACH ROW EXECUTE FUNCTION public.guard_project_rtp_cycle_link_scope();

CREATE OR REPLACE FUNCTION public.guard_rtp_link_parent_workspace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id AND EXISTS (
    SELECT 1 FROM public.project_rtp_cycle_links l
    WHERE (TG_TABLE_NAME = 'projects' AND l.project_id = OLD.id)
       OR (TG_TABLE_NAME = 'rtp_cycles' AND l.rtp_cycle_id = OLD.id)
  ) THEN
    RAISE EXCEPTION 'A project or RTP cycle with RTP project links cannot move to another workspace'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_rtp_link_parent_workspace() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS projects_rtp_link_workspace ON public.projects;
CREATE TRIGGER projects_rtp_link_workspace
  BEFORE UPDATE OF workspace_id ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.guard_rtp_link_parent_workspace();

DROP TRIGGER IF EXISTS rtp_cycles_rtp_link_workspace ON public.rtp_cycles;
CREATE TRIGGER rtp_cycles_rtp_link_workspace
  BEFORE UPDATE OF workspace_id ON public.rtp_cycles
  FOR EACH ROW EXECUTE FUNCTION public.guard_rtp_link_parent_workspace();
