CREATE TABLE IF NOT EXISTS network_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  region_code TEXT,
  bbox JSONB, -- store [minX, minY, maxX, maxY]
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_network_packages_workspace_id
  ON network_packages(workspace_id);

ALTER TABLE network_packages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'network_packages' AND policyname = 'network_packages_read'
  ) THEN
    CREATE POLICY network_packages_read ON network_packages
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'network_packages' AND policyname = 'network_packages_insert'
  ) THEN
    CREATE POLICY network_packages_insert ON network_packages
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'network_packages' AND policyname = 'network_packages_update'
  ) THEN
    CREATE POLICY network_packages_update ON network_packages
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'network_packages' AND policyname = 'network_packages_delete'
  ) THEN
    CREATE POLICY network_packages_delete ON network_packages
      FOR DELETE USING (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION set_network_packages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_network_packages_updated_at ON network_packages;
CREATE TRIGGER trg_network_packages_updated_at
BEFORE UPDATE ON network_packages
FOR EACH ROW
EXECUTE FUNCTION set_network_packages_updated_at();


CREATE TABLE IF NOT EXISTS network_package_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES network_packages(id) ON DELETE CASCADE,
  version_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  s3_prefix TEXT,
  manifest_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_network_package_versions_package_id
  ON network_package_versions(package_id);

ALTER TABLE network_package_versions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'network_package_versions' AND policyname = 'network_package_versions_read'
  ) THEN
    CREATE POLICY network_package_versions_read ON network_package_versions
      FOR SELECT USING (
        package_id IN (
          SELECT np.id FROM network_packages np
          JOIN workspace_members wm ON wm.workspace_id = np.workspace_id
          WHERE wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'network_package_versions' AND policyname = 'network_package_versions_insert'
  ) THEN
    CREATE POLICY network_package_versions_insert ON network_package_versions
      FOR INSERT WITH CHECK (
        package_id IN (
          SELECT np.id FROM network_packages np
          JOIN workspace_members wm ON wm.workspace_id = np.workspace_id
          WHERE wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'network_package_versions' AND policyname = 'network_package_versions_update'
  ) THEN
    CREATE POLICY network_package_versions_update ON network_package_versions
      FOR UPDATE USING (
        package_id IN (
          SELECT np.id FROM network_packages np
          JOIN workspace_members wm ON wm.workspace_id = np.workspace_id
          WHERE wm.user_id = auth.uid()
        )
      )
      WITH CHECK (
        package_id IN (
          SELECT np.id FROM network_packages np
          JOIN workspace_members wm ON wm.workspace_id = np.workspace_id
          WHERE wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'network_package_versions' AND policyname = 'network_package_versions_delete'
  ) THEN
    CREATE POLICY network_package_versions_delete ON network_package_versions
      FOR DELETE USING (
        package_id IN (
          SELECT np.id FROM network_packages np
          JOIN workspace_members wm ON wm.workspace_id = np.workspace_id
          WHERE wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION set_network_package_versions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_network_package_versions_updated_at ON network_package_versions;
CREATE TRIGGER trg_network_package_versions_updated_at
BEFORE UPDATE ON network_package_versions
FOR EACH ROW
EXECUTE FUNCTION set_network_package_versions_updated_at();

-- Add network-packages storage bucket (using openplan's storage fn if accessible or raw insert)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('network-packages', 'network-packages', false)
ON CONFLICT (id) DO NOTHING;
