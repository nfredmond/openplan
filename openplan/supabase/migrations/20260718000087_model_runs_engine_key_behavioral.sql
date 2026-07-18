-- Modeling 1.1: model_runs.engine_key CHECK drifted from the run-mode registry
-- (it allows the unused 'activitysim' but not 'behavioral_demand', the
-- registry's third key). Additive fix only — the behavioral_demand launch stays
-- 409-blocked in the API; this removes the latent constraint trap if that
-- block is ever lifted. Constraint name verified against pg_constraint on the
-- live schema.

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
    CHECK (engine_key IN ('deterministic_corridor_v1', 'aequilibrae', 'activitysim', 'behavioral_demand'));
END
$$;
