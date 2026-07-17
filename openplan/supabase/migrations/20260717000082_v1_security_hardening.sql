-- V1 security hardening: close cross-tenant and enumeration holes found in the
-- 2026-07-17 pre-launch review.
--
-- 1. projects_insert: the original policy (20260313000011) allowed
--    `OR created_by = auth.uid()`, letting any authenticated user insert a
--    project into ANY workspace by stamping themselves as creator.
-- 2. gtfs-uploads storage: bucket-wide authenticated read/upload let every
--    tenant read every other tenant's uploads. No app code reads or writes
--    this bucket today, so it becomes service-role-only.
-- 3. assistant_action_executions: the read policy exposed global
--    (workspace_id IS NULL) audit rows to every authenticated user.
-- 4. engagement public-share policies (20260321000032) tested share-token
--    EXISTENCE, not knowledge, so anon PostgREST could enumerate every shared
--    campaign across all workspaces. All public portal reads/writes go through
--    the service-role client with explicit share-token filters, so the anon
--    policies are dropped rather than rewritten.
-- 5. billing_invoice_records: API routes gate writes to owner/admin
--    (billing.invoices.write) but RLS only required membership, so direct
--    PostgREST writes bypassed the role matrix.

-- 1. Projects: insert only into workspaces you belong to.
DROP POLICY IF EXISTS projects_insert ON projects;
CREATE POLICY projects_insert ON projects
  FOR INSERT WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

-- 2. gtfs-uploads bucket: service-role only.
DROP POLICY IF EXISTS "authenticated_upload" ON storage.objects;
DROP POLICY IF EXISTS "authenticated_read" ON storage.objects;

-- 3. Assistant action audit rows: workspace members only, no global-row leak.
DROP POLICY IF EXISTS assistant_action_executions_workspace_read ON assistant_action_executions;
CREATE POLICY assistant_action_executions_workspace_read ON assistant_action_executions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = assistant_action_executions.workspace_id
        AND workspace_members.user_id = auth.uid()
    )
  );

-- 4. Engagement public share: drop anon enumeration policies.
DROP POLICY IF EXISTS engagement_campaigns_public_read ON engagement_campaigns;
DROP POLICY IF EXISTS engagement_categories_public_read ON engagement_categories;
DROP POLICY IF EXISTS engagement_items_public_read ON engagement_items;
DROP POLICY IF EXISTS engagement_items_public_insert ON engagement_items;

-- 5. Invoice register writes: owner/admin only, matching billing.invoices.write.
DROP POLICY IF EXISTS billing_invoice_records_insert ON billing_invoice_records;
CREATE POLICY billing_invoice_records_insert ON billing_invoice_records
  FOR INSERT WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS billing_invoice_records_update ON billing_invoice_records;
CREATE POLICY billing_invoice_records_update ON billing_invoice_records
  FOR UPDATE USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );
