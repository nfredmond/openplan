-- Modeling: register the sketch_abm engine key and KPI category.
--
-- 1) model_runs_engine_key_check gains 'sketch_abm' (fifth allowed value).
-- 2) model_run_kpis_kpi_category_check gains 'sketch_abm' (current live list
--    verified via pg_constraint: accessibility, assignment, safety, equity,
--    general, behavioral_onramp).
--
-- model_run_kpis_source_shape is deliberately untouched: sketch_abm KPIs are
-- run-scoped (run_id set, county_run_id null), which already satisfies the
-- constraint's non-behavioral arm. Constraint names verified against
-- pg_constraint on the live schema.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'model_runs_engine_key_check'
      AND conrelid = 'public.model_runs'::regclass
  ) THEN
    ALTER TABLE public.model_runs DROP CONSTRAINT model_runs_engine_key_check;
  END IF;

  ALTER TABLE public.model_runs ADD CONSTRAINT model_runs_engine_key_check
    CHECK (engine_key IN ('deterministic_corridor_v1', 'aequilibrae', 'activitysim', 'behavioral_demand', 'sketch_abm'));
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'model_run_kpis_kpi_category_check'
      AND conrelid = 'public.model_run_kpis'::regclass
  ) THEN
    ALTER TABLE public.model_run_kpis DROP CONSTRAINT model_run_kpis_kpi_category_check;
  END IF;

  ALTER TABLE public.model_run_kpis ADD CONSTRAINT model_run_kpis_kpi_category_check
    CHECK (kpi_category IN ('accessibility', 'assignment', 'safety', 'equity', 'general', 'behavioral_onramp', 'sketch_abm'));
END
$$;
