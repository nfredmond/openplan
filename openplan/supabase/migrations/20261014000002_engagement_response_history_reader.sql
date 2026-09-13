-- One statement returns the complete private history, including removed responses.
-- Invoker RLS applies before aggregation; anonymous callers cannot execute it.
CREATE FUNCTION public.read_engagement_response_history(p_campaign uuid)
RETURNS jsonb LANGUAGE sql STABLE STRICT SECURITY INVOKER
SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'campaignId', p_campaign,
    'count', count(*),
    'entries', COALESCE(jsonb_agg(jsonb_build_object(
      'id', h.id, 'campaign_id', h.campaign_id, 'response_id', h.response_id,
      'revision', h.revision, 'actor_id', h.actor_id, 'recorded_at', h.recorded_at,
      'event', h.event, 'record_text', h.record_json::text,
      'record_sha256', h.record_sha256
    ) ORDER BY h.response_id, h.revision), '[]'::jsonb)
  ) FROM public.engagement_response_history h WHERE h.campaign_id = p_campaign;
$$;
REVOKE ALL ON FUNCTION public.read_engagement_response_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.read_engagement_response_history(uuid) TO authenticated;
