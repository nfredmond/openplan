-- Reports gain a third target: an engagement campaign.
--
-- engagement_campaigns.project_id is nullable, so a standalone campaign (one
-- not linked to any project) could never become a packet: reports required
-- exactly one of project_id XOR rtp_cycle_id via reports_target_presence
-- (established in 20260409000040), and the engagement handoff button had to
-- disable itself when no project existed. This migration widens the two-way
-- XOR into a three-way exactly-one so a campaign's comments can be frozen
-- into a status or summary packet without inventing a placeholder project.
--
-- Why the constraint swap loses no data: every existing report row satisfies
-- num_nonnulls(project_id, rtp_cycle_id) = 1, and engagement_campaign_id is
-- NULL on all existing rows, so num_nonnulls(project_id, rtp_cycle_id,
-- engagement_campaign_id) = 1 already holds for every row the old constraint
-- admitted. The swap only admits new rows that target a campaign.

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS engagement_campaign_id UUID REFERENCES engagement_campaigns(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_reports_engagement_campaign_updated_at
  ON reports(engagement_campaign_id, updated_at DESC)
  WHERE engagement_campaign_id IS NOT NULL;

ALTER TABLE reports
  DROP CONSTRAINT IF EXISTS reports_target_presence;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reports_target_presence'
  ) THEN
    ALTER TABLE reports
      ADD CONSTRAINT reports_target_presence
      CHECK (num_nonnulls(project_id, rtp_cycle_id, engagement_campaign_id) = 1);
  END IF;
END
$$;
