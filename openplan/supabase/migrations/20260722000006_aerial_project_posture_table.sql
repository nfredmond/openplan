-- Wave 6 (aerial separability): move the cached aerial posture OUT of the shared
-- `projects` table into an aerial-owned table. The posture is an aerial concern;
-- keeping it as a column on `projects` couples the shared project spine to the
-- aerial module. Relocating it lets the aerial product (which ships its own
-- accounts/RBAC and is independently sellable) own its storage. The write path
-- (buildAerialProjectPosture -> rebuildAerialProjectPosture) and the project /
-- mission read surfaces move with it in the same change.

CREATE TABLE IF NOT EXISTS aerial_project_posture (
  project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  posture JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS aerial_project_posture_workspace_idx
  ON aerial_project_posture (workspace_id, updated_at DESC);

ALTER TABLE aerial_project_posture ENABLE ROW LEVEL SECURITY;

-- Same workspace-member posture as the other aerial tables: members read/write
-- their own workspace's rows; the service-role write path (processing callback)
-- bypasses RLS. A FOR ALL policy with only USING applies that predicate as the
-- WITH CHECK for INSERT/UPDATE too (matches aerial_missions / aerial_evidence_packages).
CREATE POLICY "workspace_members_can_read_aerial_project_posture"
  ON aerial_project_posture FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "workspace_members_can_write_aerial_project_posture"
  ON aerial_project_posture FOR ALL
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

-- Backfill the authoritative cached posture from the retiring columns.
INSERT INTO aerial_project_posture (project_id, workspace_id, posture, updated_at)
SELECT p.id, p.workspace_id, p.aerial_posture, COALESCE(p.aerial_posture_updated_at, now())
FROM projects p
WHERE p.aerial_posture IS NOT NULL
ON CONFLICT (project_id) DO NOTHING;

-- Retire the cached columns on projects — the posture now lives in its own table.
DROP INDEX IF EXISTS projects_aerial_posture_updated_at_idx;
ALTER TABLE projects
  DROP COLUMN IF EXISTS aerial_posture,
  DROP COLUMN IF EXISTS aerial_posture_updated_at;
