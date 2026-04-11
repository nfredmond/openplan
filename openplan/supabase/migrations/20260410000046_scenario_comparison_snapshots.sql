CREATE TABLE IF NOT EXISTS scenario_comparison_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_set_id UUID NOT NULL REFERENCES scenario_sets(id) ON DELETE CASCADE,
  baseline_entry_id UUID NOT NULL REFERENCES scenario_entries(id) ON DELETE CASCADE,
  candidate_entry_id UUID NOT NULL REFERENCES scenario_entries(id) ON DELETE CASCADE,
  assumption_set_id UUID REFERENCES scenario_assumption_sets(id) ON DELETE SET NULL,
  data_package_id UUID REFERENCES scenario_data_packages(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  summary TEXT,
  narrative TEXT,
  caveats_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'archived')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (baseline_entry_id <> candidate_entry_id)
);

CREATE TABLE IF NOT EXISTS scenario_comparison_indicator_deltas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comparison_snapshot_id UUID NOT NULL REFERENCES scenario_comparison_snapshots(id) ON DELETE CASCADE,
  indicator_key TEXT NOT NULL,
  indicator_label TEXT NOT NULL,
  unit_label TEXT,
  baseline_indicator_snapshot_id UUID REFERENCES scenario_indicator_snapshots(id) ON DELETE SET NULL,
  candidate_indicator_snapshot_id UUID REFERENCES scenario_indicator_snapshots(id) ON DELETE SET NULL,
  delta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary_text TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scenario_comparison_snapshots_set_updated_at
  ON scenario_comparison_snapshots(scenario_set_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_scenario_comparison_snapshots_candidate
  ON scenario_comparison_snapshots(scenario_set_id, candidate_entry_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_scenario_comparison_indicator_deltas_snapshot_sort
  ON scenario_comparison_indicator_deltas(comparison_snapshot_id, sort_order, created_at);

ALTER TABLE scenario_comparison_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenario_comparison_indicator_deltas ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION validate_scenario_comparison_snapshot()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM scenario_entries
    WHERE id = NEW.baseline_entry_id
      AND scenario_set_id = NEW.scenario_set_id
      AND entry_type = 'baseline'
  ) THEN
    RAISE EXCEPTION 'baseline_entry_id must reference a baseline entry in the same scenario set';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM scenario_entries
    WHERE id = NEW.candidate_entry_id
      AND scenario_set_id = NEW.scenario_set_id
      AND entry_type <> 'baseline'
  ) THEN
    RAISE EXCEPTION 'candidate_entry_id must reference an alternative entry in the same scenario set';
  END IF;

  IF NEW.assumption_set_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM scenario_assumption_sets
    WHERE id = NEW.assumption_set_id
      AND scenario_set_id = NEW.scenario_set_id
  ) THEN
    RAISE EXCEPTION 'assumption_set_id must reference an assumption set in the same scenario set';
  END IF;

  IF NEW.data_package_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM scenario_data_packages
    WHERE id = NEW.data_package_id
      AND scenario_set_id = NEW.scenario_set_id
  ) THEN
    RAISE EXCEPTION 'data_package_id must reference a data package in the same scenario set';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_scenario_comparison_indicator_delta()
RETURNS TRIGGER AS $$
DECLARE
  snapshot_record scenario_comparison_snapshots%ROWTYPE;
BEGIN
  SELECT * INTO snapshot_record
  FROM scenario_comparison_snapshots
  WHERE id = NEW.comparison_snapshot_id;

  IF snapshot_record.id IS NULL THEN
    RAISE EXCEPTION 'comparison_snapshot_id must reference an existing comparison snapshot';
  END IF;

  IF NEW.baseline_indicator_snapshot_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM scenario_indicator_snapshots
    WHERE id = NEW.baseline_indicator_snapshot_id
      AND scenario_set_id = snapshot_record.scenario_set_id
  ) THEN
    RAISE EXCEPTION 'baseline_indicator_snapshot_id must reference an indicator snapshot in the same scenario set';
  END IF;

  IF NEW.candidate_indicator_snapshot_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM scenario_indicator_snapshots
    WHERE id = NEW.candidate_indicator_snapshot_id
      AND scenario_set_id = snapshot_record.scenario_set_id
  ) THEN
    RAISE EXCEPTION 'candidate_indicator_snapshot_id must reference an indicator snapshot in the same scenario set';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'scenario_comparison_snapshots' AND policyname = 'scenario_comparison_snapshots_read'
  ) THEN
    CREATE POLICY scenario_comparison_snapshots_read ON scenario_comparison_snapshots FOR SELECT USING (
      EXISTS (
        SELECT 1
        FROM scenario_sets s
        JOIN workspace_members wm ON wm.workspace_id = s.workspace_id
        WHERE s.id = scenario_comparison_snapshots.scenario_set_id
          AND wm.user_id = auth.uid()
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'scenario_comparison_snapshots' AND policyname = 'scenario_comparison_snapshots_insert'
  ) THEN
    CREATE POLICY scenario_comparison_snapshots_insert ON scenario_comparison_snapshots FOR INSERT WITH CHECK (
      EXISTS (
        SELECT 1
        FROM scenario_sets s
        JOIN workspace_members wm ON wm.workspace_id = s.workspace_id
        WHERE s.id = scenario_comparison_snapshots.scenario_set_id
          AND wm.user_id = auth.uid()
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'scenario_comparison_snapshots' AND policyname = 'scenario_comparison_snapshots_update'
  ) THEN
    CREATE POLICY scenario_comparison_snapshots_update ON scenario_comparison_snapshots FOR UPDATE USING (
      EXISTS (
        SELECT 1
        FROM scenario_sets s
        JOIN workspace_members wm ON wm.workspace_id = s.workspace_id
        WHERE s.id = scenario_comparison_snapshots.scenario_set_id
          AND wm.user_id = auth.uid()
      )
    ) WITH CHECK (
      EXISTS (
        SELECT 1
        FROM scenario_sets s
        JOIN workspace_members wm ON wm.workspace_id = s.workspace_id
        WHERE s.id = scenario_comparison_snapshots.scenario_set_id
          AND wm.user_id = auth.uid()
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'scenario_comparison_snapshots' AND policyname = 'scenario_comparison_snapshots_delete'
  ) THEN
    CREATE POLICY scenario_comparison_snapshots_delete ON scenario_comparison_snapshots FOR DELETE USING (
      EXISTS (
        SELECT 1
        FROM scenario_sets s
        JOIN workspace_members wm ON wm.workspace_id = s.workspace_id
        WHERE s.id = scenario_comparison_snapshots.scenario_set_id
          AND wm.user_id = auth.uid()
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'scenario_comparison_indicator_deltas' AND policyname = 'scenario_comparison_indicator_deltas_read'
  ) THEN
    CREATE POLICY scenario_comparison_indicator_deltas_read ON scenario_comparison_indicator_deltas FOR SELECT USING (
      EXISTS (
        SELECT 1
        FROM scenario_comparison_snapshots cs
        JOIN scenario_sets s ON s.id = cs.scenario_set_id
        JOIN workspace_members wm ON wm.workspace_id = s.workspace_id
        WHERE cs.id = scenario_comparison_indicator_deltas.comparison_snapshot_id
          AND wm.user_id = auth.uid()
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'scenario_comparison_indicator_deltas' AND policyname = 'scenario_comparison_indicator_deltas_insert'
  ) THEN
    CREATE POLICY scenario_comparison_indicator_deltas_insert ON scenario_comparison_indicator_deltas FOR INSERT WITH CHECK (
      EXISTS (
        SELECT 1
        FROM scenario_comparison_snapshots cs
        JOIN scenario_sets s ON s.id = cs.scenario_set_id
        JOIN workspace_members wm ON wm.workspace_id = s.workspace_id
        WHERE cs.id = scenario_comparison_indicator_deltas.comparison_snapshot_id
          AND wm.user_id = auth.uid()
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'scenario_comparison_indicator_deltas' AND policyname = 'scenario_comparison_indicator_deltas_update'
  ) THEN
    CREATE POLICY scenario_comparison_indicator_deltas_update ON scenario_comparison_indicator_deltas FOR UPDATE USING (
      EXISTS (
        SELECT 1
        FROM scenario_comparison_snapshots cs
        JOIN scenario_sets s ON s.id = cs.scenario_set_id
        JOIN workspace_members wm ON wm.workspace_id = s.workspace_id
        WHERE cs.id = scenario_comparison_indicator_deltas.comparison_snapshot_id
          AND wm.user_id = auth.uid()
      )
    ) WITH CHECK (
      EXISTS (
        SELECT 1
        FROM scenario_comparison_snapshots cs
        JOIN scenario_sets s ON s.id = cs.scenario_set_id
        JOIN workspace_members wm ON wm.workspace_id = s.workspace_id
        WHERE cs.id = scenario_comparison_indicator_deltas.comparison_snapshot_id
          AND wm.user_id = auth.uid()
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'scenario_comparison_indicator_deltas' AND policyname = 'scenario_comparison_indicator_deltas_delete'
  ) THEN
    CREATE POLICY scenario_comparison_indicator_deltas_delete ON scenario_comparison_indicator_deltas FOR DELETE USING (
      EXISTS (
        SELECT 1
        FROM scenario_comparison_snapshots cs
        JOIN scenario_sets s ON s.id = cs.scenario_set_id
        JOIN workspace_members wm ON wm.workspace_id = s.workspace_id
        WHERE cs.id = scenario_comparison_indicator_deltas.comparison_snapshot_id
          AND wm.user_id = auth.uid()
      )
    );
  END IF;
END
$$;

DROP TRIGGER IF EXISTS trg_scenario_comparison_snapshots_updated_at ON scenario_comparison_snapshots;
CREATE TRIGGER trg_scenario_comparison_snapshots_updated_at
BEFORE UPDATE ON scenario_comparison_snapshots
FOR EACH ROW
EXECUTE FUNCTION set_scenarios_updated_at();

DROP TRIGGER IF EXISTS trg_scenario_comparison_indicator_deltas_updated_at ON scenario_comparison_indicator_deltas;
CREATE TRIGGER trg_scenario_comparison_indicator_deltas_updated_at
BEFORE UPDATE ON scenario_comparison_indicator_deltas
FOR EACH ROW
EXECUTE FUNCTION set_scenarios_updated_at();

DROP TRIGGER IF EXISTS trg_scenario_comparison_snapshots_validate ON scenario_comparison_snapshots;
CREATE TRIGGER trg_scenario_comparison_snapshots_validate
BEFORE INSERT OR UPDATE OF scenario_set_id, baseline_entry_id, candidate_entry_id, assumption_set_id, data_package_id
ON scenario_comparison_snapshots
FOR EACH ROW
EXECUTE FUNCTION validate_scenario_comparison_snapshot();

DROP TRIGGER IF EXISTS trg_scenario_comparison_indicator_deltas_validate ON scenario_comparison_indicator_deltas;
CREATE TRIGGER trg_scenario_comparison_indicator_deltas_validate
BEFORE INSERT OR UPDATE OF comparison_snapshot_id, baseline_indicator_snapshot_id, candidate_indicator_snapshot_id
ON scenario_comparison_indicator_deltas
FOR EACH ROW
EXECUTE FUNCTION validate_scenario_comparison_indicator_delta();
