-- The bundle creator may also submit it. The segregation-of-duties boundary is
-- the approver, who must differ from both creator and submitter.

CREATE OR REPLACE FUNCTION public.validate_project_decision_package_submission()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  v_bundle public.project_evidence_bundles%ROWTYPE;
  v_prior public.project_decision_package_submissions%ROWTYPE;
  v_prior_decision text;
BEGIN
  SELECT * INTO v_bundle FROM public.project_evidence_bundles WHERE id = NEW.bundle_id;
  IF v_bundle.id IS NULL OR v_bundle.status <> 'ready' THEN
    RAISE EXCEPTION 'decision package submission requires a ready bundle';
  END IF;
  IF v_bundle.workspace_id <> NEW.workspace_id OR v_bundle.project_id <> NEW.project_id
     OR v_bundle.bundle_sha256 <> NEW.bundle_sha256 THEN
    RAISE EXCEPTION 'decision package submission must match the exact bundle hash and scope';
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
