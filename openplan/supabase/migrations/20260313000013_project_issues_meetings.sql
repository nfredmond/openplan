CREATE TABLE IF NOT EXISTS project_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'blocked', 'resolved')),
  owner_label TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT,
  meeting_at TIMESTAMPTZ,
  attendees_summary TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_issues_project_updated
  ON project_issues(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_meetings_project_updated
  ON project_meetings(project_id, updated_at DESC);

ALTER TABLE project_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_meetings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='project_issues' AND policyname='project_issues_read'
  ) THEN
    CREATE POLICY project_issues_read ON project_issues
      FOR SELECT USING (
        EXISTS (
          SELECT 1
          FROM projects p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = project_issues.project_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='project_issues' AND policyname='project_issues_insert'
  ) THEN
    CREATE POLICY project_issues_insert ON project_issues
      FOR INSERT WITH CHECK (
        EXISTS (
          SELECT 1
          FROM projects p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = project_issues.project_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='project_issues' AND policyname='project_issues_update'
  ) THEN
    CREATE POLICY project_issues_update ON project_issues
      FOR UPDATE USING (
        EXISTS (
          SELECT 1
          FROM projects p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = project_issues.project_id
            AND wm.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM projects p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = project_issues.project_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='project_meetings' AND policyname='project_meetings_read'
  ) THEN
    CREATE POLICY project_meetings_read ON project_meetings
      FOR SELECT USING (
        EXISTS (
          SELECT 1
          FROM projects p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = project_meetings.project_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='project_meetings' AND policyname='project_meetings_insert'
  ) THEN
    CREATE POLICY project_meetings_insert ON project_meetings
      FOR INSERT WITH CHECK (
        EXISTS (
          SELECT 1
          FROM projects p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = project_meetings.project_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='project_meetings' AND policyname='project_meetings_update'
  ) THEN
    CREATE POLICY project_meetings_update ON project_meetings
      FOR UPDATE USING (
        EXISTS (
          SELECT 1
          FROM projects p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = project_meetings.project_id
            AND wm.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM projects p
          JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
          WHERE p.id = project_meetings.project_id
            AND wm.user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DROP TRIGGER IF EXISTS trg_project_issues_updated_at ON project_issues;
CREATE TRIGGER trg_project_issues_updated_at
BEFORE UPDATE ON project_issues
FOR EACH ROW
EXECUTE FUNCTION set_project_subrecord_updated_at();

DROP TRIGGER IF EXISTS trg_project_meetings_updated_at ON project_meetings;
CREATE TRIGGER trg_project_meetings_updated_at
BEFORE UPDATE ON project_meetings
FOR EACH ROW
EXECUTE FUNCTION set_project_subrecord_updated_at();
