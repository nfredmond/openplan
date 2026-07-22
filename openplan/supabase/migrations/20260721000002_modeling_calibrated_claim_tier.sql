-- Add the 'calibrated_to_counts' claim tier to the modeling claim spine.
--
-- A distinct, disclosed tier ABOVE screening_grade: the model was tuned to
-- observed traffic counts and reports held-out (out-of-sample) validation
-- accuracy. It is NOT claim_grade_passed (a county-lane validation-threshold
-- pass). A calibrated run publishes its VMT under distinct KPI names, so the
-- CEQA §15064.3 screen (which reads exact screening KPI names) keeps using the
-- uncalibrated screening VMT unless a calibrated result is explicitly promoted.
--
-- Screening/prototype runs are untouched; this only widens the allowed set.

ALTER TABLE public.modeling_claim_decisions
  DROP CONSTRAINT IF EXISTS modeling_claim_decisions_claim_status_check;

ALTER TABLE public.modeling_claim_decisions
  ADD CONSTRAINT modeling_claim_decisions_claim_status_check
  CHECK (claim_status IN (
    'claim_grade_passed',
    'calibrated_to_counts',
    'screening_grade',
    'prototype_only'
  ));

COMMENT ON COLUMN public.modeling_claim_decisions.claim_status IS
  'Claim tier for a modeling run/track. claim_grade_passed (county-lane validation pass) > calibrated_to_counts (tuned to observed counts, holdout-validated) > screening_grade (uncalibrated, screening-grade) > prototype_only. Calibrated VMT is published under distinct KPI names and is not the CEQA screening input unless explicitly promoted.';
