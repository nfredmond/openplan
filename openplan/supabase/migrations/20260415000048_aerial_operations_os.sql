-- Aerial Operations OS: core object contract
--
-- aerial_missions: one mission = one field collection event, tied to a
-- workspace and optionally to a project.  All other aerial objects hang
-- off a mission.
--
-- aerial_evidence_packages: measurable-output or share bundles produced
-- from a mission.  These are the objects that contribute to the
-- evidence-chain posture visible in project detail and reports.

CREATE TABLE IF NOT EXISTS aerial_missions (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id        UUID        REFERENCES projects(id) ON DELETE SET NULL,
  title             TEXT        NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'planned',
  -- planned | active | complete | cancelled
  mission_type      TEXT        NOT NULL DEFAULT 'corridor_survey',
  -- corridor_survey | site_inspection | aoi_capture | general
  geography_label   TEXT,
  collected_at      TIMESTAMPTZ,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aerial_evidence_packages (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id               UUID        NOT NULL REFERENCES aerial_missions(id) ON DELETE CASCADE,
  workspace_id             UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id               UUID        REFERENCES projects(id) ON DELETE SET NULL,
  title                    TEXT        NOT NULL,
  package_type             TEXT        NOT NULL DEFAULT 'measurable_output',
  -- measurable_output | qa_bundle | share_package
  status                   TEXT        NOT NULL DEFAULT 'processing',
  -- processing | qa_pending | ready | shared
  verification_readiness   TEXT        NOT NULL DEFAULT 'pending',
  -- pending | partial | ready | not_applicable
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for workspace- and project-scoped lookups
CREATE INDEX IF NOT EXISTS aerial_missions_workspace_id_idx  ON aerial_missions(workspace_id);
CREATE INDEX IF NOT EXISTS aerial_missions_project_id_idx    ON aerial_missions(project_id);
CREATE INDEX IF NOT EXISTS aerial_evidence_packages_mission_id_idx  ON aerial_evidence_packages(mission_id);
CREATE INDEX IF NOT EXISTS aerial_evidence_packages_project_id_idx  ON aerial_evidence_packages(project_id);

-- Row-level security
ALTER TABLE aerial_missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE aerial_evidence_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_members_can_read_aerial_missions"
  ON aerial_missions FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "workspace_members_can_write_aerial_missions"
  ON aerial_missions FOR ALL
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "workspace_members_can_read_aerial_evidence_packages"
  ON aerial_evidence_packages FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "workspace_members_can_write_aerial_evidence_packages"
  ON aerial_evidence_packages FOR ALL
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );
