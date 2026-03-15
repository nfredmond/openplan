CREATE TABLE IF NOT EXISTS engagement_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed', 'archived')),
  engagement_type TEXT NOT NULL DEFAULT 'comment_collection' CHECK (
    engagement_type IN ('map_feedback', 'comment_collection', 'meeting_intake')
  ),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS engagement_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES engagement_campaigns(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, slug)
);

CREATE TABLE IF NOT EXISTS engagement_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES engagement_campaigns(id) ON DELETE CASCADE,
  category_id UUID REFERENCES engagement_categories(id) ON DELETE SET NULL,
  title TEXT,
  body TEXT NOT NULL,
  submitted_by TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'flagged')),
  source_type TEXT NOT NULL DEFAULT 'internal' CHECK (source_type IN ('internal', 'public', 'meeting', 'email')),
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  moderation_notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90)),
  CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180))
);

CREATE INDEX IF NOT EXISTS idx_engagement_campaigns_workspace_updated_at
  ON engagement_campaigns(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_engagement_campaigns_project_updated_at
  ON engagement_campaigns(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_engagement_categories_campaign_sort_order
  ON engagement_categories(campaign_id, sort_order ASC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_engagement_items_campaign_updated_at
  ON engagement_items(campaign_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_engagement_items_category_status
  ON engagement_items(category_id, status);

ALTER TABLE engagement_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagement_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagement_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'engagement_campaigns' AND policyname = 'engagement_campaigns_read'
  ) THEN
    CREATE POLICY engagement_campaigns_read ON engagement_campaigns
      FOR SELECT USING (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'engagement_campaigns' AND policyname = 'engagement_campaigns_insert'
  ) THEN
    CREATE POLICY engagement_campaigns_insert ON engagement_campaigns
      FOR INSERT WITH CHECK (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'engagement_campaigns' AND policyname = 'engagement_campaigns_update'
  ) THEN
    CREATE POLICY engagement_campaigns_update ON engagement_campaigns
      FOR UPDATE USING (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
      )
      WITH CHECK (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'engagement_campaigns' AND policyname = 'engagement_campaigns_delete'
  ) THEN
    CREATE POLICY engagement_campaigns_delete ON engagement_campaigns
      FOR DELETE USING (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'engagement_categories' AND policyname = 'engagement_categories_read'
  ) THEN
    CREATE POLICY engagement_categories_read ON engagement_categories
      FOR SELECT USING (
        EXISTS (
          SELECT 1
          FROM engagement_campaigns campaign
          JOIN workspace_members wm ON wm.workspace_id = campaign.workspace_id
          WHERE campaign.id = engagement_categories.campaign_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'engagement_categories' AND policyname = 'engagement_categories_insert'
  ) THEN
    CREATE POLICY engagement_categories_insert ON engagement_categories
      FOR INSERT WITH CHECK (
        EXISTS (
          SELECT 1
          FROM engagement_campaigns campaign
          JOIN workspace_members wm ON wm.workspace_id = campaign.workspace_id
          WHERE campaign.id = engagement_categories.campaign_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'engagement_categories' AND policyname = 'engagement_categories_update'
  ) THEN
    CREATE POLICY engagement_categories_update ON engagement_categories
      FOR UPDATE USING (
        EXISTS (
          SELECT 1
          FROM engagement_campaigns campaign
          JOIN workspace_members wm ON wm.workspace_id = campaign.workspace_id
          WHERE campaign.id = engagement_categories.campaign_id
            AND wm.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM engagement_campaigns campaign
          JOIN workspace_members wm ON wm.workspace_id = campaign.workspace_id
          WHERE campaign.id = engagement_categories.campaign_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'engagement_categories' AND policyname = 'engagement_categories_delete'
  ) THEN
    CREATE POLICY engagement_categories_delete ON engagement_categories
      FOR DELETE USING (
        EXISTS (
          SELECT 1
          FROM engagement_campaigns campaign
          JOIN workspace_members wm ON wm.workspace_id = campaign.workspace_id
          WHERE campaign.id = engagement_categories.campaign_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'engagement_items' AND policyname = 'engagement_items_read'
  ) THEN
    CREATE POLICY engagement_items_read ON engagement_items
      FOR SELECT USING (
        EXISTS (
          SELECT 1
          FROM engagement_campaigns campaign
          JOIN workspace_members wm ON wm.workspace_id = campaign.workspace_id
          WHERE campaign.id = engagement_items.campaign_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'engagement_items' AND policyname = 'engagement_items_insert'
  ) THEN
    CREATE POLICY engagement_items_insert ON engagement_items
      FOR INSERT WITH CHECK (
        EXISTS (
          SELECT 1
          FROM engagement_campaigns campaign
          JOIN workspace_members wm ON wm.workspace_id = campaign.workspace_id
          WHERE campaign.id = engagement_items.campaign_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'engagement_items' AND policyname = 'engagement_items_update'
  ) THEN
    CREATE POLICY engagement_items_update ON engagement_items
      FOR UPDATE USING (
        EXISTS (
          SELECT 1
          FROM engagement_campaigns campaign
          JOIN workspace_members wm ON wm.workspace_id = campaign.workspace_id
          WHERE campaign.id = engagement_items.campaign_id
            AND wm.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM engagement_campaigns campaign
          JOIN workspace_members wm ON wm.workspace_id = campaign.workspace_id
          WHERE campaign.id = engagement_items.campaign_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'engagement_items' AND policyname = 'engagement_items_delete'
  ) THEN
    CREATE POLICY engagement_items_delete ON engagement_items
      FOR DELETE USING (
        EXISTS (
          SELECT 1
          FROM engagement_campaigns campaign
          JOIN workspace_members wm ON wm.workspace_id = campaign.workspace_id
          WHERE campaign.id = engagement_items.campaign_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION set_engagement_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_engagement_item_category()
RETURNS TRIGGER AS $$
DECLARE
  category_campaign_id UUID;
BEGIN
  IF NEW.category_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT campaign_id
  INTO category_campaign_id
  FROM engagement_categories
  WHERE id = NEW.category_id;

  IF category_campaign_id IS NULL THEN
    RAISE EXCEPTION 'engagement category % not found', NEW.category_id;
  END IF;

  IF category_campaign_id <> NEW.campaign_id THEN
    RAISE EXCEPTION 'engagement item category must belong to the same campaign';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_engagement_campaigns_updated_at ON engagement_campaigns;
CREATE TRIGGER trg_engagement_campaigns_updated_at
BEFORE UPDATE ON engagement_campaigns
FOR EACH ROW
EXECUTE FUNCTION set_engagement_updated_at();

DROP TRIGGER IF EXISTS trg_engagement_categories_updated_at ON engagement_categories;
CREATE TRIGGER trg_engagement_categories_updated_at
BEFORE UPDATE ON engagement_categories
FOR EACH ROW
EXECUTE FUNCTION set_engagement_updated_at();

DROP TRIGGER IF EXISTS trg_engagement_items_updated_at ON engagement_items;
CREATE TRIGGER trg_engagement_items_updated_at
BEFORE UPDATE ON engagement_items
FOR EACH ROW
EXECUTE FUNCTION set_engagement_updated_at();

DROP TRIGGER IF EXISTS trg_engagement_items_validate_category ON engagement_items;
CREATE TRIGGER trg_engagement_items_validate_category
BEFORE INSERT OR UPDATE ON engagement_items
FOR EACH ROW
EXECUTE FUNCTION validate_engagement_item_category();
