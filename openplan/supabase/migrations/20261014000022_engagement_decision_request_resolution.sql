-- Resolve a damaged local copy without erasing it or permitting
-- an unacknowledged request to commit after the browser starts a replacement.
CREATE TABLE public.engagement_decision_request_resolutions (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  payload_json json NOT NULL,
  result_json json NOT NULL,
  payload_sha256 text GENERATED ALWAYS AS
    (encode(extensions.digest(payload_json::text, 'sha256'), 'hex')) STORED,
  result_sha256 text GENERATED ALWAYS AS
    (encode(extensions.digest(result_json::text, 'sha256'), 'hex')) STORED,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (json_typeof(payload_json) = 'object' AND json_typeof(result_json) = 'object'),
  CHECK (octet_length(payload_json::text) <= 33562624)
);
CREATE INDEX engagement_decision_request_resolved
  ON public.engagement_decision_request_resolutions(request_id, campaign_id, actor_id);
ALTER TABLE public.engagement_decision_request_resolutions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_decision_request_resolutions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.engagement_decision_request_resolutions TO authenticated;
CREATE POLICY engagement_decision_resolution_owner
  ON public.engagement_decision_request_resolutions FOR SELECT TO authenticated USING (
    actor_id = auth.uid() AND EXISTS (
      SELECT 1 FROM public.engagement_campaigns c
      JOIN public.workspace_members m ON m.workspace_id = c.workspace_id
      WHERE c.id = campaign_id AND c.workspace_id = engagement_decision_request_resolutions.workspace_id
        AND m.user_id = auth.uid() AND m.role IN ('owner', 'admin', 'member')
    )
  );
CREATE TRIGGER engagement_decision_resolution_immutable BEFORE UPDATE OR DELETE
  ON public.engagement_decision_request_resolutions FOR EACH ROW
  EXECUTE FUNCTION public.refuse_engagement_history_change();

CREATE FUNCTION public.resolve_engagement_decision_request(
  p_campaign uuid, p_request uuid, p_resolution uuid, p_copy_json text, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  actor uuid := auth.uid();
  campaign public.engagement_campaigns%ROWTYPE;
  saved public.engagement_decision_request_resolutions%ROWTYPE;
  receipt public.engagement_response_decision_links%ROWTYPE;
  payload jsonb;
  outcome jsonb;
  retained_link jsonb := NULL;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'Staff authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_request IS NULL OR p_resolution IS NULL OR p_copy_json IS NULL
    OR octet_length(p_copy_json) > 16777216 OR json_typeof(p_copy_json::json) IS DISTINCT FROM 'string'
    OR p_reason IS NULL OR public.translation_source_compatibility_hash(p_reason) = public.translation_source_compatibility_hash('')
    OR length(p_reason) > 2000 THEN
    RAISE EXCEPTION 'Invalid decision request resolution' USING ERRCODE = '22023';
  END IF;
  -- Scope precedes shared locks, including replay. Lost membership cannot expose
  -- either the damaged local bytes or an old private decision receipt.
  SELECT c.* INTO campaign FROM public.engagement_campaigns c
    WHERE c.id = p_campaign AND EXISTS (
      SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = c.workspace_id
        AND m.user_id = actor AND m.role IN ('owner', 'admin', 'member')
    ) FOR SHARE OF c NOWAIT;
  IF campaign.id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.workspace_members WHERE workspace_id = campaign.workspace_id
      AND user_id = actor AND role IN ('owner', 'admin', 'member') FOR SHARE NOWAIT
  ) THEN
    RAISE EXCEPTION 'Staff campaign access required' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.workspaces WHERE id = campaign.workspace_id FOR SHARE NOWAIT;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('engagement-decision-resolution:' || p_resolution::text, 0))
    OR NOT pg_try_advisory_xact_lock(hashtextextended('engagement-decision-request:' || p_request::text, 0)) THEN
    RAISE EXCEPTION 'Decision recovery is busy; retry the same resolution' USING ERRCODE = 'PT503';
  END IF;
  payload := jsonb_build_object('schema', 1, 'resolutionId', p_resolution, 'requestId', p_request,
    'campaignId', p_campaign, 'workspaceId', campaign.workspace_id, 'actorId', actor,
    'copyJson', p_copy_json, 'reason', p_reason);
  SELECT * INTO saved FROM public.engagement_decision_request_resolutions WHERE id = p_resolution;
  IF FOUND THEN
    IF saved.campaign_id IS DISTINCT FROM p_campaign OR saved.workspace_id IS DISTINCT FROM campaign.workspace_id
      OR saved.actor_id IS DISTINCT FROM actor THEN
      RAISE EXCEPTION 'Decision resolution is unavailable' USING ERRCODE = '42501';
    END IF;
    IF saved.payload_json::jsonb IS DISTINCT FROM payload THEN
      RAISE EXCEPTION 'Decision resolution retry differs' USING ERRCODE = 'PT409';
    END IF;
    RETURN jsonb_build_object('payloadText', saved.payload_json::text, 'payloadSha256', saved.payload_sha256,
      'resultText', saved.result_json::text, 'resultSha256', saved.result_sha256, 'replayed', true);
  END IF;
  SELECT * INTO receipt FROM public.engagement_response_decision_links WHERE id = p_request;
  IF FOUND THEN
    IF receipt.campaign_id IS DISTINCT FROM p_campaign OR receipt.workspace_id IS DISTINCT FROM campaign.workspace_id
      OR receipt.actor_id IS DISTINCT FROM actor THEN
      RAISE EXCEPTION 'Only the original requester can recover this decision request' USING ERRCODE = '42501';
    END IF;
    retained_link := to_jsonb(receipt) || jsonb_build_object('payload_text', receipt.payload_json::text);
  END IF;
  outcome := jsonb_build_object('schema', 1, 'resolutionId', p_resolution, 'requestId', p_request,
    'campaignId', p_campaign, 'workspaceId', campaign.workspace_id, 'actorId', actor,
    'state', CASE WHEN retained_link IS NULL THEN 'cancelled' ELSE 'saved' END,
    'link', retained_link, 'resolvedAt', clock_timestamp());
  INSERT INTO public.engagement_decision_request_resolutions(
    id, request_id, campaign_id, workspace_id, actor_id, payload_json, result_json
  ) VALUES (p_resolution, p_request, p_campaign, campaign.workspace_id, actor, payload::json, outcome::json)
    RETURNING * INTO saved;
  RETURN jsonb_build_object('payloadText', saved.payload_json::text, 'payloadSha256', saved.payload_sha256,
    'resultText', saved.result_json::text, 'resultSha256', saved.result_sha256, 'replayed', false);
EXCEPTION WHEN data_exception THEN
  RAISE EXCEPTION 'Invalid decision resolution encoding' USING ERRCODE = '22023';
  WHEN lock_not_available THEN
    RAISE EXCEPTION 'Decision recovery is busy; retry the same resolution' USING ERRCODE = 'PT503';
END $$;
REVOKE ALL ON FUNCTION public.resolve_engagement_decision_request(uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_engagement_decision_request(uuid, uuid, uuid, text, text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.write_engagement_response_decision_link(
  p_campaign uuid, p_response uuid, p_decision uuid, p_request uuid,
  p_operation text, p_predecessor uuid, p_expected_context_sha256 text, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  campaign public.engagement_campaigns%ROWTYPE;
  response public.engagement_closeloop_entries%ROWTYPE;
  decision public.project_decisions%ROWTYPE;
  previous public.engagement_response_decision_links%ROWTYPE;
  receipt public.engagement_response_decision_links%ROWTYPE;
  envelope jsonb;
  snapshot jsonb;
  saved_context text;
  saved_project uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Staff authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_request IS NULL OR p_response IS NULL OR p_decision IS NULL
    OR p_operation IS NULL OR p_operation NOT IN ('link', 'refresh', 'withdraw')
    OR ((p_operation = 'link') IS DISTINCT FROM (p_predecessor IS NULL))
    OR p_request = p_predecessor OR NULLIF(btrim(p_reason), '') IS NULL OR length(p_reason) > 2000
    OR (p_operation <> 'withdraw' AND (p_expected_context_sha256 IS NULL OR p_expected_context_sha256 !~ '^[0-9a-f]{64}$'))
    OR (p_operation = 'withdraw' AND p_expected_context_sha256 IS NOT NULL) THEN
    RAISE EXCEPTION 'Invalid decision link intent' USING ERRCODE = '22023';
  END IF;
  -- Nonblocking locks avoid a cycle with source withdrawal, which already owns
  -- its contribution row before it reaches the response. Retry the same intent
  -- when busy; a changed snapshot needs an explicit new review and request.
  SELECT c.* INTO campaign FROM public.engagement_campaigns c
    WHERE c.id = p_campaign AND EXISTS (
      SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = c.workspace_id
        AND m.user_id = auth.uid() AND m.role IN ('owner', 'admin', 'member')
    ) FOR SHARE OF c NOWAIT;
  IF campaign.id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.workspace_members WHERE workspace_id = campaign.workspace_id
      AND user_id = auth.uid() AND role IN ('owner', 'admin', 'member') FOR SHARE NOWAIT
  ) THEN
    RAISE EXCEPTION 'Staff campaign access required' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.workspaces WHERE id = campaign.workspace_id FOR SHARE NOWAIT;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('engagement-decision-request:' || p_request::text, 0)) THEN
    RAISE EXCEPTION 'Decision link save is busy; retry the same request' USING ERRCODE = 'PT503';
  END IF;
  envelope = jsonb_build_object('campaignId', p_campaign, 'responseId', p_response,
    'decisionId', p_decision, 'operation', p_operation, 'predecessorId', p_predecessor,
    'expectedContextSha256', p_expected_context_sha256, 'reason', p_reason);
  SELECT * INTO receipt FROM public.engagement_response_decision_links WHERE id = p_request;
  IF FOUND THEN
    IF receipt.actor_id IS DISTINCT FROM auth.uid() OR receipt.payload_json IS DISTINCT FROM envelope THEN
      RAISE EXCEPTION 'Request identity belongs to a different decision link' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('link', to_jsonb(receipt) || jsonb_build_object('payload_text', receipt.payload_json::text), 'replayed', true);
  END IF;
  -- A saved exact receipt above remains replayable. An absent request resolved
  -- under this same request lock cannot arrive later and create a new link.
  IF EXISTS (SELECT 1 FROM public.engagement_decision_request_resolutions
    WHERE request_id = p_request AND campaign_id = p_campaign
      AND workspace_id = campaign.workspace_id AND actor_id = auth.uid()) THEN
    RAISE EXCEPTION 'Decision request was resolved; retain its recovery receipt' USING ERRCODE = 'PT409';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended(
    'engagement-decision-pair:' || p_campaign::text || ':' || p_response::text || ':' || p_decision::text, 0)) THEN
    RAISE EXCEPTION 'Decision link save is busy; retry the same request' USING ERRCODE = 'PT503';
  END IF;
  IF p_predecessor IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.engagement_response_decision_links
      WHERE campaign_id = p_campaign AND response_id = p_response AND decision_id = p_decision) THEN
      RAISE EXCEPTION 'Decision link already exists; review its current history' USING ERRCODE = 'PT409';
    END IF;
  ELSE
    SELECT * INTO previous FROM public.engagement_response_decision_links
      WHERE id = p_predecessor AND campaign_id = p_campaign AND workspace_id = campaign.workspace_id
        AND response_id = p_response AND decision_id = p_decision;
    IF previous.id IS NULL OR EXISTS (SELECT 1 FROM public.engagement_response_decision_links WHERE predecessor_id = p_predecessor)
      OR (p_operation = 'withdraw' AND previous.operation = 'withdraw') THEN
      RAISE EXCEPTION 'Decision link changed; review its current history' USING ERRCODE = 'PT409';
    END IF;
  END IF;
  IF p_operation = 'withdraw' THEN
    -- Closing a link remains possible after its current sources disappear.
    saved_context = previous.context_text;
    saved_project = previous.project_id;
  ELSE
    SELECT * INTO response FROM public.engagement_closeloop_entries
      WHERE id = p_response AND campaign_id = p_campaign FOR SHARE NOWAIT;
    SELECT d.* INTO decision FROM public.project_decisions d
      WHERE d.id = p_decision AND EXISTS (
        SELECT 1 FROM public.projects p JOIN public.engagement_campaign_projects cp ON cp.project_id = p.id
        WHERE p.id = d.project_id AND p.workspace_id = campaign.workspace_id
          AND cp.campaign_id = p_campaign AND cp.workspace_id = campaign.workspace_id
      ) FOR SHARE OF d NOWAIT;
    IF response.id IS NULL OR decision.id IS NULL THEN
      RAISE EXCEPTION 'Response or decision is unavailable' USING ERRCODE = 'P0002';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = decision.project_id
      AND workspace_id = campaign.workspace_id FOR SHARE NOWAIT)
      OR NOT EXISTS (SELECT 1 FROM public.engagement_campaign_projects
        WHERE campaign_id = p_campaign AND project_id = decision.project_id
          AND workspace_id = campaign.workspace_id FOR SHARE NOWAIT) THEN
      RAISE EXCEPTION 'Decision is unavailable on this campaign''s projects' USING ERRCODE = 'P0002';
    END IF;
    PERFORM 1 FROM public.engagement_items WHERE campaign_id = p_campaign
      AND id = ANY(response.source_item_ids) ORDER BY id FOR SHARE NOWAIT;
    snapshot = public.read_engagement_response_decision_context(p_campaign, p_response, p_decision);
    IF snapshot->>'contextSha256' IS DISTINCT FROM p_expected_context_sha256 THEN
      RAISE EXCEPTION 'Decision link sources changed; review the current context' USING ERRCODE = 'PT409';
    END IF;
    saved_context = snapshot->>'contextText';
    saved_project = decision.project_id;
    IF previous.id IS NOT NULL AND previous.project_id IS DISTINCT FROM saved_project THEN
      RAISE EXCEPTION 'Decision moved to a different project; retain and withdraw the original link' USING ERRCODE = 'PT409';
    END IF;
  END IF;
  INSERT INTO public.engagement_response_decision_links(
    id, workspace_id, campaign_id, response_id, decision_id, project_id, predecessor_id,
    operation, actor_id, reason, payload_json, context_text
  ) VALUES (
    p_request, campaign.workspace_id, p_campaign, p_response, p_decision, saved_project, p_predecessor,
    p_operation, auth.uid(), p_reason, envelope, saved_context
  ) RETURNING * INTO receipt;
  RETURN jsonb_build_object('link', to_jsonb(receipt) || jsonb_build_object('payload_text', receipt.payload_json::text), 'replayed', false);
EXCEPTION WHEN lock_not_available THEN
  RAISE EXCEPTION 'Decision link sources are busy; retry the same request' USING ERRCODE = 'PT503';
END $$;
REVOKE ALL ON FUNCTION public.write_engagement_response_decision_link(uuid, uuid, uuid, uuid, text, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.write_engagement_response_decision_link(uuid, uuid, uuid, uuid, text, uuid, text, text)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
