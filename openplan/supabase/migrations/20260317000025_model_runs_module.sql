CREATE TABLE IF NOT EXISTS model_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  scenario_set_id UUID REFERENCES scenario_sets(id) ON DELETE SET NULL,
  scenario_entry_id UUID REFERENCES scenario_entries(id) ON DELETE SET NULL,
  source_analysis_run_id UUID REFERENCES runs(id) ON DELETE SET NULL,
  engine_key TEXT NOT NULL DEFAULT 'deterministic_corridor_v1' CHECK (engine_key IN ('deterministic_corridor_v1', 'aequilibrae', 'activitysim')),
  launch_source TEXT NOT NULL DEFAULT 'model_detail' CHECK (launch_source IN ('model_detail', 'scenario_entry', 'api')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  run_title TEXT NOT NULL,
  query_text TEXT,
  corridor_geojson JSONB,
  input_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  assumption_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_model_runs_workspace_created_at
  ON model_runs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_runs_model_created_at
  ON model_runs(model_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_runs_model_status_created_at
  ON model_runs(model_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_runs_scenario_entry_created_at
  ON model_runs(scenario_entry_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_runs_source_analysis_run_id
  ON model_runs(source_analysis_run_id);

ALTER TABLE model_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'model_runs' AND policyname = 'model_runs_read'
  ) THEN
    CREATE POLICY model_runs_read ON model_runs
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'model_runs' AND policyname = 'model_runs_insert'
  ) THEN
    CREATE POLICY model_runs_insert ON model_runs
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'model_runs' AND policyname = 'model_runs_update'
  ) THEN
    CREATE POLICY model_runs_update ON model_runs
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'model_runs' AND policyname = 'model_runs_delete'
  ) THEN
    CREATE POLICY model_runs_delete ON model_runs
      FOR DELETE USING (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION set_model_runs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION touch_model_updated_at_from_model_runs()
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

DROP TRIGGER IF EXISTS trg_model_runs_updated_at ON model_runs;
CREATE TRIGGER trg_model_runs_updated_at
BEFORE UPDATE ON model_runs
FOR EACH ROW
EXECUTE FUNCTION set_model_runs_updated_at();

DROP TRIGGER IF EXISTS trg_model_runs_touch_model_insert ON model_runs;
CREATE TRIGGER trg_model_runs_touch_model_insert
AFTER INSERT ON model_runs
FOR EACH ROW
EXECUTE FUNCTION touch_model_updated_at_from_model_runs();

DROP TRIGGER IF EXISTS trg_model_runs_touch_model_update ON model_runs;
CREATE TRIGGER trg_model_runs_touch_model_update
AFTER UPDATE ON model_runs
FOR EACH ROW
EXECUTE FUNCTION touch_model_updated_at_from_model_runs();

DROP TRIGGER IF EXISTS trg_model_runs_touch_model_delete ON model_runs;
CREATE TRIGGER trg_model_runs_touch_model_delete
AFTER DELETE ON model_runs
FOR EACH ROW
EXECUTE FUNCTION touch_model_updated_at_from_model_runs();
