-- Service-role-only review trail for supervised request-access triage.
--
-- This preserves the sequence of reviewer status decisions without exposing
-- prospect contact data to anon/authenticated clients or sending outbound email.

CREATE TABLE IF NOT EXISTS public.access_request_review_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_request_id UUID NOT NULL REFERENCES public.access_requests(id) ON DELETE CASCADE,
  reviewer_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  previous_status TEXT NOT NULL CHECK (
    previous_status IN ('new', 'reviewing', 'contacted', 'invited', 'provisioned', 'deferred', 'declined')
  ),
  status TEXT NOT NULL CHECK (
    status IN ('new', 'reviewing', 'contacted', 'invited', 'provisioned', 'deferred', 'declined')
  ),
  event_type TEXT NOT NULL DEFAULT 'status_transition' CHECK (event_type IN ('status_transition')),
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (previous_status <> status)
);

CREATE INDEX IF NOT EXISTS access_request_review_events_request_created_idx
  ON public.access_request_review_events(access_request_id, created_at DESC);

CREATE INDEX IF NOT EXISTS access_request_review_events_reviewer_created_idx
  ON public.access_request_review_events(reviewer_user_id, created_at DESC)
  WHERE reviewer_user_id IS NOT NULL;

ALTER TABLE public.access_request_review_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.access_request_review_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.access_request_review_events TO service_role;

COMMENT ON TABLE public.access_request_review_events IS
  'Service-role-only audit trail for request-access reviewer triage. Contains status transitions and reviewer user ids, not prospect message bodies or outbound email payloads.';

CREATE OR REPLACE FUNCTION public.record_access_request_triage(
  p_access_request_id UUID,
  p_previous_status TEXT,
  p_status TEXT,
  p_reviewer_user_id UUID
)
RETURNS TABLE (
  id UUID,
  status TEXT,
  reviewed_at TIMESTAMPTZ,
  review_event_id UUID
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
    status = p_status,
    reviewed_by_user_id = p_reviewer_user_id,
    reviewed_at = transition_recorded_at
  WHERE access_requests.id = p_access_request_id
    AND access_requests.status = p_previous_status
  RETURNING access_requests.* INTO updated_request;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Access request status changed before triage could be recorded'
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
    p_status,
    jsonb_build_object('source', 'admin_access_request_triage_route'),
    transition_recorded_at
  )
  RETURNING access_request_review_events.id INTO event_id;

  RETURN QUERY
  SELECT
    updated_request.id,
    updated_request.status,
    updated_request.reviewed_at,
    event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_access_request_triage(UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_access_request_triage(UUID, TEXT, TEXT, UUID) TO service_role;
