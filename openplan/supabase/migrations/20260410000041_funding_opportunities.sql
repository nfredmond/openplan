ALTER TABLE programs
  ADD COLUMN IF NOT EXISTS funding_classification TEXT
    CHECK (funding_classification IN ('formula', 'discretionary', 'mixed', 'other')),
  ADD COLUMN IF NOT EXISTS owner_label TEXT,
  ADD COLUMN IF NOT EXISTS cadence_label TEXT;

CREATE TABLE IF NOT EXISTS funding_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  program_id UUID REFERENCES programs(id) ON DELETE SET NULL,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  opportunity_status TEXT NOT NULL DEFAULT 'upcoming'
    CHECK (opportunity_status IN ('upcoming', 'open', 'closed', 'awarded', 'archived')),
  agency_name TEXT,
  owner_label TEXT,
  cadence_label TEXT,
  opens_at TIMESTAMPTZ,
  closes_at TIMESTAMPTZ,
  decision_due_at TIMESTAMPTZ,
  summary TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_funding_opportunities_workspace_updated_at
  ON funding_opportunities(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_funding_opportunities_workspace_status
  ON funding_opportunities(workspace_id, opportunity_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_funding_opportunities_program
  ON funding_opportunities(program_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_funding_opportunities_project
  ON funding_opportunities(project_id, updated_at DESC);

ALTER TABLE funding_opportunities ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'funding_opportunities' AND policyname = 'funding_opportunities_read'
  ) THEN
    CREATE POLICY funding_opportunities_read ON funding_opportunities
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
    WHERE schemaname = 'public' AND tablename = 'funding_opportunities' AND policyname = 'funding_opportunities_insert'
  ) THEN
    CREATE POLICY funding_opportunities_insert ON funding_opportunities
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
    WHERE schemaname = 'public' AND tablename = 'funding_opportunities' AND policyname = 'funding_opportunities_update'
  ) THEN
    CREATE POLICY funding_opportunities_update ON funding_opportunities
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
    WHERE schemaname = 'public' AND tablename = 'funding_opportunities' AND policyname = 'funding_opportunities_delete'
  ) THEN
    CREATE POLICY funding_opportunities_delete ON funding_opportunities
      FOR DELETE USING (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION set_funding_opportunities_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION touch_program_updated_at_from_funding_opportunities()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE programs
  SET updated_at = now()
  WHERE id = COALESCE(NEW.program_id, OLD.program_id);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_funding_opportunities_updated_at ON funding_opportunities;
CREATE TRIGGER trg_funding_opportunities_updated_at
BEFORE UPDATE ON funding_opportunities
FOR EACH ROW
EXECUTE FUNCTION set_funding_opportunities_updated_at();

DROP TRIGGER IF EXISTS trg_funding_opportunities_touch_program_insert ON funding_opportunities;
CREATE TRIGGER trg_funding_opportunities_touch_program_insert
AFTER INSERT ON funding_opportunities
FOR EACH ROW
EXECUTE FUNCTION touch_program_updated_at_from_funding_opportunities();

DROP TRIGGER IF EXISTS trg_funding_opportunities_touch_program_update ON funding_opportunities;
CREATE TRIGGER trg_funding_opportunities_touch_program_update
AFTER UPDATE ON funding_opportunities
FOR EACH ROW
EXECUTE FUNCTION touch_program_updated_at_from_funding_opportunities();

DROP TRIGGER IF EXISTS trg_funding_opportunities_touch_program_delete ON funding_opportunities;
CREATE TRIGGER trg_funding_opportunities_touch_program_delete
AFTER DELETE ON funding_opportunities
FOR EACH ROW
EXECUTE FUNCTION touch_program_updated_at_from_funding_opportunities();
