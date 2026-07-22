-- RTP "why" engine: attributed modeling evidence for a project's RTP entry.
--
-- Lets a planner attach a representative model run to a project's role in an RTP
-- cycle, so that run's VMT/GHG KPIs become the modeling evidence shown next to the
-- VMT/GHG priority criteria. The run is ALWAYS named alongside the numbers — this
-- is planner-chosen attribution, never an auto-derived per-project forecast.
ALTER TABLE project_rtp_cycle_links
  ADD COLUMN IF NOT EXISTS evidence_model_run_id UUID REFERENCES model_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_project_rtp_cycle_links_evidence_run
  ON project_rtp_cycle_links(evidence_model_run_id)
  WHERE evidence_model_run_id IS NOT NULL;
