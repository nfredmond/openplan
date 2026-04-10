ALTER TABLE funding_opportunities
  ADD COLUMN IF NOT EXISTS decision_state TEXT NOT NULL DEFAULT 'monitor'
    CHECK (decision_state IN ('monitor', 'pursue', 'skip')),
  ADD COLUMN IF NOT EXISTS fit_notes TEXT,
  ADD COLUMN IF NOT EXISTS readiness_notes TEXT,
  ADD COLUMN IF NOT EXISTS decision_rationale TEXT,
  ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_funding_opportunities_project_decision
  ON funding_opportunities(project_id, decision_state, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_funding_opportunities_program_decision
  ON funding_opportunities(program_id, decision_state, updated_at DESC);
