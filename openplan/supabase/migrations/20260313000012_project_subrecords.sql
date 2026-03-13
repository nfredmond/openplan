CREATE TABLE IF NOT EXISTS project_deliverables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT,
  owner_label TEXT,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'blocked', 'complete')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_risks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'watch', 'mitigated', 'closed')),
  mitigation TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  rationale TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'rejected')),
  impact_summary TEXT,
  decided_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_deliverables_project_updated
  ON project_deliverables(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_risks_project_updated
  ON project_risks(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_decisions_project_updated
  ON project_decisions(project_id, updated_at DESC);

ALTER TABLE project_deliverables ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_risks ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_decisions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='project_deliverables' AND policyname='project_deliverables_read'
  ) THEN
    CREATE POLICY project_deliverables_read ON project_deliverables
      FOR SELECT USING (
        EXISTS (
          SELECT 1
          FROM projects p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = project_deliverables.project_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='project_deliverables' AND policyname='project_deliverables_insert'
  ) THEN
    CREATE POLICY project_deliverables_insert ON project_deliverables
      FOR INSERT WITH CHECK (
        EXISTS (
          SELECT 1
          FROM projects p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = project_deliverables.project_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='project_deliverables' AND policyname='project_deliverables_update'
  ) THEN
    CREATE POLICY project_deliverables_update ON project_deliverables
      FOR UPDATE USING (
        EXISTS (
          SELECT 1
          FROM projects p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = project_deliverables.project_id
            AND wm.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM projects p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = project_deliverables.project_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='project_risks' AND policyname='project_risks_read'
  ) THEN
    CREATE POLICY project_risks_read ON project_risks
      FOR SELECT USING (
        EXISTS (
          SELECT 1
          FROM projects p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = project_risks.project_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='project_risks' AND policyname='project_risks_insert'
  ) THEN
    CREATE POLICY project_risks_insert ON project_risks
      FOR INSERT WITH CHECK (
        EXISTS (
          SELECT 1
          FROM projects p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = project_risks.project_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='project_risks' AND policyname='project_risks_update'
  ) THEN
    CREATE POLICY project_risks_update ON project_risks
      FOR UPDATE USING (
        EXISTS (
          SELECT 1
          FROM projects p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = project_risks.project_id
            AND wm.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM projects p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = project_risks.project_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='project_decisions' AND policyname='project_decisions_read'
  ) THEN
    CREATE POLICY project_decisions_read ON project_decisions
      FOR SELECT USING (
        EXISTS (
          SELECT 1
          FROM projects p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = project_decisions.project_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='project_decisions' AND policyname='project_decisions_insert'
  ) THEN
    CREATE POLICY project_decisions_insert ON project_decisions
      FOR INSERT WITH CHECK (
        EXISTS (
          SELECT 1
          FROM projects p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = project_decisions.project_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='project_decisions' AND policyname='project_decisions_update'
  ) THEN
    CREATE POLICY project_decisions_update ON project_decisions
      FOR UPDATE USING (
        EXISTS (
          SELECT 1
          FROM projects p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = project_decisions.project_id
            AND wm.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM projects p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = project_decisions.project_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION set_project_subrecord_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_project_deliverables_updated_at ON project_deliverables;
CREATE TRIGGER trg_project_deliverables_updated_at
BEFORE UPDATE ON project_deliverables
FOR EACH ROW
EXECUTE FUNCTION set_project_subrecord_updated_at();

DROP TRIGGER IF EXISTS trg_project_risks_updated_at ON project_risks;
CREATE TRIGGER trg_project_risks_updated_at
BEFORE UPDATE ON project_risks
FOR EACH ROW
EXECUTE FUNCTION set_project_subrecord_updated_at();

DROP TRIGGER IF EXISTS trg_project_decisions_updated_at ON project_decisions;
CREATE TRIGGER trg_project_decisions_updated_at
BEFORE UPDATE ON project_decisions
FOR EACH ROW
EXECUTE FUNCTION set_project_subrecord_updated_at();
