-- Aerial processing worker integration (natford-aerial-processing.v1)
--
-- aerial_processing_jobs: one row per ProcessingRequest dispatched to the
-- Aerial Intel Platform (OpenPlan's ODM processing worker).  The row is
-- inserted BEFORE the worker call so a crash cannot orphan an accepted
-- worker job, then advanced by bearer-authenticated ProcessingCallback
-- deliveries (see schemas/aerial_processing_contract.schema.json).
--
-- aerial_processing_callbacks: idempotency ledger for callback deliveries.
-- The contract allows redeliveries; consumers dedupe on callback_id, which
-- is UNIQUE here so a replay fails with 23505 and the route answers
-- {ok:true, deduped:true} without re-applying the transition.

CREATE TABLE IF NOT EXISTS aerial_processing_jobs (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id           UUID        REFERENCES projects(id) ON DELETE SET NULL,
  mission_id           UUID        NOT NULL REFERENCES aerial_missions(id) ON DELETE CASCADE,
  -- Caller-generated idempotency key echoed by every callback; the callback
  -- route resolves mission/workspace from this because the contract payload
  -- deliberately does not carry them.
  request_id           TEXT        NOT NULL UNIQUE,
  -- Worker-side drone_processing_jobs.id, set from the accepted response.
  job_reference        TEXT,
  status               TEXT        NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'accepted', 'running', 'succeeded', 'failed', 'canceled', 'dispatch_failed')),
  progress             NUMERIC(5, 2) CHECK (progress >= 0 AND progress <= 100),
  message              TEXT,
  preset_id            TEXT        NOT NULL DEFAULT 'balanced'
    CHECK (preset_id IN ('fast-preview', 'balanced', 'high-quality')),
  imagery_url          TEXT        NOT NULL,
  imagery_image_count  INTEGER,
  imagery_size_bytes   BIGINT,
  -- Signed artifact list from the succeeded callback (download URLs are
  -- time-limited); NULL until the job succeeds.
  artifacts            JSONB,
  benchmark_summary    JSONB,
  last_callback_id     TEXT,
  last_callback_at     TIMESTAMPTZ,
  dispatch_error       TEXT,
  created_by           UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS aerial_processing_jobs_mission_id_idx   ON aerial_processing_jobs(mission_id);
CREATE INDEX IF NOT EXISTS aerial_processing_jobs_workspace_id_idx ON aerial_processing_jobs(workspace_id);
CREATE INDEX IF NOT EXISTS aerial_processing_jobs_status_idx       ON aerial_processing_jobs(status);

CREATE OR REPLACE FUNCTION public.set_aerial_processing_jobs_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_aerial_processing_jobs_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_aerial_processing_jobs_updated_at() TO service_role;

DROP TRIGGER IF EXISTS trg_set_aerial_processing_jobs_updated_at ON aerial_processing_jobs;
CREATE TRIGGER trg_set_aerial_processing_jobs_updated_at
BEFORE UPDATE ON aerial_processing_jobs
FOR EACH ROW
EXECUTE FUNCTION public.set_aerial_processing_jobs_updated_at();

CREATE TABLE IF NOT EXISTS aerial_processing_callbacks (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  processing_job_id  UUID        NOT NULL REFERENCES aerial_processing_jobs(id) ON DELETE CASCADE,
  workspace_id       UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  callback_id        TEXT        NOT NULL UNIQUE,
  status             TEXT        NOT NULL,
  occurred_at        TIMESTAMPTZ NOT NULL,
  payload            JSONB       NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS aerial_processing_callbacks_processing_job_id_idx
  ON aerial_processing_callbacks(processing_job_id);
CREATE INDEX IF NOT EXISTS aerial_processing_callbacks_workspace_id_idx
  ON aerial_processing_callbacks(workspace_id);

-- Link evidence packages back to the processing job that produced them so
-- the succeeded-callback handler can create the package idempotently.
ALTER TABLE aerial_evidence_packages
  ADD COLUMN IF NOT EXISTS processing_job_id UUID REFERENCES aerial_processing_jobs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS aerial_evidence_packages_processing_job_id_idx
  ON aerial_evidence_packages(processing_job_id);

-- Row-level security.  Workspace members may READ processing state; all
-- writes go through the service-role callback route or session routes that
-- verify membership explicitly, so no INSERT/UPDATE/DELETE policies are
-- granted to regular users (unlike aerial_evidence_packages' FOR ALL).
ALTER TABLE aerial_processing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE aerial_processing_callbacks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_members_can_read_aerial_processing_jobs"
  ON aerial_processing_jobs FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "workspace_members_can_read_aerial_processing_callbacks"
  ON aerial_processing_callbacks FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );
