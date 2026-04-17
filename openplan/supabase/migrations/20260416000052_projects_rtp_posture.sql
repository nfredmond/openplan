-- Cached grants→RTP write-back posture on projects.
-- Computed from project_funding_profiles + funding_awards + funding_opportunities + billing_invoice_records
-- whenever a funding award is created/updated, so RTP constrained-portfolio surfaces can read
-- posture directly without reassembling the full funding stack on every render.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS rtp_posture JSONB,
  ADD COLUMN IF NOT EXISTS rtp_posture_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS projects_rtp_posture_updated_at_idx
  ON projects (rtp_posture_updated_at DESC)
  WHERE rtp_posture IS NOT NULL;
