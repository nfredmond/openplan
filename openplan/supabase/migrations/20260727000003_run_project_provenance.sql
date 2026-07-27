-- Run provenance: every run table learns which project produced it.
--
-- runs (Analysis Studio), model_runs (worker runs), and county_runs
-- (county validation) each gain a nullable project_id. This is the
-- provenance half of run convergence — the citation half (reports citing
-- worker runs) rides on report_runs in the next migration. Nullable
-- because runs can legitimately be exploratory, workspace-scoped work;
-- NULL means "not attributed to a project", never a guess.
--
-- Additive only: no drops, no backfill (pre-existing runs stay
-- unattributed — attributing them retroactively would be invention).

ALTER TABLE public.runs
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL;

ALTER TABLE public.model_runs
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL;

ALTER TABLE public.county_runs
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_runs_project_created_at
  ON public.runs (project_id, created_at DESC)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_model_runs_project_created_at
  ON public.model_runs (project_id, created_at DESC)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_county_runs_project_created_at
  ON public.county_runs (project_id, created_at DESC)
  WHERE project_id IS NOT NULL;

-- A run may only be attributed to a project in its own workspace.
-- Plain STABLE SQL, not SECURITY DEFINER, not used in RLS — the same
-- shape as report_modeling_county_run_matches_workspace (20260424000070).
CREATE OR REPLACE FUNCTION public.run_project_matches_workspace(
  p_workspace_id UUID,
  p_project_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT
    p_project_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = p_project_id
        AND p.workspace_id = p_workspace_id
    );
$$;

REVOKE ALL ON FUNCTION public.run_project_matches_workspace(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_project_matches_workspace(UUID, UUID) TO authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'runs_project_workspace_match'
  ) THEN
    ALTER TABLE public.runs
      ADD CONSTRAINT runs_project_workspace_match
      CHECK (public.run_project_matches_workspace(workspace_id, project_id));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'model_runs_project_workspace_match'
  ) THEN
    ALTER TABLE public.model_runs
      ADD CONSTRAINT model_runs_project_workspace_match
      CHECK (public.run_project_matches_workspace(workspace_id, project_id));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'county_runs_project_workspace_match'
  ) THEN
    ALTER TABLE public.county_runs
      ADD CONSTRAINT county_runs_project_workspace_match
      CHECK (public.run_project_matches_workspace(workspace_id, project_id));
  END IF;
END
$$;
