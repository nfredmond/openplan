-- Atomic AI usage reservation for the app-side metered paths (KI-2026-10-12-014).
--
-- reserveAiUsage (src/lib/runtime/ai-rate-limit.ts) counted the workspace's
-- recent staff AI usage and then inserted the usage row in two PostgREST
-- requests with no lock. Requests running at the same time could all pass one
-- count and together exceed the window limit by the number in flight.
--
-- This function counts and inserts in one transaction under the same
-- per-workspace advisory lock the SQL dispatchers already take
-- ('assistant_api_dispatch:' || workspace_id, in claim_assistant_api_turn,
-- the workspace-connection chat dispatcher and the staff translation
-- dispatcher). App-side reservations and SQL dispatches for one workspace
-- therefore serialize against each other, and the limit is exact.
--
-- Semantics kept from the two-request version: count(*) of usage_events rows
-- for the workspace whose bucket is in the counted set and whose occurred_at
-- is inside the window; a refused reservation inserts nothing; an admitted one
-- inserts exactly one weight-1 row with the caller's bucket, event key, source
-- route and metadata. The caller passes the bucket set, the limit and the
-- window, so the application constants stay the one source of those values.
-- The recorded bucket must be one of the counted buckets, or the reservation
-- would not consume the allowance it was checked against.
--
-- SECURITY INVOKER: the only caller is the server's service-role client, which
-- already holds every privilege on usage_events and bypasses RLS. EXECUTE is
-- revoked from PUBLIC, anon and authenticated (managed default privileges
-- grant it to them on every new public function) and granted to service_role
-- only. search_path is empty and every name is schema-qualified.
--
-- lock_timeout bounds the wait for the workspace lock. A timeout raises
-- lock_not_available; the application treats any error as an unavailable
-- meter (fail closed when the deployment's shared key pays).
--
-- Additive: one new function, no table, column, policy or data change.

CREATE FUNCTION public.reserve_ai_usage(
  p_workspace_id uuid,
  p_bucket_keys text[],
  p_max_per_window integer,
  p_window_seconds integer,
  p_bucket_key text,
  p_event_key text,
  p_source_route text,
  p_metadata jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
SET lock_timeout = '5s'
AS $$
DECLARE
  recent integer;
BEGIN
  IF p_workspace_id IS NULL
    OR p_bucket_keys IS NULL OR pg_catalog.cardinality(p_bucket_keys) = 0
    OR p_bucket_key IS NULL OR NOT (p_bucket_key = ANY (p_bucket_keys))
    OR p_event_key IS NULL OR pg_catalog.length(p_event_key) = 0
    OR p_max_per_window IS NULL OR p_max_per_window < 1
    OR p_window_seconds IS NULL OR p_window_seconds < 1 OR p_window_seconds > 86400
    OR (p_metadata IS NOT NULL AND pg_catalog.jsonb_typeof(p_metadata) <> 'object')
  THEN
    RAISE EXCEPTION 'Invalid AI usage reservation' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('assistant_api_dispatch:' || p_workspace_id::text, 0)
  );

  SELECT count(*) INTO recent
  FROM public.usage_events
  WHERE workspace_id = p_workspace_id
    AND bucket_key = ANY (p_bucket_keys)
    AND occurred_at >= pg_catalog.clock_timestamp() - pg_catalog.make_interval(secs => p_window_seconds);

  IF recent >= p_max_per_window THEN
    RETURN pg_catalog.jsonb_build_object('allowed', false, 'count', recent);
  END IF;

  INSERT INTO public.usage_events (workspace_id, event_key, bucket_key, weight, source_route, metadata_json)
  VALUES (p_workspace_id, p_event_key, p_bucket_key, 1, p_source_route, coalesce(p_metadata, '{}'::jsonb));

  RETURN pg_catalog.jsonb_build_object('allowed', true, 'count', recent);
END;
$$;

COMMENT ON FUNCTION public.reserve_ai_usage(uuid, text[], integer, integer, text, text, text, jsonb) IS
  'Counts a workspace''s recent AI usage and records one call under the workspace dispatch lock. Service role only.';

REVOKE ALL ON FUNCTION public.reserve_ai_usage(uuid, text[], integer, integer, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ai_usage(uuid, text[], integer, integer, text, text, text, jsonb) TO service_role;
