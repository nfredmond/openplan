-- Modeling caveat KPI SQL gate.
--
-- Behavioral-onramp KPIs are screening-grade county-run outputs. Keep them
-- out of direct authenticated model_run_kpis reads and require the narrow RPC
-- below, which makes screening-grade consent explicit.

ALTER TABLE public.model_run_kpis
  DROP CONSTRAINT IF EXISTS model_run_kpis_source_required;

ALTER TABLE public.model_run_kpis
  DROP CONSTRAINT IF EXISTS model_run_kpis_source_shape;

ALTER TABLE public.model_run_kpis
  ADD CONSTRAINT model_run_kpis_source_shape
  CHECK (
    (
      kpi_category = 'behavioral_onramp'
      AND county_run_id IS NOT NULL
      AND run_id IS NULL
    )
    OR (
      kpi_category <> 'behavioral_onramp'
      AND run_id IS NOT NULL
      AND county_run_id IS NULL
    )
  );

DROP POLICY IF EXISTS "model_run_kpis_select" ON public.model_run_kpis;
CREATE POLICY "model_run_kpis_select" ON public.model_run_kpis
  FOR SELECT USING (
    kpi_category <> 'behavioral_onramp'
    AND run_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.model_runs mr
      JOIN public.models m ON m.id = mr.model_id
      JOIN public.workspace_members wm ON wm.workspace_id = m.workspace_id
      WHERE mr.id = model_run_kpis.run_id
        AND wm.user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.load_behavioral_onramp_kpis_for_workspace(
  p_workspace_id uuid,
  p_accept_screening_grade boolean DEFAULT false
)
RETURNS TABLE (
  kpi_name text,
  kpi_label text,
  kpi_category text,
  value double precision,
  unit text,
  breakdown_json jsonb,
  county_run_id uuid,
  run_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_allowed_non_screening_stages constant text[] := ARRAY[]::text[];
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.user_id = auth.uid()
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    k.kpi_name,
    k.kpi_label,
    k.kpi_category,
    k.value,
    k.unit,
    k.breakdown_json,
    k.county_run_id,
    k.run_id
  FROM public.model_run_kpis k
  JOIN public.county_runs cr ON cr.id = k.county_run_id
  WHERE cr.workspace_id = p_workspace_id
    AND k.kpi_category = 'behavioral_onramp'
    AND k.county_run_id IS NOT NULL
    AND k.run_id IS NULL
    AND (
      p_accept_screening_grade IS TRUE
      OR cr.stage = ANY(v_allowed_non_screening_stages)
    )
  ORDER BY cr.updated_at DESC, k.kpi_name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.load_behavioral_onramp_kpis_for_workspace(uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.load_behavioral_onramp_kpis_for_workspace(uuid, boolean)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.load_behavioral_onramp_kpis_for_workspace(uuid, boolean) IS
  'Narrow SECURITY DEFINER read path for behavioral-onramp KPIs. Requires workspace membership and explicit screening-grade consent until a future migration registers known non-screening county-run stages.';
