ALTER TABLE public.county_runs
  ADD COLUMN IF NOT EXISTS worker_job_id UUID,
  ADD COLUMN IF NOT EXISTS worker_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS worker_url TEXT,
  ADD COLUMN IF NOT EXISTS worker_dispatch_error TEXT;

UPDATE public.county_runs
SET enqueue_status = 'prepared'
WHERE enqueue_status = 'queued_stub';

ALTER TABLE public.county_runs
  DROP CONSTRAINT IF EXISTS county_runs_enqueue_status_check;

ALTER TABLE public.county_runs
  ADD CONSTRAINT county_runs_enqueue_status_check
  CHECK (enqueue_status IN ('not-enqueued', 'prepared', 'submitted', 'failed'));

CREATE INDEX IF NOT EXISTS idx_county_runs_worker_job_id
  ON public.county_runs(worker_job_id)
  WHERE worker_job_id IS NOT NULL;
