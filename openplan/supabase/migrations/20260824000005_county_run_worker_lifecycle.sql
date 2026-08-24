-- One county-run row may have several worker attempts over its life, but only
-- the job named by worker_job_id is allowed to change the current attempt.
ALTER TABLE public.county_runs
  ADD COLUMN IF NOT EXISTS worker_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS worker_heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS worker_completed_at TIMESTAMPTZ;

UPDATE public.county_runs
SET enqueue_status = 'queued'
WHERE enqueue_status = 'submitted';

ALTER TABLE public.county_runs
  DROP CONSTRAINT IF EXISTS county_runs_enqueue_status_check;

ALTER TABLE public.county_runs
  ADD CONSTRAINT county_runs_enqueue_status_check
  CHECK (
    enqueue_status IN (
      'not-enqueued',
      'prepared',
      'queued',
      'running',
      'cancelling',
      'cancelled',
      'completed',
      'failed'
    )
  );

CREATE INDEX IF NOT EXISTS idx_county_runs_worker_heartbeat
  ON public.county_runs(worker_heartbeat_at)
  WHERE enqueue_status IN ('queued', 'running', 'cancelling');
