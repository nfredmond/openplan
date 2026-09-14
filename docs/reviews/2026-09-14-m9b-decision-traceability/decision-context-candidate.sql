-- Candidate only. The link command will compare this exact private context before
-- retaining a new link. This read is not a decision approval or publication.
CREATE FUNCTION public.read_engagement_response_decision_context(
  p_campaign uuid, p_response uuid, p_decision uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  campaign public.engagement_campaigns%ROWTYPE;
  response public.engagement_closeloop_entries%ROWTYPE;
  history public.engagement_response_history%ROWTYPE;
  decision public.project_decisions%ROWTYPE;
  project public.projects%ROWTYPE;
  relationship public.engagement_campaign_projects%ROWTYPE;
  contributions jsonb;
  configurations jsonb;
  context jsonb;
BEGIN
  -- STABLE reads share the calling statement's snapshot. This preview takes no
  -- write locks; the future command must serialize and re-read before saving.
  SELECT * INTO campaign FROM public.engagement_campaigns WHERE id = p_campaign;
  IF auth.uid() IS NULL OR campaign.id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.workspace_members m
    WHERE m.workspace_id = campaign.workspace_id AND m.user_id = auth.uid()
      AND m.role IN ('owner', 'admin', 'member')
  ) THEN
    RAISE EXCEPTION 'Staff campaign access required' USING ERRCODE = '42501';
  END IF;
  IF p_response IS NULL OR p_decision IS NULL THEN
    RAISE EXCEPTION 'Response and decision are required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO response FROM public.engagement_closeloop_entries
    WHERE id = p_response AND campaign_id = p_campaign;
  IF response.id IS NULL THEN
    RAISE EXCEPTION 'Response is unavailable in this campaign' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO decision FROM public.project_decisions WHERE id = p_decision;
  SELECT * INTO project FROM public.projects
    WHERE id = decision.project_id AND workspace_id = campaign.workspace_id;
  SELECT * INTO relationship FROM public.engagement_campaign_projects
    WHERE campaign_id = p_campaign AND project_id = project.id
      AND workspace_id = campaign.workspace_id;
  IF decision.id IS NULL OR project.id IS NULL OR relationship.id IS NULL THEN
    RAISE EXCEPTION 'Decision is unavailable on this campaign''s projects' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO history FROM public.engagement_response_history
    WHERE response_id = p_response AND campaign_id = p_campaign
    ORDER BY revision DESC LIMIT 1;
  -- A no-op response update advances its clock without adding a history row.
  -- Keep both timestamps, and compare content rather than inventing a revision.
  IF history.id IS NULL OR history.event = 'removed'
    OR (history.record_json - 'updated_at') IS DISTINCT FROM (to_jsonb(response) - 'updated_at') THEN
    RAISE EXCEPTION 'Response history does not match the current response' USING ERRCODE = 'PT409';
  END IF;

  -- Retain every original reference, including duplicates and unavailable rows.
  -- Source words are observed now, not asserted to be what the response author
  -- originally saw. Contact fields, metadata and moderation notes stay outside.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'itemId', s.item_id, 'position', s.position,
    'availability', CASE WHEN i.id IS NULL THEN 'unavailable' ELSE 'available' END,
    'record', CASE WHEN i.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', i.id, 'campaign_id', i.campaign_id, 'category_id', i.category_id,
      'title', i.title, 'body', i.body, 'status', i.status, 'source_type', i.source_type,
      'geometry', i.geometry, 'latitude', i.latitude, 'longitude', i.longitude,
      'parent_item_id', i.parent_item_id, 'configuration_version_id', i.configuration_version_id,
      'created_at', i.created_at, 'updated_at', i.updated_at
    ) END,
    'configurationAvailability', CASE WHEN i.id IS NULL THEN 'unavailable'
      WHEN i.configuration_version_id IS NULL THEN 'unknown'
      WHEN v.id IS NULL THEN 'unavailable' ELSE 'available' END
  ) ORDER BY s.position), '[]'::jsonb) INTO contributions
  FROM unnest(response.source_item_ids) WITH ORDINALITY s(item_id, position)
  LEFT JOIN public.engagement_items i ON i.id = s.item_id AND i.campaign_id = p_campaign
  LEFT JOIN public.engagement_configuration_versions v
    ON v.id = i.configuration_version_id AND v.campaign_id = p_campaign;

  -- Definitions belong to submission-time references, never today's substitute.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', v.id, 'campaignId', v.campaign_id, 'createdAt', v.created_at,
    'definitionText', v.definition_json::text, 'definitionSha256', v.definition_sha256
  ) ORDER BY v.id), '[]'::jsonb) INTO configurations
  FROM public.engagement_configuration_versions v
  WHERE v.campaign_id = p_campaign AND v.id IN (
    SELECT i.configuration_version_id FROM public.engagement_items i
    WHERE i.campaign_id = p_campaign AND i.id = ANY(response.source_item_ids)
  );

  context = jsonb_build_object(
    'schema', 1, 'visibility', 'private', 'sourceObservation', 'current_at_link_preview',
    'campaign', jsonb_build_object('id', campaign.id, 'workspaceId', campaign.workspace_id,
      'title', campaign.title),
    'project', jsonb_build_object('id', project.id, 'workspaceId', project.workspace_id,
      'name', project.name),
    'relationship', to_jsonb(relationship),
    'response', to_jsonb(response),
    'responseHistory', jsonb_build_object('id', history.id, 'revision', history.revision,
      'event', history.event, 'actorId', history.actor_id, 'recordedAt', history.recorded_at,
      'recordText', history.record_json::text, 'recordSha256', history.record_sha256),
    'decision', to_jsonb(decision),
    'sourceCount', cardinality(response.source_item_ids), 'sources', contributions,
    'configurationCount', jsonb_array_length(configurations), 'configurations', configurations
  );
  RETURN jsonb_build_object('contextText', context::text,
    'contextSha256', encode(extensions.digest(context::text, 'sha256'), 'hex'));
END $$;
REVOKE ALL ON FUNCTION public.read_engagement_response_decision_context(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_engagement_response_decision_context(uuid, uuid, uuid)
  TO authenticated;
