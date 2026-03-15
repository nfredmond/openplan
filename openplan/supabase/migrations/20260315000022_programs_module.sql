CREATE TABLE IF NOT EXISTS programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  program_type TEXT NOT NULL CHECK (program_type IN ('rtip', 'stip', 'itip', 'tcep', 'local_measure', 'other')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'assembling', 'submitted', 'programmed', 'adopted', 'archived')),
  cycle_name TEXT NOT NULL,
  sponsor_agency TEXT,
  fiscal_year_start INTEGER CHECK (fiscal_year_start IS NULL OR (fiscal_year_start >= 2000 AND fiscal_year_start <= 2300)),
  fiscal_year_end INTEGER CHECK (
    fiscal_year_end IS NULL
    OR (fiscal_year_end >= 2000 AND fiscal_year_end <= 2300)
  ),
  nomination_due_at TIMESTAMPTZ,
  adoption_target_at TIMESTAMPTZ,
  summary TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    fiscal_year_start IS NULL
    OR fiscal_year_end IS NULL
    OR fiscal_year_end >= fiscal_year_start
  )
);

CREATE TABLE IF NOT EXISTS program_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL CHECK (link_type IN ('plan', 'report', 'engagement_campaign', 'project_record')),
  linked_id UUID NOT NULL,
  label TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(program_id, link_type, linked_id)
);

CREATE INDEX IF NOT EXISTS idx_programs_workspace_updated_at
  ON programs(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_programs_project_updated_at
  ON programs(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_programs_workspace_type_status
  ON programs(workspace_id, program_type, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_program_links_program_id
  ON program_links(program_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_program_links_program_type
  ON program_links(program_id, link_type, created_at ASC);

ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_links ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'programs' AND policyname = 'programs_read'
  ) THEN
    CREATE POLICY programs_read ON programs
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'programs' AND policyname = 'programs_insert'
  ) THEN
    CREATE POLICY programs_insert ON programs
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'programs' AND policyname = 'programs_update'
  ) THEN
    CREATE POLICY programs_update ON programs
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'programs' AND policyname = 'programs_delete'
  ) THEN
    CREATE POLICY programs_delete ON programs
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
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'program_links' AND policyname = 'program_links_read'
  ) THEN
    CREATE POLICY program_links_read ON program_links
      FOR SELECT USING (
        EXISTS (
          SELECT 1
          FROM programs p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = program_links.program_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'program_links' AND policyname = 'program_links_insert'
  ) THEN
    CREATE POLICY program_links_insert ON program_links
      FOR INSERT WITH CHECK (
        EXISTS (
          SELECT 1
          FROM programs p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = program_links.program_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'program_links' AND policyname = 'program_links_update'
  ) THEN
    CREATE POLICY program_links_update ON program_links
      FOR UPDATE USING (
        EXISTS (
          SELECT 1
          FROM programs p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = program_links.program_id
            AND wm.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM programs p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = program_links.program_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'program_links' AND policyname = 'program_links_delete'
  ) THEN
    CREATE POLICY program_links_delete ON program_links
      FOR DELETE USING (
        EXISTS (
          SELECT 1
          FROM programs p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = program_links.program_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION set_programs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION touch_program_updated_at_from_links()
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

DROP TRIGGER IF EXISTS trg_programs_updated_at ON programs;
CREATE TRIGGER trg_programs_updated_at
BEFORE UPDATE ON programs
FOR EACH ROW
EXECUTE FUNCTION set_programs_updated_at();

DROP TRIGGER IF EXISTS trg_program_links_updated_at ON program_links;
CREATE TRIGGER trg_program_links_updated_at
BEFORE UPDATE ON program_links
FOR EACH ROW
EXECUTE FUNCTION set_programs_updated_at();

DROP TRIGGER IF EXISTS trg_program_links_touch_program_insert ON program_links;
CREATE TRIGGER trg_program_links_touch_program_insert
AFTER INSERT ON program_links
FOR EACH ROW
EXECUTE FUNCTION touch_program_updated_at_from_links();

DROP TRIGGER IF EXISTS trg_program_links_touch_program_update ON program_links;
CREATE TRIGGER trg_program_links_touch_program_update
AFTER UPDATE ON program_links
FOR EACH ROW
EXECUTE FUNCTION touch_program_updated_at_from_links();

DROP TRIGGER IF EXISTS trg_program_links_touch_program_delete ON program_links;
CREATE TRIGGER trg_program_links_touch_program_delete
AFTER DELETE ON program_links
FOR EACH ROW
EXECUTE FUNCTION touch_program_updated_at_from_links();
