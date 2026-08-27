-- Append-only agency review of one exact immutable project evidence bundle.
-- Approval records custody and a human decision. It never publishes, adopts,
-- validates, or rewrites the bundle.

CREATE TABLE public.project_decision_package_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  bundle_id uuid NOT NULL REFERENCES public.project_evidence_bundles(id) ON DELETE RESTRICT,
  bundle_sha256 text NOT NULL CHECK (bundle_sha256 ~ '^[0-9a-f]{64}$'),
  submitted_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT DEFAULT auth.uid(),
  assigned_approver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  replaces_submission_id uuid REFERENCES public.project_decision_package_submissions(id) ON DELETE RESTRICT,
  note text CHECK (note IS NULL OR length(note) <= 2000),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_decision_package_submission_people_distinct
    CHECK (submitted_by <> assigned_approver_id),
  CONSTRAINT project_decision_package_submission_replacement_distinct
    CHECK (replaces_submission_id IS NULL OR replaces_submission_id <> id)
);

CREATE UNIQUE INDEX project_decision_package_one_replacement_idx
  ON public.project_decision_package_submissions(replaces_submission_id)
  WHERE replaces_submission_id IS NOT NULL;
CREATE INDEX project_decision_package_submissions_workspace_idx
  ON public.project_decision_package_submissions(workspace_id, submitted_at DESC);
CREATE INDEX project_decision_package_submissions_approver_idx
  ON public.project_decision_package_submissions(assigned_approver_id, submitted_at DESC);

CREATE TABLE public.project_decision_package_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  submission_id uuid NOT NULL UNIQUE REFERENCES public.project_decision_package_submissions(id) ON DELETE RESTRICT,
  bundle_id uuid NOT NULL REFERENCES public.project_evidence_bundles(id) ON DELETE RESTRICT,
  bundle_sha256 text NOT NULL CHECK (bundle_sha256 ~ '^[0-9a-f]{64}$'),
  decision text NOT NULL CHECK (decision IN ('approved', 'returned')),
  reason text,
  decided_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT DEFAULT auth.uid(),
  receipt_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  receipt_sha256 text NOT NULL DEFAULT repeat('0', 64) CHECK (receipt_sha256 ~ '^[0-9a-f]{64}$'),
  decided_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_decision_package_return_reason CHECK (
    (decision = 'returned' AND reason IS NOT NULL AND length(trim(reason)) >= 3 AND length(reason) <= 4000)
    OR (decision = 'approved' AND (reason IS NULL OR length(reason) <= 4000))
  )
);

CREATE INDEX project_decision_package_decisions_workspace_idx
  ON public.project_decision_package_decisions(workspace_id, decided_at DESC);

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
  IF v_bundle.generated_by = NEW.submitted_by OR v_bundle.generated_by = NEW.assigned_approver_id THEN
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

CREATE TRIGGER validate_project_decision_package_submission_before_insert
BEFORE INSERT ON public.project_decision_package_submissions
FOR EACH ROW EXECUTE FUNCTION public.validate_project_decision_package_submission();

CREATE OR REPLACE FUNCTION public.validate_project_decision_package_decision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  v_submission public.project_decision_package_submissions%ROWTYPE;
  v_receipt jsonb;
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
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members member
    WHERE member.workspace_id = NEW.workspace_id
      AND member.user_id = NEW.decided_by
      AND member.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'decision_packages.approve requires owner or admin authority';
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
    'approvalOrPublication', false,
    'statutoryAdoption', false,
    'modelValidation', false
  );
  NEW.receipt_json := v_receipt;
  NEW.receipt_sha256 := encode(extensions.digest(convert_to(v_receipt::text, 'UTF8'), 'sha256'), 'hex');
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_project_decision_package_decision_before_insert
BEFORE INSERT ON public.project_decision_package_decisions
FOR EACH ROW EXECUTE FUNCTION public.validate_project_decision_package_decision();

CREATE OR REPLACE FUNCTION public.refuse_project_decision_package_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'decision package submissions and decisions are append-only';
END;
$$;

CREATE TRIGGER refuse_project_decision_package_submission_update
BEFORE UPDATE ON public.project_decision_package_submissions
FOR EACH ROW EXECUTE FUNCTION public.refuse_project_decision_package_change();
CREATE TRIGGER refuse_project_decision_package_submission_delete
BEFORE DELETE ON public.project_decision_package_submissions
FOR EACH ROW EXECUTE FUNCTION public.refuse_project_decision_package_change();
CREATE TRIGGER refuse_project_decision_package_decision_update
BEFORE UPDATE ON public.project_decision_package_decisions
FOR EACH ROW EXECUTE FUNCTION public.refuse_project_decision_package_change();
CREATE TRIGGER refuse_project_decision_package_decision_delete
BEFORE DELETE ON public.project_decision_package_decisions
FOR EACH ROW EXECUTE FUNCTION public.refuse_project_decision_package_change();

ALTER TABLE public.project_decision_package_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_decision_package_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_decision_package_submissions_read
ON public.project_decision_package_submissions FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.workspace_members member
    WHERE member.workspace_id = project_decision_package_submissions.workspace_id
      AND member.user_id = auth.uid())
);
CREATE POLICY project_decision_package_submissions_insert
ON public.project_decision_package_submissions FOR INSERT WITH CHECK (
  submitted_by = auth.uid()
  AND public.workspace_member_can_write(workspace_id)
);
CREATE POLICY project_decision_package_decisions_read
ON public.project_decision_package_decisions FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.workspace_members member
    WHERE member.workspace_id = project_decision_package_decisions.workspace_id
      AND member.user_id = auth.uid())
);
CREATE POLICY project_decision_package_decisions_insert
ON public.project_decision_package_decisions FOR INSERT WITH CHECK (
  decided_by = auth.uid()
  AND EXISTS (SELECT 1 FROM public.workspace_members member
    WHERE member.workspace_id = project_decision_package_decisions.workspace_id
      AND member.user_id = auth.uid()
      AND member.role IN ('owner', 'admin'))
);

REVOKE ALL ON public.project_decision_package_submissions FROM anon;
REVOKE ALL ON public.project_decision_package_decisions FROM anon;
GRANT SELECT, INSERT ON public.project_decision_package_submissions TO authenticated;
GRANT SELECT, INSERT ON public.project_decision_package_decisions TO authenticated;
GRANT ALL ON public.project_decision_package_submissions TO service_role;
GRANT ALL ON public.project_decision_package_decisions TO service_role;

CREATE VIEW public.project_decision_package_my_work
WITH (security_invoker = true)
AS
SELECT
  submission.id,
  submission.workspace_id,
  submission.project_id,
  submission.bundle_id,
  submission.bundle_sha256,
  submission.submitted_by,
  submission.assigned_approver_id,
  submission.replaces_submission_id,
  submission.note,
  submission.submitted_at,
  bundle.project_revision,
  project.updated_at AS project_updated_at,
  (project.updated_at > bundle.project_revision) AS stale_for_current_use,
  decision.id AS decision_id,
  decision.decision,
  decision.reason,
  decision.decided_at,
  project.name AS project_name,
  CASE WHEN decision.id IS NULL THEN 'pending_review' ELSE 'returned' END AS queue_state
FROM public.project_decision_package_submissions submission
JOIN public.project_evidence_bundles bundle ON bundle.id = submission.bundle_id
JOIN public.projects project ON project.id = submission.project_id
LEFT JOIN public.project_decision_package_decisions decision ON decision.submission_id = submission.id
WHERE
  (decision.id IS NULL AND submission.assigned_approver_id = auth.uid())
  OR
  (decision.decision = 'returned'
    AND submission.submitted_by = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.project_decision_package_submissions replacement
      WHERE replacement.replaces_submission_id = submission.id
    ));

REVOKE ALL ON public.project_decision_package_my_work FROM anon;
GRANT SELECT ON public.project_decision_package_my_work TO authenticated, service_role;

COMMENT ON TABLE public.project_decision_package_submissions IS
  'Append-only submission of one exact ready project evidence bundle SHA-256 to one different owner/admin approver.';
COMMENT ON TABLE public.project_decision_package_decisions IS
  'Append-only approval or return receipt for one exact submitted bundle. Approval does not publish, adopt, or validate the package.';
