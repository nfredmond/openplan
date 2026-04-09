ALTER TABLE engagement_campaigns
  ADD COLUMN IF NOT EXISTS rtp_cycle_id UUID REFERENCES rtp_cycles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rtp_cycle_chapter_id UUID REFERENCES rtp_cycle_chapters(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_engagement_campaigns_rtp_cycle_updated_at
  ON engagement_campaigns(rtp_cycle_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_engagement_campaigns_rtp_cycle_chapter_updated_at
  ON engagement_campaigns(rtp_cycle_chapter_id, updated_at DESC);

ALTER TABLE engagement_campaigns
  DROP CONSTRAINT IF EXISTS engagement_campaigns_rtp_target_consistency;

ALTER TABLE engagement_campaigns
  ADD CONSTRAINT engagement_campaigns_rtp_target_consistency CHECK (
    rtp_cycle_chapter_id IS NULL OR rtp_cycle_id IS NOT NULL
  );
