CREATE TABLE IF NOT EXISTS scenario_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT,
  planning_question TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  baseline_entry_id UUID,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scenario_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_set_id UUID NOT NULL REFERENCES scenario_sets(id) ON DELETE CASCADE,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('baseline', 'alternative')),
  label TEXT NOT NULL,
  slug TEXT NOT NULL,
  summary TEXT,
  assumptions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  attached_run_id UUID REFERENCES runs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'superseded')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(scenario_set_id, slug)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'scenario_sets'
      AND constraint_name = 'scenario_sets_baseline_entry_id_fkey'
  ) THEN
    ALTER TABLE scenario_sets
      ADD CONSTRAINT scenario_sets_baseline_entry_id_fkey
      FOREIGN KEY (baseline_entry_id)
      REFERENCES scenario_entries(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_scenario_sets_workspace_updated_at
  ON scenario_sets(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_scenario_sets_project_updated_at
  ON scenario_sets(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_scenario_entries_set_sort_order
  ON scenario_entries(scenario_set_id, sort_order ASC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_scenario_entries_attached_run_id
  ON scenario_entries(attached_run_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_scenario_entries_one_baseline
  ON scenario_entries(scenario_set_id)
  WHERE entry_type = 'baseline';

ALTER TABLE scenario_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenario_entries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'scenario_sets' AND policyname = 'scenario_sets_read'
  ) THEN
    CREATE POLICY scenario_sets_read ON scenario_sets
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'scenario_sets' AND policyname = 'scenario_sets_insert'
  ) THEN
    CREATE POLICY scenario_sets_insert ON scenario_sets
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'scenario_sets' AND policyname = 'scenario_sets_update'
  ) THEN
    CREATE POLICY scenario_sets_update ON scenario_sets
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'scenario_sets' AND policyname = 'scenario_sets_delete'
  ) THEN
    CREATE POLICY scenario_sets_delete ON scenario_sets
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'scenario_entries' AND policyname = 'scenario_entries_read'
  ) THEN
    CREATE POLICY scenario_entries_read ON scenario_entries
      FOR SELECT USING (
        EXISTS (
          SELECT 1
          FROM scenario_sets s
          JOIN workspace_members wm ON wm.workspace_id = s.workspace_id
          WHERE s.id = scenario_entries.scenario_set_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'scenario_entries' AND policyname = 'scenario_entries_insert'
  ) THEN
    CREATE POLICY scenario_entries_insert ON scenario_entries
      FOR INSERT WITH CHECK (
        EXISTS (
          SELECT 1
          FROM scenario_sets s
          JOIN workspace_members wm ON wm.workspace_id = s.workspace_id
          WHERE s.id = scenario_entries.scenario_set_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'scenario_entries' AND policyname = 'scenario_entries_update'
  ) THEN
    CREATE POLICY scenario_entries_update ON scenario_entries
      FOR UPDATE USING (
        EXISTS (
          SELECT 1
          FROM scenario_sets s
          JOIN workspace_members wm ON wm.workspace_id = s.workspace_id
          WHERE s.id = scenario_entries.scenario_set_id
            AND wm.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM scenario_sets s
          JOIN workspace_members wm ON wm.workspace_id = s.workspace_id
          WHERE s.id = scenario_entries.scenario_set_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'scenario_entries' AND policyname = 'scenario_entries_delete'
  ) THEN
    CREATE POLICY scenario_entries_delete ON scenario_entries
      FOR DELETE USING (
        EXISTS (
          SELECT 1
          FROM scenario_sets s
          JOIN workspace_members wm ON wm.workspace_id = s.workspace_id
          WHERE s.id = scenario_entries.scenario_set_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION set_scenarios_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION refresh_scenario_set_baseline_entry(target_scenario_set_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE scenario_sets
  SET baseline_entry_id = (
    SELECT id
    FROM scenario_entries
    WHERE scenario_set_id = target_scenario_set_id
      AND entry_type = 'baseline'
    ORDER BY sort_order ASC, created_at ASC, id ASC
    LIMIT 1
  )
  WHERE id = target_scenario_set_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sync_scenario_set_baseline_entry()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM refresh_scenario_set_baseline_entry(NEW.scenario_set_id);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    PERFORM refresh_scenario_set_baseline_entry(NEW.scenario_set_id);
    IF OLD.scenario_set_id IS DISTINCT FROM NEW.scenario_set_id THEN
      PERFORM refresh_scenario_set_baseline_entry(OLD.scenario_set_id);
    END IF;
    RETURN NEW;
  END IF;

  PERFORM refresh_scenario_set_baseline_entry(OLD.scenario_set_id);
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_scenario_set_baseline_entry()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.baseline_entry_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM scenario_entries
    WHERE id = NEW.baseline_entry_id
      AND scenario_set_id = NEW.id
      AND entry_type = 'baseline'
  ) THEN
    RAISE EXCEPTION 'baseline_entry_id must reference a baseline entry in the same scenario set';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_scenario_sets_updated_at ON scenario_sets;
CREATE TRIGGER trg_scenario_sets_updated_at
BEFORE UPDATE ON scenario_sets
FOR EACH ROW
EXECUTE FUNCTION set_scenarios_updated_at();

DROP TRIGGER IF EXISTS trg_scenario_entries_updated_at ON scenario_entries;
CREATE TRIGGER trg_scenario_entries_updated_at
BEFORE UPDATE ON scenario_entries
FOR EACH ROW
EXECUTE FUNCTION set_scenarios_updated_at();

DROP TRIGGER IF EXISTS trg_sync_scenario_set_baseline_entry ON scenario_entries;
CREATE TRIGGER trg_sync_scenario_set_baseline_entry
AFTER INSERT OR UPDATE OR DELETE ON scenario_entries
FOR EACH ROW
EXECUTE FUNCTION sync_scenario_set_baseline_entry();

DROP TRIGGER IF EXISTS trg_validate_scenario_set_baseline_entry ON scenario_sets;
CREATE TRIGGER trg_validate_scenario_set_baseline_entry
BEFORE INSERT OR UPDATE OF baseline_entry_id ON scenario_sets
FOR EACH ROW
EXECUTE FUNCTION validate_scenario_set_baseline_entry();
