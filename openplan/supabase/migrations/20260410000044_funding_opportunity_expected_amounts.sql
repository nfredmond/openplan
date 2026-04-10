ALTER TABLE funding_opportunities
  ADD COLUMN IF NOT EXISTS expected_award_amount NUMERIC(14,2)
    CHECK (expected_award_amount IS NULL OR expected_award_amount >= 0);

CREATE INDEX IF NOT EXISTS idx_funding_opportunities_project_expected_award
  ON funding_opportunities(project_id, expected_award_amount DESC, updated_at DESC);
