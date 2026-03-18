CREATE TABLE IF NOT EXISTS model_run_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES model_runs(id) ON DELETE CASCADE,
  stage_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'skipped')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  log_tail TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_model_run_stages_run_id_sort_order
  ON model_run_stages(run_id, sort_order ASC);

ALTER TABLE model_run_stages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'model_run_stages' AND policyname = 'model_run_stages_read'
  ) THEN
    CREATE POLICY model_run_stages_read ON model_run_stages
      FOR SELECT USING (
        run_id IN (
          SELECT mr.id FROM model_runs mr
          JOIN workspace_members wm ON wm.workspace_id = mr.workspace_id
          WHERE wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'model_run_stages' AND policyname = 'model_run_stages_insert'
  ) THEN
    CREATE POLICY model_run_stages_insert ON model_run_stages
      FOR INSERT WITH CHECK (
        run_id IN (
          SELECT mr.id FROM model_runs mr
          JOIN workspace_members wm ON wm.workspace_id = mr.workspace_id
          WHERE wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'model_run_stages' AND policyname = 'model_run_stages_update'
  ) THEN
    CREATE POLICY model_run_stages_update ON model_run_stages
      FOR UPDATE USING (
        run_id IN (
          SELECT mr.id FROM model_runs mr
          JOIN workspace_members wm ON wm.workspace_id = mr.workspace_id
          WHERE wm.user_id = auth.uid()
        )
      )
      WITH CHECK (
        run_id IN (
          SELECT mr.id FROM model_runs mr
          JOIN workspace_members wm ON wm.workspace_id = mr.workspace_id
          WHERE wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'model_run_stages' AND policyname = 'model_run_stages_delete'
  ) THEN
    CREATE POLICY model_run_stages_delete ON model_run_stages
      FOR DELETE USING (
        run_id IN (
          SELECT mr.id FROM model_runs mr
          JOIN workspace_members wm ON wm.workspace_id = mr.workspace_id
          WHERE wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;


CREATE TABLE IF NOT EXISTS model_run_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES model_runs(id) ON DELETE CASCADE,
  stage_id UUID REFERENCES model_run_stages(id) ON DELETE SET NULL,
  artifact_type TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_size_bytes BIGINT,
  content_hash TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_model_run_artifacts_run_id_created_at
  ON model_run_artifacts(run_id, created_at DESC);

ALTER TABLE model_run_artifacts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'model_run_artifacts' AND policyname = 'model_run_artifacts_read'
  ) THEN
    CREATE POLICY model_run_artifacts_read ON model_run_artifacts
      FOR SELECT USING (
        run_id IN (
          SELECT mr.id FROM model_runs mr
          JOIN workspace_members wm ON wm.workspace_id = mr.workspace_id
          WHERE wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'model_run_artifacts' AND policyname = 'model_run_artifacts_insert'
  ) THEN
    CREATE POLICY model_run_artifacts_insert ON model_run_artifacts
      FOR INSERT WITH CHECK (
        run_id IN (
          SELECT mr.id FROM model_runs mr
          JOIN workspace_members wm ON wm.workspace_id = mr.workspace_id
          WHERE wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'model_run_artifacts' AND policyname = 'model_run_artifacts_update'
  ) THEN
    CREATE POLICY model_run_artifacts_update ON model_run_artifacts
      FOR UPDATE USING (
        run_id IN (
          SELECT mr.id FROM model_runs mr
          JOIN workspace_members wm ON wm.workspace_id = mr.workspace_id
          WHERE wm.user_id = auth.uid()
        )
      )
      WITH CHECK (
        run_id IN (
          SELECT mr.id FROM model_runs mr
          JOIN workspace_members wm ON wm.workspace_id = mr.workspace_id
          WHERE wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'model_run_artifacts' AND policyname = 'model_run_artifacts_delete'
  ) THEN
    CREATE POLICY model_run_artifacts_delete ON model_run_artifacts
      FOR DELETE USING (
        run_id IN (
          SELECT mr.id FROM model_runs mr
          JOIN workspace_members wm ON wm.workspace_id = mr.workspace_id
          WHERE wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION set_model_run_stages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_model_run_stages_updated_at ON model_run_stages;
CREATE TRIGGER trg_model_run_stages_updated_at
BEFORE UPDATE ON model_run_stages
FOR EACH ROW
EXECUTE FUNCTION set_model_run_stages_updated_at();

CREATE OR REPLACE FUNCTION set_model_run_artifacts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_model_run_artifacts_updated_at ON model_run_artifacts;
CREATE TRIGGER trg_model_run_artifacts_updated_at
BEFORE UPDATE ON model_run_artifacts
FOR EACH ROW
EXECUTE FUNCTION set_model_run_artifacts_updated_at();
