-- Add share_token to engagement_campaigns for public share URLs
-- When non-null and campaign is active, the campaign is publicly viewable/submittable
ALTER TABLE engagement_campaigns
  ADD COLUMN IF NOT EXISTS share_token TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS public_description TEXT,
  ADD COLUMN IF NOT EXISTS allow_public_submissions BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS submissions_closed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_engagement_campaigns_share_token
  ON engagement_campaigns(share_token) WHERE share_token IS NOT NULL;

-- Allow anonymous reads on campaigns that have a share_token and are active
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'engagement_campaigns' AND policyname = 'engagement_campaigns_public_read'
  ) THEN
    CREATE POLICY engagement_campaigns_public_read ON engagement_campaigns
      FOR SELECT USING (
        share_token IS NOT NULL AND status = 'active'
      );
  END IF;
END
$$;

-- Allow anonymous reads on categories belonging to publicly shared campaigns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'engagement_categories' AND policyname = 'engagement_categories_public_read'
  ) THEN
    CREATE POLICY engagement_categories_public_read ON engagement_categories
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM engagement_campaigns c
          WHERE c.id = engagement_categories.campaign_id
            AND c.share_token IS NOT NULL
            AND c.status = 'active'
        )
      );
  END IF;
END
$$;

-- Allow anonymous reads on APPROVED items belonging to publicly shared campaigns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'engagement_items' AND policyname = 'engagement_items_public_read'
  ) THEN
    CREATE POLICY engagement_items_public_read ON engagement_items
      FOR SELECT USING (
        status = 'approved'
        AND EXISTS (
          SELECT 1 FROM engagement_campaigns c
          WHERE c.id = engagement_items.campaign_id
            AND c.share_token IS NOT NULL
            AND c.status = 'active'
        )
      );
  END IF;
END
$$;

-- Allow anonymous inserts into engagement_items for publicly shared campaigns that allow submissions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'engagement_items' AND policyname = 'engagement_items_public_insert'
  ) THEN
    CREATE POLICY engagement_items_public_insert ON engagement_items
      FOR INSERT WITH CHECK (
        EXISTS (
          SELECT 1 FROM engagement_campaigns c
          WHERE c.id = engagement_items.campaign_id
            AND c.share_token IS NOT NULL
            AND c.status = 'active'
            AND c.allow_public_submissions = true
            AND c.submissions_closed_at IS NULL
        )
      );
  END IF;
END
$$;
