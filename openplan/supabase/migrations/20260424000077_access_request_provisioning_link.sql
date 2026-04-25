-- Atomic service-role recorder for converting a reviewed access request into
-- a provisioned workspace invite handoff.
--
-- Workspace creation and invitation token generation stay in the authenticated
-- admin route. This function only records the final status transition and
-- stores the workspace linkage while preserving the service-role-only posture
-- for prospect contact data.

CREATE OR REPLACE FUNCTION public.record_access_request_provisioning(
  p_access_request_id UUID,
  p_previous_status TEXT,
  p_workspace_id UUID,
  p_owner_invitation_id UUID,
  p_reviewer_user_id UUID
)
RETURNS TABLE (
  id UUID,
  status TEXT,
  reviewed_at TIMESTAMPTZ,
  review_event_id UUID,
  provisioned_workspace_id UUID
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  updated_request public.access_requests%ROWTYPE;
  event_id UUID;
  transition_recorded_at TIMESTAMPTZ := now();
BEGIN
  UPDATE public.access_requests
  SET
    status = 'provisioned',
    reviewed_by_user_id = p_reviewer_user_id,
    reviewed_at = transition_recorded_at,
    provisioned_workspace_id = p_workspace_id
  WHERE access_requests.id = p_access_request_id
    AND access_requests.status = p_previous_status
    AND access_requests.status IN ('contacted', 'invited')
    AND access_requests.provisioned_workspace_id IS NULL
  RETURNING access_requests.* INTO updated_request;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Access request status changed before provisioning could be recorded'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.access_request_review_events (
    access_request_id,
    reviewer_user_id,
    previous_status,
    status,
    metadata_json,
    created_at
  )
  VALUES (
    p_access_request_id,
    p_reviewer_user_id,
    p_previous_status,
    'provisioned',
    jsonb_build_object(
      'source', 'admin_access_request_provision_route',
      'provisioned_workspace_id', p_workspace_id,
      'owner_invitation_id', p_owner_invitation_id
    ),
    transition_recorded_at
  )
  RETURNING access_request_review_events.id INTO event_id;

  RETURN QUERY
  SELECT
    updated_request.id,
    updated_request.status,
    updated_request.reviewed_at,
    event_id,
    updated_request.provisioned_workspace_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_access_request_provisioning(UUID, TEXT, UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_access_request_provisioning(UUID, TEXT, UUID, UUID, UUID) TO service_role;

COMMENT ON FUNCTION public.record_access_request_provisioning(UUID, TEXT, UUID, UUID, UUID) IS
  'Service-role-only recorder for linking reviewed access requests to provisioned pilot workspaces and owner invitations.';
