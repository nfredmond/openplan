-- Close the remaining bypasses around governed agency decision packages.
-- Application routes provide fuller inventory checks, but direct authenticated
-- database clients must still be unable to submit or approve a malformed,
-- stale, or ambiguously disposed bundle.

CREATE OR REPLACE FUNCTION public.project_decision_package_manifest_is_ready(v_manifest jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog
AS $$
DECLARE
  v_entries jsonb;
  v_entry jsonb;
  v_evidence jsonb;
  v_plan_id text;
  v_plan_revision text;
  v_pdf_id text;
  v_pdf_checksum text;
  v_plan_entry_count integer;
  v_pdf_entry_count integer;
BEGIN
  IF coalesce(jsonb_typeof(v_manifest), '') <> 'object'
     OR coalesce(v_manifest->>'schemaVersion', '') <> 'project_evidence_manifest.v2'
     OR coalesce(v_manifest->>'purpose', '') <> 'retained_evidence_snapshot'
     OR v_manifest->'approvalOrPublication' IS DISTINCT FROM 'false'::jsonb
     OR coalesce(v_manifest->>'layerStatusTable', '') <> 'openplan_layer_status'
     OR coalesce(jsonb_typeof(v_manifest->'inventory'), '') <> 'object'
     OR v_manifest->'inventory'->'inventoryTruncated' IS DISTINCT FROM 'false'::jsonb
     OR coalesce(jsonb_typeof(v_manifest->'entries'), '') <> 'array'
     OR jsonb_array_length(v_manifest->'entries') = 0
     OR coalesce(jsonb_typeof(v_manifest->'selectedLinkedPlan'), '') <> 'object'
     OR coalesce(jsonb_typeof(v_manifest->'currentBoardOrReportPdf'), '') <> 'object'
  THEN
    RETURN false;
  END IF;

  v_entries := v_manifest->'entries';
  v_plan_id := v_manifest->'selectedLinkedPlan'->>'id';
  v_plan_revision := v_manifest->'selectedLinkedPlan'->>'revisionToken';
  v_pdf_id := v_manifest->'currentBoardOrReportPdf'->>'recordId';
  v_pdf_checksum := v_manifest->'currentBoardOrReportPdf'->>'checksumSha256';

  IF v_plan_id IS NULL
     OR v_plan_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR coalesce(jsonb_typeof(v_manifest->'selectedLinkedPlan'->'revisionToken'), '') <> 'string'
     OR coalesce(v_plan_revision, '') !~ '^[0-9a-f]{64}$'
     OR v_pdf_id IS NULL
     OR v_pdf_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR coalesce(jsonb_typeof(v_manifest->'currentBoardOrReportPdf'->'checksumSha256'), '') <> 'string'
     OR coalesce(v_pdf_checksum, '') !~ '^[0-9a-f]{64}$'
  THEN
    RETURN false;
  END IF;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_entries)
  LOOP
    v_evidence := v_entry->'evidence';
    IF coalesce(jsonb_typeof(v_entry), '') <> 'object'
       OR coalesce(jsonb_typeof(v_entry->'originalRecord'), '') <> 'object'
       OR coalesce(v_entry->'originalRecord'->>'sourceId', '') = ''
       OR coalesce(v_entry->'originalRecord'->>'recordId', '') = ''
       OR coalesce(jsonb_typeof(v_entry->'inclusion'), '') <> 'object'
       OR coalesce(v_entry->'inclusion'->>'status', '') NOT IN ('included', 'excluded', 'reference_only')
       OR coalesce(jsonb_typeof(v_evidence), '') <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(v_evidence)) <> 12
       OR coalesce(v_evidence->>'schemaVersion', '') <> 'openplan.evidence_descriptor.v1'
       OR coalesce(jsonb_typeof(v_evidence->'schemaVersion'), '') <> 'string'
       OR coalesce(jsonb_typeof(v_evidence->'stableEvidenceId'), '') <> 'string'
       OR coalesce(v_evidence->>'stableEvidenceId', '') !~ '^[0-9a-f]{64}$'
       OR coalesce(jsonb_typeof(v_evidence->'source'), '') <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(v_evidence->'source')) <> 3
       OR NOT (v_evidence->'source' ? 'kind')
       OR (
         v_evidence->'source'->'kind' IS DISTINCT FROM 'null'::jsonb
         AND coalesce(jsonb_typeof(v_evidence->'source'->'kind'), '') <> 'string'
       )
       OR (
         v_evidence->'source'->>'kind' IS NOT NULL
         AND btrim(v_evidence->'source'->>'kind') = ''
       )
       OR coalesce(jsonb_typeof(v_evidence->'source'->'label'), '') <> 'string'
       OR btrim(coalesce(v_evidence->'source'->>'label', '')) = ''
       OR NOT (v_evidence->'source' ? 'citation')
       OR (
         v_evidence->'source'->'citation' IS DISTINCT FROM 'null'::jsonb
         AND coalesce(jsonb_typeof(v_evidence->'source'->'citation'), '') <> 'string'
       )
       OR (
         v_evidence->'source'->>'citation' IS NOT NULL
         AND btrim(v_evidence->'source'->>'citation') = ''
       )
       OR NOT (v_evidence ? 'asOfDate')
       OR (
         v_evidence->'asOfDate' IS DISTINCT FROM 'null'::jsonb
         AND coalesce(jsonb_typeof(v_evidence->'asOfDate'), '') <> 'string'
       )
       OR (v_evidence->>'asOfDate' IS NOT NULL AND btrim(v_evidence->>'asOfDate') = '')
       OR (v_evidence->>'asOfDate' IS NOT NULL AND (v_evidence->>'asOfDate')::timestamptz IS NULL)
       OR NOT (v_evidence ? 'retrievedAt')
       OR (
         v_evidence->'retrievedAt' IS DISTINCT FROM 'null'::jsonb
         AND coalesce(jsonb_typeof(v_evidence->'retrievedAt'), '') <> 'string'
       )
       OR (v_evidence->>'retrievedAt' IS NOT NULL AND btrim(v_evidence->>'retrievedAt') = '')
       OR (v_evidence->>'retrievedAt' IS NOT NULL AND (v_evidence->>'retrievedAt')::timestamptz IS NULL)
       OR coalesce(jsonb_typeof(v_evidence->'evidenceStatus'), '') <> 'string'
       OR coalesce(v_evidence->>'evidenceStatus', '') NOT IN ('observed', 'modeled', 'administrative', 'reference', 'unknown')
       OR NOT (v_evidence ? 'claimTier')
       OR (
         v_evidence->'claimTier' IS DISTINCT FROM 'null'::jsonb
         AND coalesce(jsonb_typeof(v_evidence->'claimTier'), '') <> 'string'
       )
       OR (v_evidence->>'claimTier' IS NOT NULL AND btrim(v_evidence->>'claimTier') = '')
       OR coalesce(jsonb_typeof(v_evidence->'uncertainty'), '') <> 'array'
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(v_evidence->'uncertainty') element(value)
         WHERE jsonb_typeof(element.value) <> 'string'
           OR btrim(coalesce(element.value #>> '{}', '')) = ''
       )
       OR coalesce(jsonb_typeof(v_evidence->'limits'), '') <> 'array'
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(v_evidence->'limits') element(value)
         WHERE jsonb_typeof(element.value) <> 'string'
           OR btrim(coalesce(element.value #>> '{}', '')) = ''
       )
       OR NOT (v_evidence ? 'revisionToken')
       OR NOT (v_evidence ? 'checksumSha256')
       OR (
         v_evidence->'revisionToken' IS DISTINCT FROM 'null'::jsonb
         AND coalesce(jsonb_typeof(v_evidence->'revisionToken'), '') <> 'string'
       )
       OR (
         v_evidence->'checksumSha256' IS DISTINCT FROM 'null'::jsonb
         AND coalesce(jsonb_typeof(v_evidence->'checksumSha256'), '') <> 'string'
       )
       OR (
         v_evidence->>'revisionToken' IS NOT NULL
         AND coalesce(v_evidence->>'revisionToken', '') = ''
       )
       OR (
         v_evidence->>'checksumSha256' IS NOT NULL
         AND v_evidence->>'checksumSha256' !~ '^[0-9a-f]{64}$'
       )
       OR NOT (v_entry ? 'revisionToken')
       OR NOT (v_entry ? 'checksumSha256')
       OR (
         v_entry->'revisionToken' IS DISTINCT FROM 'null'::jsonb
         AND coalesce(jsonb_typeof(v_entry->'revisionToken'), '') <> 'string'
       )
       OR (
         v_entry->'checksumSha256' IS DISTINCT FROM 'null'::jsonb
         AND coalesce(jsonb_typeof(v_entry->'checksumSha256'), '') <> 'string'
       )
       OR (v_evidence->'revisionToken') IS DISTINCT FROM (v_entry->'revisionToken')
       OR (v_evidence->'checksumSha256') IS DISTINCT FROM (v_entry->'checksumSha256')
       OR coalesce(jsonb_typeof(v_evidence->'support'), '') <> 'object'
       OR (SELECT count(*) FROM jsonb_object_keys(v_evidence->'support')) <> 2
       OR coalesce(jsonb_typeof(v_evidence->'support'->'status'), '') <> 'string'
       OR coalesce(v_evidence->'support'->>'status', '') NOT IN ('supported', 'not_a_numeric_claim')
       OR NOT (v_evidence->'support' ? 'reason')
       OR v_evidence->'support'->'reason' IS DISTINCT FROM 'null'::jsonb
       OR (
         v_evidence->'support'->>'status' = 'supported'
         AND coalesce(v_evidence->'source'->>'kind', v_evidence->'source'->>'citation') IS NULL
       )
       OR (
         v_evidence->'support'->>'status' = 'supported'
         AND v_evidence->>'claimTier' IS NULL
       )
       OR (
         v_evidence->'support'->>'status' = 'supported'
         AND v_evidence->>'revisionToken' IS NULL
         AND v_evidence->>'checksumSha256' IS NULL
         AND v_evidence->>'asOfDate' IS NULL
       )
       OR (
         v_entry->'inclusion'->>'status' = 'included'
         AND (
           btrim(coalesce(v_entry->>'path', '')) = ''
           OR coalesce(v_entry->>'checksumSha256', '') !~ '^[0-9a-f]{64}$'
           OR coalesce(jsonb_typeof(v_entry->'retrieval'), '') <> 'object'
           OR coalesce(v_entry->'retrieval'->>'retrievedAt', '') = ''
           OR (v_entry->'retrieval'->>'retrievedAt')::timestamptz IS NULL
           OR v_entry->'retrieval'->'retrievedAt' IS DISTINCT FROM v_evidence->'retrievedAt'
           OR btrim(coalesce(v_entry->>'revisionToken', '')) = ''
           OR coalesce(jsonb_typeof(v_entry->'byteSize'), '') <> 'number'
           OR coalesce(v_entry->>'byteSize', '') !~ '^[0-9]+$'
           OR (v_entry->>'byteSize')::numeric > 9007199254740991
         )
       )
       OR (
         v_entry->'inclusion'->>'status' IN ('excluded', 'reference_only')
         AND v_entry->'path' IS DISTINCT FROM 'null'::jsonb
       )
    THEN
      RETURN false;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_plan_entry_count
  FROM jsonb_array_elements(v_entries) entry
  WHERE entry->>'path' = 'project/linked-plan.json'
    AND entry->'originalRecord'->>'sourceId' = 'linked_data'
    AND entry->'originalRecord'->>'recordId' = v_plan_id
    AND entry->'inclusion'->>'status' = 'included';

  SELECT count(*) INTO v_pdf_entry_count
  FROM jsonb_array_elements(v_entries) entry
  WHERE entry->'originalRecord'->>'sourceId' = 'report_artifacts'
    AND entry->>'contentType' = 'application/pdf'
    AND entry->'inclusion'->>'status' = 'included';

  IF v_plan_entry_count <> 1 OR v_pdf_entry_count <> 1 OR NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_entries) entry
    WHERE entry->'originalRecord'->>'sourceId' = 'report_artifacts'
      AND entry->'originalRecord'->>'recordId' = v_pdf_id
      AND entry->>'contentType' = 'application/pdf'
      AND entry->>'checksumSha256' = v_pdf_checksum
      AND entry->'inclusion'->>'status' = 'included'
      AND entry->>'path' IS NOT NULL
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
EXCEPTION WHEN others THEN
  RETURN false;
END;
$$;

COMMENT ON FUNCTION public.project_decision_package_manifest_is_ready(jsonb) IS
  'Fail-closed structural gate for governed v2 bundle manifests: one exact linked plan, one exact included PDF, and complete supported evidence descriptors.';

-- Bundle bytes are uploaded with the service role. Keep the terminal row on
-- the same trust boundary so an authenticated creator cannot race the server
-- and bind client-chosen hashes or manifests to the service-written object.
DROP POLICY IF EXISTS project_evidence_bundles_writer_finalize
  ON public.project_evidence_bundles;
REVOKE UPDATE ON public.project_evidence_bundles FROM authenticated;

-- A bundle/hash gets one disposition, and a returned package can advance only
-- through the existing one-to-one replacement edge to a different bundle.
CREATE UNIQUE INDEX project_decision_package_one_submission_per_bundle_idx
  ON public.project_decision_package_submissions(bundle_id);
CREATE UNIQUE INDEX project_decision_package_one_submission_per_hash_idx
  ON public.project_decision_package_submissions(workspace_id, project_id, bundle_sha256);
CREATE UNIQUE INDEX project_decision_package_one_decision_per_bundle_idx
  ON public.project_decision_package_decisions(bundle_id);
CREATE UNIQUE INDEX project_decision_package_one_decision_per_hash_idx
  ON public.project_decision_package_decisions(workspace_id, project_id, bundle_sha256);

-- Preserve the exact JSON bytes whose digest is recorded. Existing receipts
-- were already hashed from jsonb::text; this controlled append-only backfill
-- records that preimage without rewriting any historical receipt field.
ALTER TABLE public.project_decision_package_decisions
  ADD COLUMN receipt_canonical_json text;

ALTER TABLE public.project_decision_package_decisions
  DISABLE TRIGGER refuse_project_decision_package_decision_update;
UPDATE public.project_decision_package_decisions
SET receipt_canonical_json = receipt_json::text;
ALTER TABLE public.project_decision_package_decisions
  ENABLE TRIGGER refuse_project_decision_package_decision_update;

ALTER TABLE public.project_decision_package_decisions
  ALTER COLUMN receipt_canonical_json SET NOT NULL,
  ADD CONSTRAINT project_decision_package_receipt_canonical_json_shape CHECK (
    receipt_canonical_json::jsonb = receipt_json
    AND receipt_sha256 = encode(
      extensions.digest(convert_to(receipt_canonical_json, 'UTF8'), 'sha256'),
      'hex'
    )
  );

CREATE OR REPLACE FUNCTION public.validate_project_decision_package_submission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  v_bundle public.project_evidence_bundles%ROWTYPE;
  v_prior public.project_decision_package_submissions%ROWTYPE;
  v_prior_decision text;
  v_selected_plan_id uuid;
  v_current_pdf_id uuid;
  v_current_pdf_checksum text;
BEGIN
  SELECT * INTO v_bundle FROM public.project_evidence_bundles WHERE id = NEW.bundle_id;
  IF v_bundle.id IS NULL OR v_bundle.status <> 'ready' THEN
    RAISE EXCEPTION 'decision package submission requires a ready bundle';
  END IF;
  IF v_bundle.workspace_id <> NEW.workspace_id OR v_bundle.project_id <> NEW.project_id
     OR v_bundle.bundle_sha256 <> NEW.bundle_sha256 THEN
    RAISE EXCEPTION 'decision package submission must match the exact bundle hash and scope';
  END IF;
  -- Authenticated clients cannot address this private bucket. Its exact
  -- UUID-scoped object and immutable terminal row are the database-side trust
  -- anchor for the SHA-checked bytes written by the bundle service.
  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects stored_bundle
    WHERE stored_bundle.bucket_id = 'project-evidence-bundles'
      AND stored_bundle.bucket_id = v_bundle.storage_bucket
      AND stored_bundle.name = v_bundle.storage_path
      AND coalesce(stored_bundle.metadata->>'size', '') ~ '^[0-9]+$'
      AND (stored_bundle.metadata->>'size')::bigint = v_bundle.byte_count
  ) THEN
    RAISE EXCEPTION 'decision package submission requires the exact immutable stored ZIP object and byte count';
  END IF;
  IF NOT public.project_decision_package_manifest_is_ready(v_bundle.manifest_json) THEN
    RAISE EXCEPTION 'decision package submission requires a complete ready v2 manifest';
  END IF;
  IF v_bundle.manifest_json->>'bundleId' <> v_bundle.id::text
     OR v_bundle.manifest_json->>'workspaceId' <> v_bundle.workspace_id::text
     OR v_bundle.manifest_json->>'projectId' <> v_bundle.project_id::text
     OR (v_bundle.manifest_json->>'projectRevision')::timestamptz <> v_bundle.project_revision
  THEN
    RAISE EXCEPTION 'decision package manifest must match the frozen bundle identity and scope';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.projects project
    WHERE project.id = v_bundle.project_id
      AND project.workspace_id = v_bundle.workspace_id
      AND project.updated_at = v_bundle.project_revision
  ) THEN
    RAISE EXCEPTION 'decision package is stale because the project changed after freezing';
  END IF;
  v_selected_plan_id := (v_bundle.manifest_json->'selectedLinkedPlan'->>'id')::uuid;
  IF NOT EXISTS (
    SELECT 1 FROM public.plans plan
    WHERE plan.id = v_selected_plan_id
      AND plan.workspace_id = v_bundle.workspace_id
      AND plan.project_id = v_bundle.project_id
      AND plan.updated_at <= v_bundle.generated_at
  ) THEN
    RAISE EXCEPTION 'decision package is stale because the selected linked plan changed';
  END IF;
  v_current_pdf_id := (v_bundle.manifest_json->'currentBoardOrReportPdf'->>'recordId')::uuid;
  v_current_pdf_checksum := v_bundle.manifest_json->'currentBoardOrReportPdf'->>'checksumSha256';
  IF NOT EXISTS (
    SELECT 1
    FROM public.report_artifacts artifact
    JOIN public.reports report ON report.id = artifact.report_id
    WHERE artifact.id = v_current_pdf_id
      AND artifact.artifact_kind = 'pdf'
      AND artifact.storage_path IS NOT NULL
      AND artifact.updated_at <= v_bundle.generated_at
      AND report.workspace_id = v_bundle.workspace_id
      AND report.project_id = v_bundle.project_id
      AND report.updated_at <= v_bundle.generated_at
      AND (
        coalesce(artifact.metadata_json->>'checksumSha256', artifact.metadata_json->>'checksum_sha256') IS NULL
        OR lower(coalesce(
          artifact.metadata_json->>'checksumSha256',
          artifact.metadata_json->>'checksum_sha256'
        )) = v_current_pdf_checksum
      )
  ) THEN
    RAISE EXCEPTION 'decision package is stale because the current report PDF changed';
  END IF;
  IF v_bundle.generated_by = NEW.assigned_approver_id OR NEW.submitted_by = NEW.assigned_approver_id THEN
    RAISE EXCEPTION 'the assigned approver must differ from the bundle creator and submitter';
  END IF;
  IF NEW.submitted_by <> auth.uid() THEN
    RAISE EXCEPTION 'submission authorship does not match the caller';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members member
    WHERE member.workspace_id = NEW.workspace_id
      AND member.user_id = NEW.submitted_by
      AND member.role IN ('owner', 'admin', 'member')
  ) THEN
    RAISE EXCEPTION 'submitter may not prepare decision packages in this workspace';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members member
    WHERE member.workspace_id = NEW.workspace_id
      AND member.user_id = NEW.assigned_approver_id
      AND member.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'assigned approver must be an owner or admin in this workspace';
  END IF;

  IF NEW.replaces_submission_id IS NOT NULL THEN
    SELECT * INTO v_prior FROM public.project_decision_package_submissions
      WHERE id = NEW.replaces_submission_id;
    SELECT decision INTO v_prior_decision FROM public.project_decision_package_decisions
      WHERE submission_id = NEW.replaces_submission_id;
    IF v_prior.id IS NULL OR v_prior.workspace_id <> NEW.workspace_id OR v_prior.project_id <> NEW.project_id
       OR v_prior.submitted_by <> NEW.submitted_by OR v_prior_decision <> 'returned'
       OR v_prior.bundle_sha256 = NEW.bundle_sha256 THEN
      RAISE EXCEPTION 'replacement submission must follow a returned package with a new exact bundle';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_project_decision_package_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  v_submission public.project_decision_package_submissions%ROWTYPE;
  v_bundle public.project_evidence_bundles%ROWTYPE;
  v_receipt jsonb;
  v_approver_role text;
  v_selected_plan_id uuid;
  v_current_pdf_id uuid;
  v_current_pdf_checksum text;
BEGIN
  SELECT * INTO v_submission FROM public.project_decision_package_submissions
    WHERE id = NEW.submission_id;
  IF v_submission.id IS NULL
     OR v_submission.workspace_id <> NEW.workspace_id
     OR v_submission.project_id <> NEW.project_id
     OR v_submission.bundle_id <> NEW.bundle_id
     OR v_submission.bundle_sha256 <> NEW.bundle_sha256 THEN
    RAISE EXCEPTION 'decision must match the submitted exact bundle hash and scope';
  END IF;
  IF NEW.decided_by <> auth.uid() OR NEW.decided_by <> v_submission.assigned_approver_id THEN
    RAISE EXCEPTION 'only the assigned approver may decide this submission';
  END IF;
  IF v_submission.submitted_by = NEW.decided_by THEN
    RAISE EXCEPTION 'self-approval is not permitted';
  END IF;
  SELECT member.role INTO v_approver_role
  FROM public.workspace_members member
  WHERE member.workspace_id = NEW.workspace_id
    AND member.user_id = NEW.decided_by
    AND member.role IN ('owner', 'admin');
  IF v_approver_role IS NULL THEN
    RAISE EXCEPTION 'decision_packages.approve requires owner or admin authority';
  END IF;

  SELECT * INTO v_bundle FROM public.project_evidence_bundles WHERE id = v_submission.bundle_id;
  IF v_bundle.id IS NULL OR v_bundle.status <> 'ready'
     OR v_bundle.workspace_id <> v_submission.workspace_id
     OR v_bundle.project_id <> v_submission.project_id
     OR v_bundle.bundle_sha256 <> v_submission.bundle_sha256
  THEN
    RAISE EXCEPTION 'decision must match an existing ready exact bundle';
  END IF;

  -- A stale package must remain returnable so the assigned reviewer can close
  -- the review and send it back. Only the affirmative disposition is blocked.
  IF NEW.decision = 'approved' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM storage.objects stored_bundle
      WHERE stored_bundle.bucket_id = 'project-evidence-bundles'
        AND stored_bundle.bucket_id = v_bundle.storage_bucket
        AND stored_bundle.name = v_bundle.storage_path
        AND coalesce(stored_bundle.metadata->>'size', '') ~ '^[0-9]+$'
        AND (stored_bundle.metadata->>'size')::bigint = v_bundle.byte_count
    ) THEN
      RAISE EXCEPTION 'decision package approval requires the exact immutable stored ZIP object and byte count';
    END IF;
    IF NOT public.project_decision_package_manifest_is_ready(v_bundle.manifest_json)
       OR v_bundle.manifest_json->>'bundleId' <> v_bundle.id::text
       OR v_bundle.manifest_json->>'workspaceId' <> v_bundle.workspace_id::text
       OR v_bundle.manifest_json->>'projectId' <> v_bundle.project_id::text
       OR (v_bundle.manifest_json->>'projectRevision')::timestamptz <> v_bundle.project_revision
    THEN
      RAISE EXCEPTION 'decision package approval requires a complete ready v2 manifest bound to the bundle';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.projects project
      WHERE project.id = v_bundle.project_id
        AND project.workspace_id = v_bundle.workspace_id
        AND project.updated_at = v_bundle.project_revision
    ) THEN
      RAISE EXCEPTION 'decision package approval refused because the project changed after freezing';
    END IF;
    v_selected_plan_id := (v_bundle.manifest_json->'selectedLinkedPlan'->>'id')::uuid;
    IF NOT EXISTS (
      SELECT 1 FROM public.plans plan
      WHERE plan.id = v_selected_plan_id
        AND plan.workspace_id = v_bundle.workspace_id
        AND plan.project_id = v_bundle.project_id
        AND plan.updated_at <= v_bundle.generated_at
    ) THEN
      RAISE EXCEPTION 'decision package approval refused because the selected linked plan changed';
    END IF;
    v_current_pdf_id := (v_bundle.manifest_json->'currentBoardOrReportPdf'->>'recordId')::uuid;
    v_current_pdf_checksum := v_bundle.manifest_json->'currentBoardOrReportPdf'->>'checksumSha256';
    IF NOT EXISTS (
      SELECT 1
      FROM public.report_artifacts artifact
      JOIN public.reports report ON report.id = artifact.report_id
      WHERE artifact.id = v_current_pdf_id
        AND artifact.artifact_kind = 'pdf'
        AND artifact.storage_path IS NOT NULL
        AND artifact.updated_at <= v_bundle.generated_at
        AND report.workspace_id = v_bundle.workspace_id
        AND report.project_id = v_bundle.project_id
        AND report.updated_at <= v_bundle.generated_at
        AND (
          coalesce(artifact.metadata_json->>'checksumSha256', artifact.metadata_json->>'checksum_sha256') IS NULL
          OR lower(coalesce(
            artifact.metadata_json->>'checksumSha256',
            artifact.metadata_json->>'checksum_sha256'
          )) = v_current_pdf_checksum
        )
    ) THEN
      RAISE EXCEPTION 'decision package approval refused because the current report PDF changed';
    END IF;
  END IF;

  v_receipt := jsonb_build_object(
    'schemaVersion', 'project_decision_package_receipt.v1',
    'submissionId', NEW.submission_id,
    'bundleId', NEW.bundle_id,
    'bundleSha256', NEW.bundle_sha256,
    'decision', NEW.decision,
    'reason', NEW.reason,
    'decidedBy', NEW.decided_by,
    'decidedAt', NEW.decided_at,
    'approverAuthority', jsonb_build_object(
      'workspaceRole', v_approver_role,
      'requiredAction', 'decision_packages.approve',
      'assignedApproverId', v_submission.assigned_approver_id
    ),
    'approvalOrPublication', false,
    'statutoryAdoption', false,
    'modelValidation', false
  );
  NEW.receipt_json := v_receipt;
  NEW.receipt_canonical_json := v_receipt::text;
  NEW.receipt_sha256 := encode(
    extensions.digest(convert_to(NEW.receipt_canonical_json, 'UTF8'), 'sha256'),
    'hex'
  );
  RETURN NEW;
END;
$$;

COMMENT ON COLUMN public.project_decision_package_decisions.receipt_canonical_json IS
  'Exact UTF-8 JSON text returned by the receipt download route and covered by receipt_sha256.';
