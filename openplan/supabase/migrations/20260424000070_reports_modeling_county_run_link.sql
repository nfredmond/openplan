ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS modeling_county_run_id UUID REFERENCES public.county_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS reports_modeling_county_run_idx
  ON public.reports (modeling_county_run_id)
  WHERE modeling_county_run_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.report_modeling_county_run_matches_workspace(
  p_workspace_id UUID,
  p_county_run_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT
    p_county_run_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.county_runs cr
      WHERE cr.id = p_county_run_id
        AND cr.workspace_id = p_workspace_id
    );
$$;

REVOKE ALL ON FUNCTION public.report_modeling_county_run_matches_workspace(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_modeling_county_run_matches_workspace(UUID, UUID) TO authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reports_modeling_county_run_workspace_match'
  ) THEN
    ALTER TABLE public.reports
      ADD CONSTRAINT reports_modeling_county_run_workspace_match
      CHECK (public.report_modeling_county_run_matches_workspace(workspace_id, modeling_county_run_id));
  END IF;
END
$$;
