-- Candidate only, following decision-context-candidate.sql. A correction or
-- withdrawal appends a successor; current response/decision deletion loses none
-- of the original context. These records have no public read or write grant.
CREATE TABLE public.engagement_response_decision_links (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  campaign_id uuid NOT NULL REFERENCES public.engagement_campaigns(id),
  response_id uuid NOT NULL,
  decision_id uuid NOT NULL,
  project_id uuid NOT NULL,
  predecessor_id uuid UNIQUE REFERENCES public.engagement_response_decision_links(id),
  operation text NOT NULL CHECK (operation IN ('link', 'refresh', 'withdraw')),
  CHECK ((operation = 'link') = (predecessor_id IS NULL)),
  CHECK (id IS DISTINCT FROM predecessor_id),
  actor_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0 AND length(reason) <= 2000),
  payload_json jsonb NOT NULL,
  payload_sha256 text GENERATED ALWAYS AS
    (encode(extensions.digest(payload_json::text, 'sha256'), 'hex')) STORED,
  context_text text NOT NULL CHECK (context_text = (context_text::jsonb)::text),
  context_sha256 text GENERATED ALWAYS AS
    (encode(extensions.digest(context_text, 'sha256'), 'hex')) STORED,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX engagement_response_decision_link_root
  ON public.engagement_response_decision_links(campaign_id, response_id, decision_id)
  WHERE predecessor_id IS NULL;
CREATE INDEX engagement_response_decision_link_campaign
  ON public.engagement_response_decision_links(campaign_id, response_id, created_at, id);
CREATE TRIGGER engagement_response_decision_link_immutable BEFORE UPDATE OR DELETE
  ON public.engagement_response_decision_links FOR EACH ROW
  EXECUTE FUNCTION public.refuse_engagement_history_change();
ALTER TABLE public.engagement_response_decision_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_response_decision_links FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.engagement_response_decision_links TO authenticated;
CREATE POLICY engagement_response_decision_link_staff_read
  ON public.engagement_response_decision_links FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.engagement_campaigns c
      JOIN public.workspace_members m ON m.workspace_id = c.workspace_id
      WHERE c.id = campaign_id AND c.workspace_id = engagement_response_decision_links.workspace_id
        AND m.user_id = auth.uid() AND m.role IN ('owner', 'admin', 'member'))
  );

CREATE FUNCTION public.write_engagement_response_decision_link(
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
  IF NOT pg_try_advisory_xact_lock(hashtextextended('engagement-decision-request:' || p_request::text, 0)) THEN
    RAISE EXCEPTION 'Decision link save is busy; retry the same request' USING ERRCODE = 'PT503';
  END IF;
  SELECT * INTO campaign FROM public.engagement_campaigns WHERE id = p_campaign FOR SHARE NOWAIT;
  IF campaign.id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.workspace_members WHERE workspace_id = campaign.workspace_id
      AND user_id = auth.uid() AND role IN ('owner', 'admin', 'member') FOR SHARE NOWAIT
  ) THEN
    RAISE EXCEPTION 'Staff campaign access required' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.workspaces WHERE id = campaign.workspace_id FOR SHARE NOWAIT;
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
