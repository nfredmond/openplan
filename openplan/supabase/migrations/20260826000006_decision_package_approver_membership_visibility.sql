-- A submitter can read only their own workspace_members row. The trigger must
-- inspect the assigned approver's role, so run that pinned validation function
-- as its owner while retaining explicit auth.uid, workspace, role, creator,
-- submitter, project, bundle, and SHA-256 checks.

ALTER FUNCTION public.validate_project_decision_package_submission() SECURITY DEFINER;
REVOKE ALL ON FUNCTION public.validate_project_decision_package_submission() FROM PUBLIC, anon, authenticated;
