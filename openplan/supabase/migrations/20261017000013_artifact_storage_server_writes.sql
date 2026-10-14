-- Generated reports and grant application exports are stored by the server
-- only, so the workspace storage limit (20261017000010) cannot be bypassed.
--
-- Before this migration a signed-in owner, admin or member could upload
-- straight into the report-artifacts and grant-application-exports buckets
-- with their own token, up to the 50 MB per-file ceiling, as many times as
-- they liked. Two permissive INSERT policies allowed it:
--   report_artifacts_workspace_insert          (20260420000060)
--   grant_application_exports_workspace_insert (20260727000014)
-- The restrictive artifact_storage_writer_insert gate (20261015000002) only
-- narrowed them to writer roles. None of those writes went through
-- checkWorkspaceStorageRoom, so the per-workspace total did not hold.
--
-- Nothing in the application needs those policies once this lands. The only
-- writers that used a member token were two server routes, and both now
-- check the workspace storage limit and write with the service role:
--   POST /api/reports/[reportId]/generate
--   POST /api/funding-opportunities/[opportunityId]/application/export
-- No browser code uploads to either bucket. Every other writer (the frozen
-- aerial preview in a report packet and the engagement review export worker)
-- already used the service role.
--
-- What this changes:
--   * Drops the two permissive INSERT policies above. With no permissive
--     INSERT policy left for these buckets, an anon or authenticated insert is
--     refused by row level security. The service role bypasses row level
--     security and is unaffected.
--
-- What this keeps:
--   * Every existing object and its bytes. No row in storage.objects or any
--     application table is read, changed or removed.
--   * Member reads: report_artifacts_workspace_read and
--     grant_application_exports_workspace_read are untouched, as is the
--     restrictive engagement_export_route_only SELECT gate.
--   * UPDATE and DELETE: neither bucket ever had a member UPDATE or DELETE
--     policy, and none is added, so both stay refused to members.
--   * artifact_storage_writer_insert stays in place. It no longer admits
--     anything for these buckets on its own; if a permissive INSERT policy
--     were ever restored, it would still keep viewers out.
--
-- Deploy order: apply this migration together with, or after, the code that
-- moves the two routes to the service role. Code still on the member token
-- would fail to store PDFs once this runs.

BEGIN;

DROP POLICY IF EXISTS report_artifacts_workspace_insert ON storage.objects;
DROP POLICY IF EXISTS grant_application_exports_workspace_insert ON storage.objects;

-- Postcondition: no permissive INSERT or ALL policy on storage.objects may
-- still name either bucket, whatever it is called. A policy created by hand
-- under another name would reopen the bypass; refuse to finish instead.
DO $$
DECLARE
  survivor text;
BEGIN
  SELECT string_agg(policyname, ', ' ORDER BY policyname)
    INTO survivor
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND permissive = 'PERMISSIVE'
      AND cmd IN ('INSERT', 'ALL')
      AND (coalesce(with_check, '') || ' ' || coalesce(qual, '')) ~ '(report-artifacts|grant-application-exports)';
  IF survivor IS NOT NULL THEN
    RAISE EXCEPTION 'Storage policies still let members write generated reports or exports: %', survivor;
  END IF;
END $$;

COMMIT;
