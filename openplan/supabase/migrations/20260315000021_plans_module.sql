CREATE TABLE IF NOT EXISTS plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  plan_type TEXT NOT NULL CHECK (plan_type IN ('corridor', 'atp', 'safety', 'regional', 'complete_streets', 'other')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'adopted', 'archived')),
  geography_label TEXT,
  horizon_year INTEGER CHECK (horizon_year IS NULL OR (horizon_year >= 1900 AND horizon_year <= 2200)),
  summary TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plan_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL CHECK (link_type IN ('scenario_set', 'engagement_campaign', 'report', 'project_record')),
  linked_id UUID NOT NULL,
  label TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(plan_id, link_type, linked_id)
);

CREATE INDEX IF NOT EXISTS idx_plans_workspace_updated_at
  ON plans(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_plans_project_updated_at
  ON plans(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_plans_workspace_type_status
  ON plans(workspace_id, plan_type, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_plan_links_plan_id
  ON plan_links(plan_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_plan_links_plan_type
  ON plan_links(plan_id, link_type, created_at ASC);

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_links ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'plans' AND policyname = 'plans_read'
  ) THEN
    CREATE POLICY plans_read ON plans
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'plans' AND policyname = 'plans_insert'
  ) THEN
    CREATE POLICY plans_insert ON plans
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'plans' AND policyname = 'plans_update'
  ) THEN
    CREATE POLICY plans_update ON plans
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'plans' AND policyname = 'plans_delete'
  ) THEN
    CREATE POLICY plans_delete ON plans
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'plan_links' AND policyname = 'plan_links_read'
  ) THEN
    CREATE POLICY plan_links_read ON plan_links
      FOR SELECT USING (
        EXISTS (
          SELECT 1
          FROM plans p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = plan_links.plan_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'plan_links' AND policyname = 'plan_links_insert'
  ) THEN
    CREATE POLICY plan_links_insert ON plan_links
      FOR INSERT WITH CHECK (
        EXISTS (
          SELECT 1
          FROM plans p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = plan_links.plan_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'plan_links' AND policyname = 'plan_links_update'
  ) THEN
    CREATE POLICY plan_links_update ON plan_links
      FOR UPDATE USING (
        EXISTS (
          SELECT 1
          FROM plans p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = plan_links.plan_id
            AND wm.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM plans p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = plan_links.plan_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'plan_links' AND policyname = 'plan_links_delete'
  ) THEN
    CREATE POLICY plan_links_delete ON plan_links
      FOR DELETE USING (
        EXISTS (
          SELECT 1
          FROM plans p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = plan_links.plan_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION set_plans_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION touch_plan_updated_at_from_links()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE plans
  SET updated_at = now()
  WHERE id = COALESCE(NEW.plan_id, OLD.plan_id);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_plans_updated_at ON plans;
CREATE TRIGGER trg_plans_updated_at
BEFORE UPDATE ON plans
FOR EACH ROW
EXECUTE FUNCTION set_plans_updated_at();

DROP TRIGGER IF EXISTS trg_plan_links_updated_at ON plan_links;
CREATE TRIGGER trg_plan_links_updated_at
BEFORE UPDATE ON plan_links
FOR EACH ROW
EXECUTE FUNCTION set_plans_updated_at();

DROP TRIGGER IF EXISTS trg_plan_links_touch_plan_insert ON plan_links;
CREATE TRIGGER trg_plan_links_touch_plan_insert
AFTER INSERT ON plan_links
FOR EACH ROW
EXECUTE FUNCTION touch_plan_updated_at_from_links();

DROP TRIGGER IF EXISTS trg_plan_links_touch_plan_update ON plan_links;
CREATE TRIGGER trg_plan_links_touch_plan_update
AFTER UPDATE ON plan_links
FOR EACH ROW
EXECUTE FUNCTION touch_plan_updated_at_from_links();

DROP TRIGGER IF EXISTS trg_plan_links_touch_plan_delete ON plan_links;
CREATE TRIGGER trg_plan_links_touch_plan_delete
AFTER DELETE ON plan_links
FOR EACH ROW
EXECUTE FUNCTION touch_plan_updated_at_from_links();
