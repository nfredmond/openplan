-- Scenario model-run attachment: a scenario entry may carry a worker model
-- run as its evidence instead of a legacy Analysis Studio run. This is
-- planner-chosen attribution (the same posture as
-- project_rtp_cycle_links.evidence_model_run_id, 20260722000002): the run is
-- ALWAYS named alongside its numbers, never an auto-derived forecast.
--
-- Exactly one attachment at a time — an entry's evidence is either a legacy
-- run (attached_run_id, unchanged) or a model run (attached_model_run_id,
-- NEW), never both. Additive only; existing rows satisfy the CHECK with at
-- most one non-null.

ALTER TABLE public.scenario_entries
  ADD COLUMN IF NOT EXISTS attached_model_run_id UUID REFERENCES public.model_runs(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scenario_entries_one_attachment'
  ) THEN
    ALTER TABLE public.scenario_entries
      ADD CONSTRAINT scenario_entries_one_attachment
      CHECK (num_nonnulls(attached_run_id, attached_model_run_id) <= 1);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_scenario_entries_attached_model_run_id
  ON public.scenario_entries (attached_model_run_id)
  WHERE attached_model_run_id IS NOT NULL;
