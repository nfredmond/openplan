-- Pursuit kind + solicitation fields on funding_opportunities.
--
-- A funding opportunity has always meant "a grant we might apply for". The
-- same registry, decision states, application workspace, and export pipeline
-- also serve the other pursuit a planning shop runs: responding to an RFP/RFQ
-- with a PROPOSAL. Rather than a parallel module (forbidden), the opportunity
-- row gains a pursuit_kind discriminator plus the three solicitation fields a
-- proposal response grounds on. All additive; every existing row defaults to
-- 'grant', so nothing changes for grant pursuits.
--
--   pursuit_kind          — 'grant' (default) or 'proposal'.
--   solicitation_number   — the RFP/RFQ/solicitation identifier as issued.
--   submission_format_note — operator note on the required submission format
--                            (page limits, portal, copies) — always verify the
--                            current solicitation; never asserted by OpenPlan.
--   questions_due_at      — the written-questions deadline, when the
--                            solicitation sets one.

ALTER TABLE funding_opportunities
  ADD COLUMN IF NOT EXISTS pursuit_kind TEXT NOT NULL DEFAULT 'grant';

ALTER TABLE funding_opportunities
  ADD COLUMN IF NOT EXISTS solicitation_number TEXT;

ALTER TABLE funding_opportunities
  ADD COLUMN IF NOT EXISTS submission_format_note TEXT;

ALTER TABLE funding_opportunities
  ADD COLUMN IF NOT EXISTS questions_due_at TIMESTAMPTZ;

-- Guarded CHECK so re-running is safe and the vocabulary is pinned at the
-- database, not just in application code.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'funding_opportunities_pursuit_kind_check'
  ) THEN
    ALTER TABLE funding_opportunities
      ADD CONSTRAINT funding_opportunities_pursuit_kind_check
      CHECK (pursuit_kind IN ('grant', 'proposal'));
  END IF;
END
$$;

COMMENT ON COLUMN funding_opportunities.pursuit_kind IS
  'What kind of pursuit this opportunity is: ''grant'' (a funding application) or ''proposal'' (an RFP/RFQ response). Defaults to grant; drives application seeding and export labeling.';
COMMENT ON COLUMN funding_opportunities.solicitation_number IS
  'The issuing agency''s RFP/RFQ/solicitation identifier, as issued. Proposal pursuits.';
COMMENT ON COLUMN funding_opportunities.submission_format_note IS
  'Operator note on the required submission format (page limits, portal, copies). Verify against the current solicitation — OpenPlan never asserts submission requirements.';
COMMENT ON COLUMN funding_opportunities.questions_due_at IS
  'Written-questions deadline set by the solicitation, when one exists.';
