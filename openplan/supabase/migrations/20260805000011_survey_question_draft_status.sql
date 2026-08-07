-- A survey question can exist without being asked of anybody.
--
-- ============================================================== WHY
--
-- Nathaniel's decision of 2026-08-03, recorded in the v1.0 review: the Planner
-- Agent may DRAFT survey questions; a person publishes them. Until now there was
-- no shape in which that could be true. `engagement_survey_questions` carried
-- `is_active`, which is a soft-archive for questions that have already been
-- asked — flipping it false hides a question that respondents may already have
-- answered, and it is checked against the condition graph for exactly that
-- reason. It is not a "not ready yet", and overloading it to mean both would
-- make an archived question and an unreviewed one indistinguishable in every
-- query in the module.
--
-- ================================================== WHY THE DEFAULT IS PUBLISHED
--
-- Every question that exists today was written by a person through the survey
-- builder and is being shown to the public right now. A default of 'draft' would
-- silently empty every live survey in every deployment on the first request
-- after this migration — a public-facing regression produced by a schema change,
-- which is the worst kind because nothing in the app would report it.
--
-- The default also governs new rows, and that is deliberate too: a person using
-- the builder gets exactly the behaviour they have always had. THIS MIGRATION
-- CHANGES WHAT THE AGENT MAY DO, AND NOTHING ELSE. The route decides 'draft' for
-- the agent seam; the column simply makes the state expressible.

ALTER TABLE engagement_survey_questions
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'engagement_survey_questions_status_check'
  ) THEN
    ALTER TABLE engagement_survey_questions
      ADD CONSTRAINT engagement_survey_questions_status_check
      CHECK (status IN ('draft', 'published'));
  END IF;
END
$$;

COMMENT ON COLUMN engagement_survey_questions.status IS
  'draft = written but never shown to the public; published = part of the live survey. Distinct from is_active, which soft-archives a question that HAS been asked. The public portal serves published questions only, and a draft answer is refused on submission.';

-- Reading the live survey is now (campaign, active, published) in sort order.
-- The existing index leads with campaign_id and sort_order; this one carries the
-- two predicates so the portal's read does not degrade into a filter over every
-- question in the campaign as drafts accumulate.
CREATE INDEX IF NOT EXISTS idx_survey_questions_campaign_status
  ON engagement_survey_questions (campaign_id, status, is_active, sort_order);
