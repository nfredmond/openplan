CREATE TABLE IF NOT EXISTS models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  scenario_set_id UUID REFERENCES scenario_sets(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  model_family TEXT NOT NULL CHECK (model_family IN ('travel_demand', 'activity_based_model', 'scenario_model', 'accessibility', 'other')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'configuring', 'ready_for_review', 'approved', 'archived')),
  config_version TEXT,
  owner_label TEXT,
  horizon_label TEXT,
  assumptions_summary TEXT,
  input_summary TEXT,
  output_summary TEXT,
  summary TEXT,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_validated_at TIMESTAMPTZ,
  last_run_recorded_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS model_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL CHECK (link_type IN ('scenario_set', 'report', 'data_dataset', 'plan', 'project_record', 'run')),
  linked_id UUID NOT NULL,
  label TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(model_id, link_type, linked_id)
);

CREATE INDEX IF NOT EXISTS idx_models_workspace_updated_at
  ON models(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_models_project_updated_at
  ON models(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_models_scenario_updated_at
  ON models(scenario_set_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_models_workspace_family_status
  ON models(workspace_id, model_family, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_links_model_id
  ON model_links(model_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_model_links_model_type
  ON model_links(model_id, link_type, created_at ASC);

ALTER TABLE models ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_links ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'models' AND policyname = 'models_read'
  ) THEN
    CREATE POLICY models_read ON models
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'models' AND policyname = 'models_insert'
  ) THEN
    CREATE POLICY models_insert ON models
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'models' AND policyname = 'models_update'
  ) THEN
    CREATE POLICY models_update ON models
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'models' AND policyname = 'models_delete'
  ) THEN
    CREATE POLICY models_delete ON models
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'model_links' AND policyname = 'model_links_read'
  ) THEN
    CREATE POLICY model_links_read ON model_links
      FOR SELECT USING (
        EXISTS (
          SELECT 1
          FROM models m
          JOIN workspace_members wm ON wm.workspace_id = m.workspace_id
          WHERE m.id = model_links.model_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'model_links' AND policyname = 'model_links_insert'
  ) THEN
    CREATE POLICY model_links_insert ON model_links
      FOR INSERT WITH CHECK (
        EXISTS (
          SELECT 1
          FROM models m
          JOIN workspace_members wm ON wm.workspace_id = m.workspace_id
          WHERE m.id = model_links.model_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'model_links' AND policyname = 'model_links_update'
  ) THEN
    CREATE POLICY model_links_update ON model_links
      FOR UPDATE USING (
        EXISTS (
          SELECT 1
          FROM models m
          JOIN workspace_members wm ON wm.workspace_id = m.workspace_id
          WHERE m.id = model_links.model_id
            AND wm.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM models m
          JOIN workspace_members wm ON wm.workspace_id = m.workspace_id
          WHERE m.id = model_links.model_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'model_links' AND policyname = 'model_links_delete'
  ) THEN
    CREATE POLICY model_links_delete ON model_links
      FOR DELETE USING (
        EXISTS (
          SELECT 1
          FROM models m
          JOIN workspace_members wm ON wm.workspace_id = m.workspace_id
          WHERE m.id = model_links.model_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION set_models_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION touch_model_updated_at_from_links()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE models
  SET updated_at = now()
  WHERE id = COALESCE(NEW.model_id, OLD.model_id);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_models_updated_at ON models;
CREATE TRIGGER trg_models_updated_at
BEFORE UPDATE ON models
FOR EACH ROW
EXECUTE FUNCTION set_models_updated_at();

DROP TRIGGER IF EXISTS trg_model_links_updated_at ON model_links;
CREATE TRIGGER trg_model_links_updated_at
BEFORE UPDATE ON model_links
FOR EACH ROW
EXECUTE FUNCTION set_models_updated_at();

DROP TRIGGER IF EXISTS trg_model_links_touch_model_insert ON model_links;
CREATE TRIGGER trg_model_links_touch_model_insert
AFTER INSERT ON model_links
FOR EACH ROW
EXECUTE FUNCTION touch_model_updated_at_from_links();

DROP TRIGGER IF EXISTS trg_model_links_touch_model_update ON model_links;
CREATE TRIGGER trg_model_links_touch_model_update
AFTER UPDATE ON model_links
FOR EACH ROW
EXECUTE FUNCTION touch_model_updated_at_from_links();

DROP TRIGGER IF EXISTS trg_model_links_touch_model_delete ON model_links;
CREATE TRIGGER trg_model_links_touch_model_delete
AFTER DELETE ON model_links
FOR EACH ROW
EXECUTE FUNCTION touch_model_updated_at_from_links();
