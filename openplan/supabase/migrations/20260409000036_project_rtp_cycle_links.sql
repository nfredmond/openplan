CREATE TABLE IF NOT EXISTS project_rtp_cycle_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rtp_cycle_id UUID NOT NULL REFERENCES rtp_cycles(id) ON DELETE CASCADE,
  portfolio_role TEXT NOT NULL DEFAULT 'candidate' CHECK (portfolio_role IN ('candidate', 'constrained', 'illustrative')),
  priority_rationale TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, rtp_cycle_id)
);

CREATE INDEX IF NOT EXISTS idx_project_rtp_cycle_links_project
  ON project_rtp_cycle_links(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_rtp_cycle_links_rtp_cycle
  ON project_rtp_cycle_links(rtp_cycle_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_rtp_cycle_links_workspace
  ON project_rtp_cycle_links(workspace_id, created_at DESC);

ALTER TABLE project_rtp_cycle_links ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'project_rtp_cycle_links'
      AND policyname = 'project_rtp_cycle_links_read'
  ) THEN
    CREATE POLICY project_rtp_cycle_links_read ON project_rtp_cycle_links
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
    WHERE schemaname = 'public'
      AND tablename = 'project_rtp_cycle_links'
      AND policyname = 'project_rtp_cycle_links_insert'
  ) THEN
    CREATE POLICY project_rtp_cycle_links_insert ON project_rtp_cycle_links
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
    WHERE schemaname = 'public'
      AND tablename = 'project_rtp_cycle_links'
      AND policyname = 'project_rtp_cycle_links_delete'
  ) THEN
    CREATE POLICY project_rtp_cycle_links_delete ON project_rtp_cycle_links
      FOR DELETE USING (
        workspace_id IN (
          SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;
