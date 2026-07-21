-- M6 part 2: register the in-process ITE-style trip-generation engine.
-- Adds 'ite_trip_generation' to the model_runs engine CHECK and to the
-- model_run_kpis category CHECK, following the 20260718000088 pattern.
--
-- model_run_kpis_source_shape needs no change: ite_trip_generation KPIs are
-- run-scoped (run_id set, county_run_id null) and the constraint's
-- non-behavioral arm already covers every category other than
-- 'behavioral_onramp'. The direct authenticated SELECT policy likewise already
-- allows any non-behavioral category.

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
    CHECK (engine_key IN ('deterministic_corridor_v1', 'aequilibrae', 'activitysim', 'behavioral_demand', 'sketch_abm', 'ite_trip_generation'));
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
    CHECK (kpi_category IN ('accessibility', 'assignment', 'safety', 'equity', 'general', 'behavioral_onramp', 'sketch_abm', 'ite_trip_generation'));
END
$$;
