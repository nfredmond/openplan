CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  report_type TEXT NOT NULL CHECK (report_type IN ('project_status', 'analysis_summary', 'board_packet')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'generated', 'archived')),
  summary TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  generated_at TIMESTAMPTZ,
  latest_artifact_url TEXT,
  latest_artifact_kind TEXT CHECK (latest_artifact_kind IN ('html', 'pdf')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS report_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(report_id, run_id)
);

CREATE TABLE IF NOT EXISTS report_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  section_key TEXT NOT NULL,
  title TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(report_id, section_key)
);

CREATE TABLE IF NOT EXISTS report_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  artifact_kind TEXT NOT NULL CHECK (artifact_kind IN ('html', 'pdf')),
  storage_path TEXT,
  generated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reports_workspace_updated_at
  ON reports(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_project_updated_at
  ON reports(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_runs_report_sort_order
  ON report_runs(report_id, sort_order ASC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_report_runs_run_id
  ON report_runs(run_id);
CREATE INDEX IF NOT EXISTS idx_report_sections_report_sort_order
  ON report_sections(report_id, sort_order ASC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_report_artifacts_report_generated_at
  ON report_artifacts(report_id, generated_at DESC);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_artifacts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'reports' AND policyname = 'reports_read'
  ) THEN
    CREATE POLICY reports_read ON reports
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'reports' AND policyname = 'reports_insert'
  ) THEN
    CREATE POLICY reports_insert ON reports
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'reports' AND policyname = 'reports_update'
  ) THEN
    CREATE POLICY reports_update ON reports
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'reports' AND policyname = 'reports_delete'
  ) THEN
    CREATE POLICY reports_delete ON reports
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'report_runs' AND policyname = 'report_runs_read'
  ) THEN
    CREATE POLICY report_runs_read ON report_runs
      FOR SELECT USING (
        EXISTS (
          SELECT 1
          FROM reports r
          JOIN workspace_members wm ON wm.workspace_id = r.workspace_id
          WHERE r.id = report_runs.report_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'report_runs' AND policyname = 'report_runs_insert'
  ) THEN
    CREATE POLICY report_runs_insert ON report_runs
      FOR INSERT WITH CHECK (
        EXISTS (
          SELECT 1
          FROM reports r
          JOIN workspace_members wm ON wm.workspace_id = r.workspace_id
          WHERE r.id = report_runs.report_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'report_runs' AND policyname = 'report_runs_update'
  ) THEN
    CREATE POLICY report_runs_update ON report_runs
      FOR UPDATE USING (
        EXISTS (
          SELECT 1
          FROM reports r
          JOIN workspace_members wm ON wm.workspace_id = r.workspace_id
          WHERE r.id = report_runs.report_id
            AND wm.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM reports r
          JOIN workspace_members wm ON wm.workspace_id = r.workspace_id
          WHERE r.id = report_runs.report_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'report_runs' AND policyname = 'report_runs_delete'
  ) THEN
    CREATE POLICY report_runs_delete ON report_runs
      FOR DELETE USING (
        EXISTS (
          SELECT 1
          FROM reports r
          JOIN workspace_members wm ON wm.workspace_id = r.workspace_id
          WHERE r.id = report_runs.report_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'report_sections' AND policyname = 'report_sections_read'
  ) THEN
    CREATE POLICY report_sections_read ON report_sections
      FOR SELECT USING (
        EXISTS (
          SELECT 1
          FROM reports r
          JOIN workspace_members wm ON wm.workspace_id = r.workspace_id
          WHERE r.id = report_sections.report_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'report_sections' AND policyname = 'report_sections_insert'
  ) THEN
    CREATE POLICY report_sections_insert ON report_sections
      FOR INSERT WITH CHECK (
        EXISTS (
          SELECT 1
          FROM reports r
          JOIN workspace_members wm ON wm.workspace_id = r.workspace_id
          WHERE r.id = report_sections.report_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'report_sections' AND policyname = 'report_sections_update'
  ) THEN
    CREATE POLICY report_sections_update ON report_sections
      FOR UPDATE USING (
        EXISTS (
          SELECT 1
          FROM reports r
          JOIN workspace_members wm ON wm.workspace_id = r.workspace_id
          WHERE r.id = report_sections.report_id
            AND wm.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM reports r
          JOIN workspace_members wm ON wm.workspace_id = r.workspace_id
          WHERE r.id = report_sections.report_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'report_sections' AND policyname = 'report_sections_delete'
  ) THEN
    CREATE POLICY report_sections_delete ON report_sections
      FOR DELETE USING (
        EXISTS (
          SELECT 1
          FROM reports r
          JOIN workspace_members wm ON wm.workspace_id = r.workspace_id
          WHERE r.id = report_sections.report_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'report_artifacts' AND policyname = 'report_artifacts_read'
  ) THEN
    CREATE POLICY report_artifacts_read ON report_artifacts
      FOR SELECT USING (
        EXISTS (
          SELECT 1
          FROM reports r
          JOIN workspace_members wm ON wm.workspace_id = r.workspace_id
          WHERE r.id = report_artifacts.report_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'report_artifacts' AND policyname = 'report_artifacts_insert'
  ) THEN
    CREATE POLICY report_artifacts_insert ON report_artifacts
      FOR INSERT WITH CHECK (
        EXISTS (
          SELECT 1
          FROM reports r
          JOIN workspace_members wm ON wm.workspace_id = r.workspace_id
          WHERE r.id = report_artifacts.report_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'report_artifacts' AND policyname = 'report_artifacts_update'
  ) THEN
    CREATE POLICY report_artifacts_update ON report_artifacts
      FOR UPDATE USING (
        EXISTS (
          SELECT 1
          FROM reports r
          JOIN workspace_members wm ON wm.workspace_id = r.workspace_id
          WHERE r.id = report_artifacts.report_id
            AND wm.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM reports r
          JOIN workspace_members wm ON wm.workspace_id = r.workspace_id
          WHERE r.id = report_artifacts.report_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'report_artifacts' AND policyname = 'report_artifacts_delete'
  ) THEN
    CREATE POLICY report_artifacts_delete ON report_artifacts
      FOR DELETE USING (
        EXISTS (
          SELECT 1
          FROM reports r
          JOIN workspace_members wm ON wm.workspace_id = r.workspace_id
          WHERE r.id = report_artifacts.report_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION set_reports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reports_updated_at ON reports;
CREATE TRIGGER trg_reports_updated_at
BEFORE UPDATE ON reports
FOR EACH ROW
EXECUTE FUNCTION set_reports_updated_at();

DROP TRIGGER IF EXISTS trg_report_runs_updated_at ON report_runs;
CREATE TRIGGER trg_report_runs_updated_at
BEFORE UPDATE ON report_runs
FOR EACH ROW
EXECUTE FUNCTION set_reports_updated_at();

DROP TRIGGER IF EXISTS trg_report_sections_updated_at ON report_sections;
CREATE TRIGGER trg_report_sections_updated_at
BEFORE UPDATE ON report_sections
FOR EACH ROW
EXECUTE FUNCTION set_reports_updated_at();

DROP TRIGGER IF EXISTS trg_report_artifacts_updated_at ON report_artifacts;
CREATE TRIGGER trg_report_artifacts_updated_at
BEFORE UPDATE ON report_artifacts
FOR EACH ROW
EXECUTE FUNCTION set_reports_updated_at();
