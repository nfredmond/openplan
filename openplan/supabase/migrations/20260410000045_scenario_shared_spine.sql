CREATE TABLE IF NOT EXISTS scenario_assumption_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_set_id UUID NOT NULL REFERENCES scenario_sets(id) ON DELETE CASCADE,
  scenario_entry_id UUID REFERENCES scenario_entries(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  summary TEXT,
  assumptions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scenario_data_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_set_id UUID NOT NULL REFERENCES scenario_sets(id) ON DELETE CASCADE,
  scenario_entry_id UUID REFERENCES scenario_entries(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  package_type TEXT NOT NULL DEFAULT 'reference' CHECK (package_type IN ('input', 'reference', 'model_output', 'evidence')),
  source_url TEXT,
  storage_path TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'archived')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scenario_indicator_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_set_id UUID NOT NULL REFERENCES scenario_sets(id) ON DELETE CASCADE,
  scenario_entry_id UUID REFERENCES scenario_entries(id) ON DELETE SET NULL,
  indicator_key TEXT NOT NULL,
  indicator_label TEXT NOT NULL,
  value_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  unit_label TEXT,
  geography_label TEXT,
  source_label TEXT,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scenario_assumption_sets_set_updated_at
  ON scenario_assumption_sets(scenario_set_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_scenario_assumption_sets_entry_updated_at
  ON scenario_assumption_sets(scenario_entry_id, updated_at DESC)
  WHERE scenario_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scenario_data_packages_set_updated_at
  ON scenario_data_packages(scenario_set_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_scenario_data_packages_entry_updated_at
  ON scenario_data_packages(scenario_entry_id, updated_at DESC)
  WHERE scenario_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scenario_data_packages_type_status
  ON scenario_data_packages(scenario_set_id, package_type, status);
CREATE INDEX IF NOT EXISTS idx_scenario_indicator_snapshots_set_snapshot_at
  ON scenario_indicator_snapshots(scenario_set_id, snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_scenario_indicator_snapshots_entry_snapshot_at
  ON scenario_indicator_snapshots(scenario_entry_id, snapshot_at DESC)
  WHERE scenario_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scenario_indicator_snapshots_key
  ON scenario_indicator_snapshots(scenario_set_id, indicator_key, snapshot_at DESC);

ALTER TABLE scenario_assumption_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenario_data_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenario_indicator_snapshots ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION validate_scenario_spine_entry()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.scenario_entry_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM scenario_entries
    WHERE id = NEW.scenario_entry_id
      AND scenario_set_id = NEW.scenario_set_id
  ) THEN
    RAISE EXCEPTION 'scenario_entry_id must reference an entry in the same scenario set';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'scenario_assumption_sets',
    'scenario_data_packages',
    'scenario_indicator_snapshots'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = table_name AND policyname = table_name || '_read'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR SELECT USING (
          EXISTS (
            SELECT 1
            FROM scenario_sets s
            JOIN workspace_members wm ON wm.workspace_id = s.workspace_id
            WHERE s.id = %I.scenario_set_id
              AND wm.user_id = auth.uid()
          )
        )',
        table_name || '_read',
        table_name,
        table_name
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = table_name AND policyname = table_name || '_insert'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR INSERT WITH CHECK (
          EXISTS (
            SELECT 1
            FROM scenario_sets s
            JOIN workspace_members wm ON wm.workspace_id = s.workspace_id
            WHERE s.id = %I.scenario_set_id
              AND wm.user_id = auth.uid()
          )
        )',
        table_name || '_insert',
        table_name,
        table_name
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = table_name AND policyname = table_name || '_update'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR UPDATE USING (
          EXISTS (
            SELECT 1
            FROM scenario_sets s
            JOIN workspace_members wm ON wm.workspace_id = s.workspace_id
            WHERE s.id = %I.scenario_set_id
              AND wm.user_id = auth.uid()
          )
        )
        WITH CHECK (
          EXISTS (
            SELECT 1
            FROM scenario_sets s
            JOIN workspace_members wm ON wm.workspace_id = s.workspace_id
            WHERE s.id = %I.scenario_set_id
              AND wm.user_id = auth.uid()
          )
        )',
        table_name || '_update',
        table_name,
        table_name,
        table_name
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = table_name AND policyname = table_name || '_delete'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR DELETE USING (
          EXISTS (
            SELECT 1
            FROM scenario_sets s
            JOIN workspace_members wm ON wm.workspace_id = s.workspace_id
            WHERE s.id = %I.scenario_set_id
              AND wm.user_id = auth.uid()
          )
        )',
        table_name || '_delete',
        table_name,
        table_name
      );
    END IF;
  END LOOP;
END
$$;

DROP TRIGGER IF EXISTS trg_scenario_assumption_sets_updated_at ON scenario_assumption_sets;
CREATE TRIGGER trg_scenario_assumption_sets_updated_at
BEFORE UPDATE ON scenario_assumption_sets
FOR EACH ROW
EXECUTE FUNCTION set_scenarios_updated_at();

DROP TRIGGER IF EXISTS trg_scenario_data_packages_updated_at ON scenario_data_packages;
CREATE TRIGGER trg_scenario_data_packages_updated_at
BEFORE UPDATE ON scenario_data_packages
FOR EACH ROW
EXECUTE FUNCTION set_scenarios_updated_at();

DROP TRIGGER IF EXISTS trg_scenario_indicator_snapshots_updated_at ON scenario_indicator_snapshots;
CREATE TRIGGER trg_scenario_indicator_snapshots_updated_at
BEFORE UPDATE ON scenario_indicator_snapshots
FOR EACH ROW
EXECUTE FUNCTION set_scenarios_updated_at();

DROP TRIGGER IF EXISTS trg_scenario_assumption_sets_validate_entry ON scenario_assumption_sets;
CREATE TRIGGER trg_scenario_assumption_sets_validate_entry
BEFORE INSERT OR UPDATE OF scenario_set_id, scenario_entry_id ON scenario_assumption_sets
FOR EACH ROW
EXECUTE FUNCTION validate_scenario_spine_entry();

DROP TRIGGER IF EXISTS trg_scenario_data_packages_validate_entry ON scenario_data_packages;
CREATE TRIGGER trg_scenario_data_packages_validate_entry
BEFORE INSERT OR UPDATE OF scenario_set_id, scenario_entry_id ON scenario_data_packages
FOR EACH ROW
EXECUTE FUNCTION validate_scenario_spine_entry();

DROP TRIGGER IF EXISTS trg_scenario_indicator_snapshots_validate_entry ON scenario_indicator_snapshots;
CREATE TRIGGER trg_scenario_indicator_snapshots_validate_entry
BEFORE INSERT OR UPDATE OF scenario_set_id, scenario_entry_id ON scenario_indicator_snapshots
FOR EACH ROW
EXECUTE FUNCTION validate_scenario_spine_entry();
