-- Expand funding_opportunities.decision_state to cover the application lifecycle.
-- Original states (20260410000042): monitor, pursue, skip.
-- New states for post-pursuit outcomes: under_review, awarded, denied.
-- Ordering in the app layer (FUNDING_OPPORTUNITY_DECISION_OPTIONS) reflects
-- the lifecycle: monitor → pursue → under_review → awarded / denied / skip.

ALTER TABLE funding_opportunities
  DROP CONSTRAINT IF EXISTS funding_opportunities_decision_state_check;

ALTER TABLE funding_opportunities
  ADD CONSTRAINT funding_opportunities_decision_state_check
    CHECK (decision_state IN ('monitor', 'pursue', 'under_review', 'awarded', 'denied', 'skip'));
