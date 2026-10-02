-- Service preparation acts under the new thematic requester. It does not use a
-- staff JWT, renew older requesters' access, grant dispatch or approve content.
CREATE FUNCTION public.lock_synthesis_thematic_preparation_scope(p_request uuid)
RETURNS public.engagement_synthesis_generation_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved public.engagement_synthesis_generation_requests;
BEGIN
 SELECT * INTO saved FROM engagement_synthesis_generation_requests WHERE id=p_request;
 IF saved.id IS NULL OR NOT EXISTS(SELECT 1 FROM workspace_members m WHERE m.workspace_id=saved.workspace_id
  AND m.user_id=saved.actor_id AND m.role IN ('owner','admin','member') FOR SHARE NOWAIT) THEN
  RAISE EXCEPTION 'Thematic requester staff access required' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM engagement_campaigns WHERE id=saved.campaign_id AND workspace_id=saved.workspace_id FOR SHARE NOWAIT) THEN
  RAISE EXCEPTION 'Thematic campaign scope differs' USING ERRCODE='42501';
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('synthesis-generation-request:'||p_request::text,0)) THEN
  RAISE EXCEPTION 'Thematic preparation is busy' USING ERRCODE='PT503';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM engagement_synthesis_thematic_requests WHERE request_id=p_request) THEN
  RAISE EXCEPTION 'A retained thematic request is required' USING ERRCODE='0A000';
 END IF;
 IF EXISTS(SELECT 1 FROM engagement_synthesis_generation_cancellations WHERE request_id=p_request) THEN
  RAISE EXCEPTION 'Thematic preparation was cancelled' USING ERRCODE='PT409';
 END IF;
 RETURN saved;
EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
 RAISE EXCEPTION 'Thematic preparation is busy' USING ERRCODE='PT503';
END $$;
REVOKE ALL ON FUNCTION public.lock_synthesis_thematic_preparation_scope(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Private formatter. Every caller must establish its own native scope first.
CREATE FUNCTION public.synthesis_preparation_request_record(p_request uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT jsonb_build_object('schemaVersion',1,'campaignId',r.campaign_id,'workspaceId',r.workspace_id,
  'request',jsonb_build_object('id',r.id,'actorId',r.actor_id,'intentText',r.intent_text,'intentSha256',r.intent_sha256,'createdAt',r.created_at),
  'cancellation',CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('id',c.id,'receiptText',c.receipt_text,'receiptSha256',c.receipt_sha256,'createdAt',c.created_at) END)
 FROM engagement_synthesis_generation_requests r LEFT JOIN engagement_synthesis_generation_cancellations c ON c.request_id=r.id WHERE r.id=p_request;
$$;
REVOKE ALL ON FUNCTION public.synthesis_preparation_request_record(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.read_engagement_synthesis_thematic_preparation(p_request uuid,p_target text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request public.engagement_synthesis_generation_requests; parent public.engagement_synthesis_generation_requests;
 child public.engagement_synthesis_generation_requests; thematic public.engagement_synthesis_thematic_requests;
 context public.engagement_synthesis_context_requests; choice public.engagement_synthesis_thematic_choices;
 source public.engagement_synthesis_sources; binding jsonb; child_binding jsonb;
BEGIN
 -- Recheck the new requester before reading selected history.
 request:=lock_synthesis_thematic_preparation_scope(p_request);
 SELECT * INTO thematic FROM engagement_synthesis_thematic_requests WHERE request_id=p_request;
 SELECT * INTO choice FROM engagement_synthesis_thematic_choices WHERE request_id=p_request AND target_record_id=p_target;
 IF choice.request_id IS NULL OR choice.created_by IS DISTINCT FROM request.actor_id THEN
  RAISE EXCEPTION 'Retained thematic input choice required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO parent FROM engagement_synthesis_generation_requests WHERE id=thematic.parent_request_id;
 IF parent.id IS NULL OR parent.campaign_id IS DISTINCT FROM request.campaign_id OR parent.workspace_id IS DISTINCT FROM request.workspace_id
 OR parent.source_id IS DISTINCT FROM request.source_id THEN RAISE EXCEPTION 'Thematic parent scope differs' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM engagement_synthesis_context_requests WHERE request_id=parent.id)
 OR EXISTS(SELECT 1 FROM engagement_synthesis_thematic_requests WHERE request_id=parent.id) THEN
  RAISE EXCEPTION 'Thematic parent must remain a segment request' USING ERRCODE='PT409';
 END IF;
 SELECT * INTO context FROM engagement_synthesis_context_requests WHERE request_id=choice.context_request_id;
 SELECT * INTO child FROM engagement_synthesis_generation_requests WHERE id=context.request_id;
 IF child.id IS NULL OR child.campaign_id IS DISTINCT FROM request.campaign_id OR child.workspace_id IS DISTINCT FROM request.workspace_id
 OR child.source_id IS DISTINCT FROM request.source_id THEN RAISE EXCEPTION 'Thematic context scope differs' USING ERRCODE='42501'; END IF;
 binding:=thematic.thematic_text::jsonb; child_binding:=context.context_text::jsonb;
 IF context.parent_request_id IS DISTINCT FROM parent.id OR child_binding->'parentRequestId' IS DISTINCT FROM binding->'parentRequestId'
 OR child_binding->'selectionSequence' IS DISTINCT FROM binding->'selectionSequence'
 OR child_binding->'segmentResultsManifestSha256' IS DISTINCT FROM binding->'segmentResultsManifestSha256'
 OR child_binding->'contextManifestSha256' IS DISTINCT FROM binding->'contextManifestSha256'
 OR child_binding->>'targetRecordId' IS DISTINCT FROM p_target
 OR choice.choice_text::jsonb->>'contextRequestId' IS DISTINCT FROM context.request_id::text
 OR choice.choice_text::jsonb->>'targetRecordId' IS DISTINCT FROM p_target THEN
  RAISE EXCEPTION 'Thematic preparation dependency differs' USING ERRCODE='PT409';
 END IF;
 SELECT * INTO source FROM engagement_synthesis_sources WHERE id=request.source_id;
 IF source.id IS NULL OR source.campaign_id IS DISTINCT FROM request.campaign_id OR source.workspace_id IS DISTINCT FROM request.workspace_id THEN
  RAISE EXCEPTION 'Thematic source scope differs' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(source.snapshot_text::jsonb->'items') entry WHERE 'item:'||(entry->>'id')=p_target)
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(source.snapshot_text::jsonb->'answers') entry WHERE 'answer:'||(entry->>'id')=p_target) THEN
  RAISE EXCEPTION 'Thematic target is outside the retained source' USING ERRCODE='PT409';
 END IF;
 RETURN jsonb_build_object('schemaVersion',1,'purpose','private_synthesis_thematic_preparation',
  'thematic',synthesis_preparation_request_record(request.id)||jsonb_build_object('thematic',jsonb_build_object('parentRequestId',parent.id,
   'thematicText',thematic.thematic_text,'thematicSha256',thematic.thematic_sha256,'createdAt',thematic.created_at)),
  'parent',synthesis_preparation_request_record(parent.id),
  'context',synthesis_preparation_request_record(child.id)||jsonb_build_object('context',jsonb_build_object('parentRequestId',context.parent_request_id,
   'contextText',context.context_text,'contextSha256',context.context_sha256,'createdAt',context.created_at)),
  'choice',jsonb_build_object('schemaVersion',1,'campaignId',request.campaign_id,'workspaceId',request.workspace_id,'requestId',request.id,
   'targetRecordId',choice.target_record_id,'choiceText',choice.choice_text,'choiceSha256',choice.choice_sha256,'createdBy',choice.created_by,'createdAt',choice.created_at),
  'source',jsonb_build_object('requestId',source.id,'campaignId',source.campaign_id,'workspaceId',source.workspace_id,
   'snapshotSha256',source.snapshot_sha256,'createdAt',source.created_at));
EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
 RAISE EXCEPTION 'Thematic preparation is busy' USING ERRCODE='PT503';
END $$;
REVOKE ALL ON FUNCTION public.read_engagement_synthesis_thematic_preparation(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_engagement_synthesis_thematic_preparation(uuid,text) TO service_role;

-- Each page rechecks the new requester's scope and obtains its fixed dependency
-- sequence from retained bytes. Callers cannot substitute another request/anchor.
CREATE FUNCTION public.read_engagement_synthesis_thematic_preparation_selections(
 p_request uuid,p_target text,p_stage text,p_after_task_index bigint DEFAULT -1,p_limit integer DEFAULT 128)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE scope jsonb; dependency uuid; through_sequence bigint; available_sequence bigint; entries jsonb;
BEGIN
 scope:=read_engagement_synthesis_thematic_preparation(p_request,p_target);
 IF p_stage='parent' THEN
  dependency:=(scope#>>'{parent,request,id}')::uuid;
  through_sequence:=((scope#>>'{thematic,thematic,thematicText}')::jsonb->>'selectionSequence')::bigint;
 ELSIF p_stage='context' THEN
  dependency:=(scope#>>'{context,request,id}')::uuid;
  through_sequence:=((scope#>>'{choice,choiceText}')::jsonb->>'selectionSequence')::bigint;
 ELSE RAISE EXCEPTION 'Invalid thematic preparation stage' USING ERRCODE='22023'; END IF;
 SELECT coalesce(max(sequence_no),0) INTO available_sequence FROM engagement_synthesis_generation_selections WHERE request_id=dependency;
 IF through_sequence NOT BETWEEN 0 AND available_sequence THEN RAISE EXCEPTION 'Thematic dependency sequence is not retained' USING ERRCODE='PT409'; END IF;
 IF p_after_task_index IS NULL OR p_after_task_index NOT BETWEEN -1 AND 9007199254740991 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 128 THEN
  RAISE EXCEPTION 'Invalid thematic preparation cursor' USING ERRCODE='22023';
 END IF;
 SELECT coalesce(jsonb_agg(row.value ORDER BY row.task_index),'[]'::jsonb) INTO entries FROM (
  SELECT s.task_index,jsonb_build_object('receiptText',s.receipt_text,'receiptSha256',s.receipt_sha256) AS value
  FROM engagement_synthesis_generation_selections s WHERE s.request_id=dependency AND s.task_index>p_after_task_index AND s.sequence_no<=through_sequence
   AND NOT EXISTS(SELECT 1 FROM engagement_synthesis_generation_selections n WHERE n.previous_selection_id=s.id AND n.sequence_no<=through_sequence)
  ORDER BY s.task_index LIMIT p_limit+1
 ) row;
 RETURN jsonb_build_object('schemaVersion',1,'requestId',dependency,'throughSequence',through_sequence,'afterTaskIndex',p_after_task_index,
  'hasMore',jsonb_array_length(entries)>p_limit,'entries',CASE WHEN jsonb_array_length(entries)>p_limit THEN entries-p_limit ELSE entries END);
END $$;
REVOKE ALL ON FUNCTION public.read_engagement_synthesis_thematic_preparation_selections(uuid,text,text,bigint,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_engagement_synthesis_thematic_preparation_selections(uuid,text,text,bigint,integer) TO service_role;
