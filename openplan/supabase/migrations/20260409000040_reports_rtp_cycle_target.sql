ALTER TABLE reports
  ALTER COLUMN project_id DROP NOT NULL;

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS rtp_cycle_id UUID REFERENCES rtp_cycles(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_reports_rtp_cycle_updated_at
  ON reports(rtp_cycle_id, updated_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reports_target_presence'
  ) THEN
    ALTER TABLE reports
      ADD CONSTRAINT reports_target_presence
      CHECK (num_nonnulls(project_id, rtp_cycle_id) = 1);
  END IF;
END
$$;
