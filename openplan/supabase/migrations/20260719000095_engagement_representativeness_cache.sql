-- E5b — cache the on-demand spatial/ecological representativeness SCREENING
-- result on the campaign, mirroring ai_synthesis_json (E1). It is recomputed by
-- a staff button (the compute hits the external ACS + TIGERweb APIs); reports and
-- the copilot READ this cache and never recompute. Aggregate/screening data only
-- (tract-level, no PII), so it rides the existing engagement_campaigns RLS.
ALTER TABLE engagement_campaigns
  ADD COLUMN IF NOT EXISTS representativeness_json jsonb,
  ADD COLUMN IF NOT EXISTS representativeness_computed_at timestamptz;
