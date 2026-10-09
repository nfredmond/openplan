-- Cross-table CHECK functions can reject valid rows during pg_restore before
-- their projects are loaded. Foreign keys retain this scope invariant and are
-- restored after table data. Validate replacements before removing old checks.
BEGIN;

ALTER TABLE public.projects
  ADD CONSTRAINT projects_id_workspace_restore_key UNIQUE (id, workspace_id);

ALTER TABLE public.runs
  ADD CONSTRAINT runs_project_workspace_fk
  FOREIGN KEY (project_id, workspace_id)
  REFERENCES public.projects (id, workspace_id)
  ON DELETE SET NULL (project_id) NOT VALID;
ALTER TABLE public.runs
  VALIDATE CONSTRAINT runs_project_workspace_fk;

ALTER TABLE public.model_runs
  ADD CONSTRAINT model_runs_project_workspace_fk
  FOREIGN KEY (project_id, workspace_id)
  REFERENCES public.projects (id, workspace_id)
  ON DELETE SET NULL (project_id) NOT VALID;
ALTER TABLE public.model_runs
  VALIDATE CONSTRAINT model_runs_project_workspace_fk;

ALTER TABLE public.county_runs
  ADD CONSTRAINT county_runs_project_workspace_fk
  FOREIGN KEY (project_id, workspace_id)
  REFERENCES public.projects (id, workspace_id)
  ON DELETE SET NULL (project_id) NOT VALID;
ALTER TABLE public.county_runs
  VALIDATE CONSTRAINT county_runs_project_workspace_fk;

ALTER TABLE public.stage_gate_decisions
  ADD CONSTRAINT stage_gate_decisions_project_workspace_fk
  FOREIGN KEY (project_id, workspace_id)
  REFERENCES public.projects (id, workspace_id)
  ON DELETE CASCADE NOT VALID;
ALTER TABLE public.stage_gate_decisions
  VALIDATE CONSTRAINT stage_gate_decisions_project_workspace_fk;

ALTER TABLE public.runs DROP CONSTRAINT runs_project_workspace_match;
ALTER TABLE public.model_runs DROP CONSTRAINT model_runs_project_workspace_match;
ALTER TABLE public.county_runs DROP CONSTRAINT county_runs_project_workspace_match;
ALTER TABLE public.stage_gate_decisions DROP CONSTRAINT stage_gate_decisions_project_workspace_match;

COMMIT;
