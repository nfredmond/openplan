-- One engagement campaign can cover several projects.
--
-- ============================================================== WHY
--
-- A corridor-wide comment window is one consultation about many capital
-- projects, and until now the schema could only record one of them:
-- `engagement_campaigns.project_id` is a single nullable FK. Agencies worked
-- around it by running duplicate campaigns or by filing the campaign against
-- whichever project seemed most important, which silently disconnected every
-- other project from the public input that was collected about it.
--
-- ==================================================== WHAT project_id NOW MEANS
--
-- `engagement_campaigns.project_id` STAYS, and it means the LEAD project. Too
-- many readers consume it tonight to migrate them all safely (the public
-- portal's map framing, report linkage, RTP comment-response, the assistant
-- context, grant engagement evidence). This table carries the FULL set of
-- projects the campaign covers, INCLUDING the lead — it is the one source of
-- truth for "which projects does this campaign cover". The lead row is kept
-- present by the sync trigger below, so a reader of this table never needs to
-- also union in the lead column.
--
-- DELIBERATELY UNCHANGED TONIGHT: RTP comment-response linkage and report
-- linkage keep reading `engagement_campaigns.project_id` (lead-project
-- semantics). Widening those is its own decision for its own change; recording
-- that here keeps a future reader from treating their lead-only reads as an
-- oversight.

CREATE TABLE IF NOT EXISTS engagement_campaign_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES engagement_campaigns(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, project_id)
);

COMMENT ON TABLE engagement_campaign_projects IS
  'The full set of projects an engagement campaign covers, INCLUDING the lead. engagement_campaigns.project_id remains the LEAD project; a trigger keeps the lead''s row present here, so this table alone answers "which projects does this campaign cover". RTP comment-response and report linkage deliberately still read the lead column only. A row is an immutable pair: correcting one is delete-and-insert, so the table has no UPDATE policy and no updated_at.';

-- The UNIQUE constraint already indexes (campaign_id, project_id); these two
-- serve the reverse lookups: "which campaigns cover this project" (the project
-- page and the /engagement catalog filter) and workspace-wide sweeps.
CREATE INDEX IF NOT EXISTS idx_engagement_campaign_projects_project
  ON engagement_campaign_projects(project_id);
CREATE INDEX IF NOT EXISTS idx_engagement_campaign_projects_workspace
  ON engagement_campaign_projects(workspace_id);

-- ==================================================== CROSS-WORKSPACE UNSTORABLE
--
-- The route verifies every id it links, but a constraint outlives a route: a
-- row whose campaign or project lives in a different workspace than the row
-- claims must be unstorable, not merely unlikely.

CREATE OR REPLACE FUNCTION validate_engagement_campaign_project_scope()
RETURNS TRIGGER
SET search_path = public, pg_temp
AS $$
DECLARE
  campaign_workspace_id UUID;
  project_workspace_id UUID;
BEGIN
  SELECT workspace_id INTO campaign_workspace_id
  FROM engagement_campaigns WHERE id = NEW.campaign_id;

  SELECT workspace_id INTO project_workspace_id
  FROM projects WHERE id = NEW.project_id;

  IF campaign_workspace_id IS NULL OR campaign_workspace_id <> NEW.workspace_id THEN
    RAISE EXCEPTION 'engagement campaign project link must carry its campaign''s workspace';
  END IF;

  IF project_workspace_id IS NULL OR project_workspace_id <> NEW.workspace_id THEN
    RAISE EXCEPTION 'engagement campaign project link must stay inside the campaign''s workspace';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_engagement_campaign_projects_scope ON engagement_campaign_projects;
CREATE TRIGGER trg_engagement_campaign_projects_scope
BEFORE INSERT OR UPDATE ON engagement_campaign_projects
FOR EACH ROW
EXECUTE FUNCTION validate_engagement_campaign_project_scope();

-- ======================================================= THE LEAD IS ALWAYS IN
--
-- Structural, not conventional: every writer of engagement_campaigns.project_id
-- (this console's PATCH, the campaign creator, the RTP-side creator, any future
-- route) keeps the invariant without knowing it exists. The trigger only ADDS —
-- removing a project from a campaign's coverage is an explicit, human decision
-- made through the campaign console, never a side effect of changing the lead.
-- SECURITY INVOKER on purpose: anyone allowed to set a campaign's lead project
-- is allowed to record its coverage row, and both writes are writer-role gated.

CREATE OR REPLACE FUNCTION sync_engagement_campaign_lead_project()
RETURNS TRIGGER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.project_id IS NOT NULL THEN
    INSERT INTO engagement_campaign_projects (workspace_id, campaign_id, project_id, created_by)
    VALUES (NEW.workspace_id, NEW.id, NEW.project_id, auth.uid())
    ON CONFLICT (campaign_id, project_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_engagement_campaigns_sync_lead_project ON engagement_campaigns;
CREATE TRIGGER trg_engagement_campaigns_sync_lead_project
AFTER INSERT OR UPDATE OF project_id ON engagement_campaigns
FOR EACH ROW
EXECUTE FUNCTION sync_engagement_campaign_lead_project();

-- ============================================================== BACKFILL
--
-- Every campaign that already names a lead project gets its coverage row, so
-- "this table carries the full set including the lead" is true for existing
-- data on the first read, not only for campaigns touched after tonight.
-- ON CONFLICT makes the migration re-runnable. The join repeats the scope
-- check the trigger enforces: nothing in the old schema prevented a legacy
-- campaign from pointing at another workspace's project, and ONE such row
-- would otherwise abort this whole migration on a database nobody can
-- inspect. A mismatched lead is skipped here, exactly as it behaved before —
-- the lead column keeps carrying it; only the coverage table refuses it.

INSERT INTO engagement_campaign_projects (workspace_id, campaign_id, project_id, created_by)
SELECT c.workspace_id, c.id, c.project_id, c.created_by
FROM engagement_campaigns c
JOIN projects p ON p.id = c.project_id AND p.workspace_id = c.workspace_id
WHERE c.project_id IS NOT NULL
ON CONFLICT (campaign_id, project_id) DO NOTHING;

-- ============================================================== RLS
--
-- Reads mirror the campaign policies (workspace membership). Writes are
-- ROLE-AWARE at the permissive layer via `public.workspace_member_can_write`
-- — the intended shape for a post-20260728000006 table — so this table needs
-- no companion RESTRICTIVE gate and never depends on that migration's VALUES
-- loop remembering it exists. No UPDATE policy on purpose: a link row is an
-- immutable pair, corrected by delete-and-insert.

ALTER TABLE engagement_campaign_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY engagement_campaign_projects_read ON engagement_campaign_projects
  FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );

CREATE POLICY engagement_campaign_projects_writer_insert ON engagement_campaign_projects
  FOR INSERT WITH CHECK (public.workspace_member_can_write(workspace_id));

CREATE POLICY engagement_campaign_projects_writer_delete ON engagement_campaign_projects
  FOR DELETE USING (public.workspace_member_can_write(workspace_id));


-- Grants are EXPLICIT since 20260804000001 flipped default privileges to deny.
-- No UPDATE grant to authenticated: with no UPDATE policy it could never pass
-- RLS, and granting a privilege the policy layer always refuses is noise a
-- future auditor has to explain away.
GRANT SELECT, INSERT, DELETE ON engagement_campaign_projects TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON engagement_campaign_projects TO service_role;
