ALTER TABLE runs
  ADD COLUMN IF NOT EXISTS report_generated_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_report_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_report_generated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_runs_workspace_last_report_generated
  ON runs(workspace_id, last_report_generated_at DESC);
