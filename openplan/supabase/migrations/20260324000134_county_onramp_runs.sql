CREATE TABLE IF NOT EXISTS county_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  geography_type TEXT NOT NULL DEFAULT 'county_fips' CHECK (geography_type IN ('county_fips')),
  geography_id TEXT NOT NULL,
  geography_label TEXT,
  run_name TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'bootstrap-incomplete' CHECK (
    stage IN ('bootstrap-incomplete', 'runtime-complete', 'validation-scaffolded', 'validated-screening')
  ),
  status_label TEXT,
  mode TEXT NOT NULL DEFAULT 'build-and-bootstrap' CHECK (mode IN ('build-and-bootstrap', 'existing-run')),
  manifest_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  run_summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation_summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_county_runs_workspace_updated_at
  ON county_runs(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_county_runs_workspace_stage_updated_at
  ON county_runs(workspace_id, stage, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_county_runs_workspace_geography
  ON county_runs(workspace_id, geography_type, geography_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_county_runs_workspace_run_name
  ON county_runs(workspace_id, run_name);

ALTER TABLE county_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'county_runs' AND policyname = 'county_runs_read'
  ) THEN
    CREATE POLICY county_runs_read ON county_runs
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'county_runs' AND policyname = 'county_runs_insert'
  ) THEN
    CREATE POLICY county_runs_insert ON county_runs
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'county_runs' AND policyname = 'county_runs_update'
  ) THEN
    CREATE POLICY county_runs_update ON county_runs
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'county_runs' AND policyname = 'county_runs_delete'
  ) THEN
    CREATE POLICY county_runs_delete ON county_runs
      FOR DELETE USING (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION set_county_runs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_county_runs_updated_at ON county_runs;
CREATE TRIGGER trg_county_runs_updated_at
BEFORE UPDATE ON county_runs
FOR EACH ROW
EXECUTE FUNCTION set_county_runs_updated_at();

CREATE TABLE IF NOT EXISTS county_run_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  county_run_id UUID NOT NULL REFERENCES county_runs(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  artifact_type TEXT NOT NULL,
  path TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_county_run_artifacts_run_created_at
  ON county_run_artifacts(county_run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_county_run_artifacts_workspace_type
  ON county_run_artifacts(workspace_id, artifact_type, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_county_run_artifacts_unique_path
  ON county_run_artifacts(county_run_id, artifact_type, path);

ALTER TABLE county_run_artifacts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'county_run_artifacts' AND policyname = 'county_run_artifacts_read'
  ) THEN
    CREATE POLICY county_run_artifacts_read ON county_run_artifacts
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'county_run_artifacts' AND policyname = 'county_run_artifacts_insert'
  ) THEN
    CREATE POLICY county_run_artifacts_insert ON county_run_artifacts
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'county_run_artifacts' AND policyname = 'county_run_artifacts_update'
  ) THEN
    CREATE POLICY county_run_artifacts_update ON county_run_artifacts
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'county_run_artifacts' AND policyname = 'county_run_artifacts_delete'
  ) THEN
    CREATE POLICY county_run_artifacts_delete ON county_run_artifacts
      FOR DELETE USING (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;
