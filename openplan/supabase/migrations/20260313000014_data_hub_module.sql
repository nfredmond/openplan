CREATE TABLE IF NOT EXISTS data_connectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'custom' CHECK (
    source_type IN ('census', 'lodes', 'gtfs', 'crashes', 'parcel', 'manual', 'custom', 'policy')
  ),
  category TEXT NOT NULL DEFAULT 'internal' CHECK (
    category IN ('federal', 'state', 'regional', 'local', 'vendor', 'internal')
  ),
  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('draft', 'active', 'degraded', 'offline')
  ),
  cadence TEXT NOT NULL DEFAULT 'manual' CHECK (
    cadence IN ('manual', 'daily', 'weekly', 'monthly', 'quarterly', 'annual', 'ad_hoc')
  ),
  auth_mode TEXT NOT NULL DEFAULT 'none' CHECK (
    auth_mode IN ('none', 'api_key', 'oauth', 'service_account', 'manual_upload')
  ),
  endpoint_url TEXT,
  owner_label TEXT,
  description TEXT,
  policy_monitor_enabled BOOLEAN NOT NULL DEFAULT false,
  last_sync_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error_at TIMESTAMPTZ,
  last_error_message TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_data_connectors_workspace_key
  ON data_connectors(workspace_id, key);
CREATE INDEX IF NOT EXISTS idx_data_connectors_workspace_updated_at
  ON data_connectors(workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS data_datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connector_id UUID REFERENCES data_connectors(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'ready', 'refreshing', 'stale', 'error', 'archived')
  ),
  geography_scope TEXT NOT NULL DEFAULT 'none' CHECK (
    geography_scope IN ('none', 'point', 'route', 'corridor', 'tract', 'county', 'region', 'statewide', 'national')
  ),
  coverage_summary TEXT,
  vintage_label TEXT,
  source_url TEXT,
  license_label TEXT,
  citation_text TEXT,
  schema_version TEXT,
  checksum TEXT,
  row_count INTEGER CHECK (row_count IS NULL OR row_count >= 0),
  refresh_cadence TEXT NOT NULL DEFAULT 'manual' CHECK (
    refresh_cadence IN ('manual', 'daily', 'weekly', 'monthly', 'quarterly', 'annual', 'ad_hoc')
  ),
  last_refreshed_at TIMESTAMPTZ,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_data_datasets_workspace_updated_at
  ON data_datasets(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_data_datasets_connector_updated_at
  ON data_datasets(connector_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS data_refresh_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  connector_id UUID REFERENCES data_connectors(id) ON DELETE SET NULL,
  dataset_id UUID REFERENCES data_datasets(id) ON DELETE SET NULL,
  job_name TEXT NOT NULL,
  job_type TEXT NOT NULL DEFAULT 'refresh' CHECK (
    job_type IN ('ingest', 'refresh', 'validation', 'backfill')
  ),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')
  ),
  refresh_mode TEXT NOT NULL DEFAULT 'manual' CHECK (
    refresh_mode IN ('manual', 'scheduled', 'pipeline', 'analysis_runtime')
  ),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  records_written INTEGER CHECK (records_written IS NULL OR records_written >= 0),
  triggered_by_label TEXT,
  error_summary TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (connector_id IS NOT NULL OR dataset_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_data_refresh_jobs_workspace_created_at
  ON data_refresh_jobs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_data_refresh_jobs_dataset_created_at
  ON data_refresh_jobs(dataset_id, created_at DESC);

CREATE TABLE IF NOT EXISTS data_dataset_project_links (
  dataset_id UUID NOT NULL REFERENCES data_datasets(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL DEFAULT 'reference' CHECK (
    relationship_type IN ('primary_input', 'reference', 'evidence', 'baseline')
  ),
  linked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (dataset_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_data_dataset_project_links_project
  ON data_dataset_project_links(project_id, linked_at DESC);

ALTER TABLE data_connectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_refresh_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_dataset_project_links ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'data_connectors' AND policyname = 'data_connectors_read'
  ) THEN
    CREATE POLICY data_connectors_read ON data_connectors
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'data_connectors' AND policyname = 'data_connectors_insert'
  ) THEN
    CREATE POLICY data_connectors_insert ON data_connectors
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'data_connectors' AND policyname = 'data_connectors_update'
  ) THEN
    CREATE POLICY data_connectors_update ON data_connectors
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'data_datasets' AND policyname = 'data_datasets_read'
  ) THEN
    CREATE POLICY data_datasets_read ON data_datasets
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'data_datasets' AND policyname = 'data_datasets_insert'
  ) THEN
    CREATE POLICY data_datasets_insert ON data_datasets
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'data_datasets' AND policyname = 'data_datasets_update'
  ) THEN
    CREATE POLICY data_datasets_update ON data_datasets
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'data_refresh_jobs' AND policyname = 'data_refresh_jobs_read'
  ) THEN
    CREATE POLICY data_refresh_jobs_read ON data_refresh_jobs
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'data_refresh_jobs' AND policyname = 'data_refresh_jobs_insert'
  ) THEN
    CREATE POLICY data_refresh_jobs_insert ON data_refresh_jobs
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'data_refresh_jobs' AND policyname = 'data_refresh_jobs_update'
  ) THEN
    CREATE POLICY data_refresh_jobs_update ON data_refresh_jobs
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'data_dataset_project_links' AND policyname = 'data_dataset_project_links_read'
  ) THEN
    CREATE POLICY data_dataset_project_links_read ON data_dataset_project_links
      FOR SELECT USING (
        EXISTS (
          SELECT 1
          FROM data_datasets d
          JOIN workspace_members wm ON wm.workspace_id = d.workspace_id
          WHERE d.id = data_dataset_project_links.dataset_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'data_dataset_project_links' AND policyname = 'data_dataset_project_links_insert'
  ) THEN
    CREATE POLICY data_dataset_project_links_insert ON data_dataset_project_links
      FOR INSERT WITH CHECK (
        EXISTS (
          SELECT 1
          FROM data_datasets d
          JOIN workspace_members wm ON wm.workspace_id = d.workspace_id
          WHERE d.id = data_dataset_project_links.dataset_id
            AND wm.user_id = auth.uid()
        )
        AND EXISTS (
          SELECT 1
          FROM projects p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = data_dataset_project_links.project_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'data_dataset_project_links' AND policyname = 'data_dataset_project_links_update'
  ) THEN
    CREATE POLICY data_dataset_project_links_update ON data_dataset_project_links
      FOR UPDATE USING (
        EXISTS (
          SELECT 1
          FROM data_datasets d
          JOIN workspace_members wm ON wm.workspace_id = d.workspace_id
          WHERE d.id = data_dataset_project_links.dataset_id
            AND wm.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM data_datasets d
          JOIN workspace_members wm ON wm.workspace_id = d.workspace_id
          WHERE d.id = data_dataset_project_links.dataset_id
            AND wm.user_id = auth.uid()
        )
        AND EXISTS (
          SELECT 1
          FROM projects p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = data_dataset_project_links.project_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION set_data_hub_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_data_connectors_updated_at ON data_connectors;
CREATE TRIGGER trg_data_connectors_updated_at
BEFORE UPDATE ON data_connectors
FOR EACH ROW
EXECUTE FUNCTION set_data_hub_updated_at();

DROP TRIGGER IF EXISTS trg_data_datasets_updated_at ON data_datasets;
CREATE TRIGGER trg_data_datasets_updated_at
BEFORE UPDATE ON data_datasets
FOR EACH ROW
EXECUTE FUNCTION set_data_hub_updated_at();
