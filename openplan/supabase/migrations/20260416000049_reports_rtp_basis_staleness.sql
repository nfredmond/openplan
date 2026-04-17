-- T3 (2026-04-16 deep-dive): add rtp_basis_stale column so RTP packets can
-- visibly mark themselves stale when an upstream model_run succeeds. A null
-- `rtp_basis_stale_run_id` and false flag is the fresh state.

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS rtp_basis_stale BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS rtp_basis_stale_reason TEXT,
  ADD COLUMN IF NOT EXISTS rtp_basis_stale_run_id UUID,
  ADD COLUMN IF NOT EXISTS rtp_basis_stale_marked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS reports_rtp_basis_stale_idx
  ON reports (workspace_id)
  WHERE rtp_basis_stale = TRUE;
