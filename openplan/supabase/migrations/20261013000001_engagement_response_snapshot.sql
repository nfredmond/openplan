-- One JSON result avoids PostgREST row caps and observes one database snapshot.
-- Caller privileges and the existing table RLS still govern every selected row.
CREATE FUNCTION public.read_engagement_response_snapshot(
  p_campaign uuid,
  p_published_only boolean DEFAULT false
) RETURNS jsonb
LANGUAGE sql STABLE STRICT SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'campaignId', p_campaign,
    'publishedOnly', p_published_only,
    'count', count(*),
    'entries', COALESCE(
      jsonb_agg(to_jsonb(entry) ORDER BY entry.sort_order, entry.created_at, entry.id),
      '[]'::jsonb
    )
  )
  FROM (
    SELECT id, campaign_id, category_id, theme_title, you_said, we_did,
      status, ai_assisted, source_item_ids, sort_order, published_at,
      created_at, updated_at
    FROM public.engagement_closeloop_entries
    WHERE campaign_id = p_campaign
      AND (NOT p_published_only OR status = 'published')
  ) entry;
$$;

REVOKE ALL ON FUNCTION public.read_engagement_response_snapshot(uuid, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.read_engagement_response_snapshot(uuid, boolean)
  TO authenticated, service_role;
