CREATE TABLE IF NOT EXISTS project_funding_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  funding_need_amount NUMERIC(14,2),
  local_match_need_amount NUMERIC(14,2),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS funding_awards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  program_id UUID REFERENCES programs(id) ON DELETE SET NULL,
  funding_opportunity_id UUID REFERENCES funding_opportunities(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  awarded_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  match_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  match_posture TEXT NOT NULL DEFAULT 'partial'
    CHECK (match_posture IN ('secured', 'partial', 'unfunded', 'not_required')),
  obligation_due_at TIMESTAMPTZ,
  spending_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (spending_status IN ('not_started', 'active', 'delayed', 'fully_spent')),
  risk_flag TEXT NOT NULL DEFAULT 'none'
    CHECK (risk_flag IN ('none', 'watch', 'critical')),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE billing_invoice_records
  ADD COLUMN IF NOT EXISTS funding_award_id UUID REFERENCES funding_awards(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_project_funding_profiles_project ON project_funding_profiles(project_id);
CREATE INDEX IF NOT EXISTS idx_funding_awards_project_updated_at ON funding_awards(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_funding_awards_opportunity ON funding_awards(funding_opportunity_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_invoice_records_funding_award ON billing_invoice_records(funding_award_id);

ALTER TABLE project_funding_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE funding_awards ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'project_funding_profiles' AND policyname = 'project_funding_profiles_read'
  ) THEN
    CREATE POLICY project_funding_profiles_read ON project_funding_profiles
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
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'project_funding_profiles' AND policyname = 'project_funding_profiles_insert'
  ) THEN
    CREATE POLICY project_funding_profiles_insert ON project_funding_profiles
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
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'project_funding_profiles' AND policyname = 'project_funding_profiles_update'
  ) THEN
    CREATE POLICY project_funding_profiles_update ON project_funding_profiles
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
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'project_funding_profiles' AND policyname = 'project_funding_profiles_delete'
  ) THEN
    CREATE POLICY project_funding_profiles_delete ON project_funding_profiles
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
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'funding_awards' AND policyname = 'funding_awards_read'
  ) THEN
    CREATE POLICY funding_awards_read ON funding_awards
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
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'funding_awards' AND policyname = 'funding_awards_insert'
  ) THEN
    CREATE POLICY funding_awards_insert ON funding_awards
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
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'funding_awards' AND policyname = 'funding_awards_update'
  ) THEN
    CREATE POLICY funding_awards_update ON funding_awards
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
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'funding_awards' AND policyname = 'funding_awards_delete'
  ) THEN
    CREATE POLICY funding_awards_delete ON funding_awards
      FOR DELETE USING (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION set_project_funding_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_funding_awards_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_project_funding_profiles_updated_at ON project_funding_profiles;
CREATE TRIGGER trg_project_funding_profiles_updated_at
BEFORE UPDATE ON project_funding_profiles
FOR EACH ROW
EXECUTE FUNCTION set_project_funding_profiles_updated_at();

DROP TRIGGER IF EXISTS trg_funding_awards_updated_at ON funding_awards;
CREATE TRIGGER trg_funding_awards_updated_at
BEFORE UPDATE ON funding_awards
FOR EACH ROW
EXECUTE FUNCTION set_funding_awards_updated_at();
