-- Engagement AI synthesis: persist the per-campaign AI theme/sentiment/narrative
-- synthesis on the campaign row. Additive columns only; the existing
-- engagement_campaigns workspace-member RLS policies already scope reads/writes,
-- so no new policy is needed. The synthesis is a DERIVED, [fact:N]-grounded
-- artifact (every narrative sentence cites a source comment id) with a
-- deterministic non-AI fallback — it never invents input.

ALTER TABLE engagement_campaigns
  ADD COLUMN IF NOT EXISTS ai_synthesis_json JSONB,
  ADD COLUMN IF NOT EXISTS ai_synthesized_at TIMESTAMPTZ;

COMMENT ON COLUMN engagement_campaigns.ai_synthesis_json IS
  'Derived AI synthesis of approved engagement items: themes, sentiment, and a [fact:N]-grounded narrative citing source comment ids. Deterministic fallback when AI is offline. Screening-grade, not a representativeness or legal-sufficiency finding.';
COMMENT ON COLUMN engagement_campaigns.ai_synthesized_at IS
  'When ai_synthesis_json was last generated.';
