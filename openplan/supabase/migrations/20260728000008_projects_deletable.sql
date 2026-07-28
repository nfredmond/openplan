-- A project can be deleted by the workspace that owns it.
--
-- `projects` shipped in 20260313000011 with SELECT, INSERT and UPDATE policies
-- and no DELETE policy. That was not an oversight at the time: nothing in the
-- product could delete a project, so the absent policy and the absent route
-- agreed with each other. It is the only table on the project spine in that
-- state — reports, plans, programs, models, scenario_sets and
-- engagement_campaigns all carry one.
--
-- With RLS enabled, a missing policy denies. The failure mode is the dangerous
-- kind: `DELETE ... WHERE id = $1` matching zero rows is not an error, it is a
-- successful statement that changed nothing. A delete route without this policy
-- reports success and leaves the project in place. The route now re-reads the
-- deleted row and refuses to claim otherwise, but the honest fix is for the
-- policy to exist.
--
-- Membership only, matching projects_update. The role condition is supplied by
-- the RESTRICTIVE projects_writer_only_delete policy from 20260728000006, which
-- ANDs with this one — so a viewer is still refused, and this migration cannot
-- widen who may write by accident.
--
-- What this does NOT do is make deleting safe. 16 tables cascade from projects
-- and 17 more have their project_id blanked by ON DELETE SET NULL. The decision
-- about whether a given project may be destroyed lives in
-- src/lib/projects/project-delete-preconditions.ts, which refuses any project
-- that carries anything and names what it found. This policy only makes the
-- empty case reachable.

DROP POLICY IF EXISTS "projects_delete" ON public.projects;
CREATE POLICY "projects_delete" ON public.projects
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = projects.workspace_id
        AND wm.user_id = auth.uid()
    )
  );
