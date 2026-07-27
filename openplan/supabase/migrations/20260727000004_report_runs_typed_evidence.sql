-- Report typed evidence: report_runs becomes the one place a report cites a
-- run of ANY kind — legacy Analysis Studio runs (run_id, unchanged), worker
-- model runs (model_run_id, NEW), and county validation runs (county_run_id,
-- NEW). Exactly one of the three per row (num_nonnulls CHECK — the same
-- shape reports_target_presence established in 20260409000040). This closes
-- the gap where a planner who ran AequilibraE from /models could not cite
-- that run in any report packet.
--
-- Additive only. run_id merely loses NOT NULL; every existing row keeps its
-- run_id and satisfies the new constraint with exactly one non-null.

ALTER TABLE public.report_runs
  ALTER COLUMN run_id DROP NOT NULL;

ALTER TABLE public.report_runs
  ADD COLUMN IF NOT EXISTS model_run_id UUID REFERENCES public.model_runs(id) ON DELETE CASCADE;

ALTER TABLE public.report_runs
  ADD COLUMN IF NOT EXISTS county_run_id UUID REFERENCES public.county_runs(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'report_runs_evidence_presence'
  ) THEN
    ALTER TABLE public.report_runs
      ADD CONSTRAINT report_runs_evidence_presence
      CHECK (num_nonnulls(run_id, model_run_id, county_run_id) = 1);
  END IF;
END
$$;

-- One citation per (report, run) pair, per run kind. The original
-- UNIQUE(report_id, run_id) stays for legacy rows.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_report_runs_report_model_run
  ON public.report_runs (report_id, model_run_id)
  WHERE model_run_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_report_runs_report_county_run
  ON public.report_runs (report_id, county_run_id)
  WHERE county_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_report_runs_model_run_id
  ON public.report_runs (model_run_id)
  WHERE model_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_report_runs_county_run_id
  ON public.report_runs (county_run_id)
  WHERE county_run_id IS NOT NULL;
