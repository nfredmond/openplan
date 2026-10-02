-- Requested historical inputs are immutable, individually resumable choices.
-- Their digests are claims to reconstruct before sealing a verified input plan.
-- No choice grants execution, staff approval or public access.
CREATE TABLE public.engagement_synthesis_thematic_choices (
 request_id uuid NOT NULL REFERENCES public.engagement_synthesis_thematic_requests(request_id),
 target_record_id text NOT NULL,
 context_request_id uuid NOT NULL REFERENCES public.engagement_synthesis_context_requests(request_id),
 choice_text text NOT NULL CHECK(choice_text IS JSON OBJECT WITH UNIQUE KEYS AND octet_length(choice_text)<=4096),
 choice_sha256 text GENERATED ALWAYS AS (encode(extensions.digest(choice_text,'sha256'),'hex')) STORED,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(request_id,target_record_id),
 UNIQUE(request_id,context_request_id)
);
ALTER TABLE public.engagement_synthesis_thematic_choices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_synthesis_thematic_choices FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.engagement_synthesis_thematic_choices TO service_role;
CREATE TRIGGER synthesis_thematic_choice_immutable BEFORE UPDATE OR DELETE ON public.engagement_synthesis_thematic_choices
 FOR EACH ROW EXECUTE FUNCTION public.refuse_engagement_history_change();

CREATE FUNCTION public.read_engagement_synthesis_thematic_choice(p_campaign uuid,p_request uuid,p_target text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE saved public.engagement_synthesis_thematic_choices; state jsonb;
BEGIN
 state:=read_engagement_synthesis_thematic_request(p_campaign,p_request);
 SELECT * INTO saved FROM public.engagement_synthesis_thematic_choices WHERE request_id=p_request AND target_record_id=p_target;
 IF saved.request_id IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('schemaVersion',1,'campaignId',p_campaign,'workspaceId',state->>'workspaceId',
  'requestId',p_request,'targetRecordId',saved.target_record_id,
  'choiceText',saved.choice_text,'choiceSha256',saved.choice_sha256,'createdBy',saved.created_by,'createdAt',saved.created_at);
END $$;
REVOKE ALL ON FUNCTION public.read_engagement_synthesis_thematic_choice(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_engagement_synthesis_thematic_choice(uuid,uuid,text) TO authenticated;

CREATE FUNCTION public.retain_engagement_synthesis_thematic_choice(p_campaign uuid,p_request uuid,p_choice_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE state jsonb; choice jsonb; requested jsonb; previous public.engagement_synthesis_thematic_choices;
 context public.engagement_synthesis_context_requests; context_request public.engagement_synthesis_generation_requests;
 thematic_request public.engagement_synthesis_generation_requests; context_binding jsonb;
 selected_source public.engagement_synthesis_sources; through_sequence numeric; available_sequence bigint;
BEGIN
 state:=read_engagement_synthesis_thematic_request(p_campaign,p_request);
 IF state#>>'{request,actorId}' IS DISTINCT FROM auth.uid()::text THEN
  RAISE EXCEPTION 'Only the thematic requester can retain input choices' USING ERRCODE='42501';
 END IF;
 IF p_choice_text IS NULL OR octet_length(p_choice_text)>4096 OR p_choice_text IS NOT JSON OBJECT WITH UNIQUE KEYS THEN
  RAISE EXCEPTION 'Invalid thematic input choice' USING ERRCODE='22023';
 END IF;
 choice:=p_choice_text::jsonb;
 IF NOT choice ?& ARRAY['schemaVersion','targetRecordId','contextRequestId','selectionSequence','historyManifestSha256','finalCaptureSha256','finalResultSha256']
 OR (SELECT count(*) FROM jsonb_object_keys(choice))<>7 OR choice->'schemaVersion' IS DISTINCT FROM '1'::jsonb
 OR EXISTS(SELECT 1 FROM jsonb_each(choice) e WHERE e.key IN ('targetRecordId','contextRequestId','historyManifestSha256','finalCaptureSha256','finalResultSha256') AND jsonb_typeof(e.value)<>'string')
 OR choice->>'targetRecordId' !~ '^(item|answer):[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
 OR choice->>'historyManifestSha256' !~ '^[a-f0-9]{64}$' OR choice->>'finalCaptureSha256' !~ '^[a-f0-9]{64}$'
 OR choice->>'finalResultSha256' !~ '^[a-f0-9]{64}$' OR jsonb_typeof(choice->'selectionSequence') IS DISTINCT FROM 'number' THEN
  RAISE EXCEPTION 'Invalid thematic input choice' USING ERRCODE='22023';
 END IF;
 through_sequence:=(choice->>'selectionSequence')::numeric;
 IF through_sequence NOT BETWEEN 0 AND 9007199254740991 OR through_sequence<>trunc(through_sequence) THEN
  RAISE EXCEPTION 'Invalid thematic input selection sequence' USING ERRCODE='22023';
 END IF;
 SELECT * INTO previous FROM public.engagement_synthesis_thematic_choices WHERE request_id=p_request AND target_record_id=choice->>'targetRecordId';
 IF previous.request_id IS NOT NULL THEN
  IF previous.choice_text IS DISTINCT FROM p_choice_text THEN RAISE EXCEPTION 'Thematic input retry differs' USING ERRCODE='PT409'; END IF;
  -- Original acknowledgement recovery remains possible after cancellation.
  RETURN read_engagement_synthesis_thematic_choice(p_campaign,p_request,previous.target_record_id)||jsonb_build_object('replayed',true);
 END IF;
 IF state->'cancellation'<>'null'::jsonb THEN RAISE EXCEPTION 'Thematic request was cancelled' USING ERRCODE='PT409'; END IF;
 SELECT * INTO thematic_request FROM public.engagement_synthesis_generation_requests WHERE id=p_request;
 requested:=(state#>>'{thematic,thematicText}')::jsonb;
 PERFORM lock_synthesis_generation_request_scope(p_campaign,(choice->>'contextRequestId')::uuid);
 SELECT * INTO context FROM public.engagement_synthesis_context_requests WHERE request_id=(choice->>'contextRequestId')::uuid;
 SELECT * INTO context_request FROM public.engagement_synthesis_generation_requests WHERE id=context.request_id;
 IF context.request_id IS NULL OR context_request.campaign_id IS DISTINCT FROM p_campaign
 OR context_request.workspace_id IS DISTINCT FROM thematic_request.workspace_id
 OR context_request.source_id IS DISTINCT FROM thematic_request.source_id THEN
  RAISE EXCEPTION 'Thematic context input is not accessible' USING ERRCODE='42501';
 END IF;
 context_binding:=context.context_text::jsonb;
 IF context.parent_request_id::text IS DISTINCT FROM requested->>'parentRequestId'
 OR context_binding->'selectionSequence' IS DISTINCT FROM requested->'selectionSequence'
 OR context_binding->>'segmentResultsManifestSha256' IS DISTINCT FROM requested->>'segmentResultsManifestSha256'
 OR context_binding->>'contextManifestSha256' IS DISTINCT FROM requested->>'contextManifestSha256'
 OR context_binding->>'targetRecordId' IS DISTINCT FROM choice->>'targetRecordId' THEN
  RAISE EXCEPTION 'Thematic context input differs from the requested parent' USING ERRCODE='PT409';
 END IF;
 SELECT coalesce(max(sequence_no),0) INTO available_sequence FROM public.engagement_synthesis_generation_selections WHERE request_id=context.request_id;
 IF through_sequence>available_sequence THEN RAISE EXCEPTION 'Thematic context sequence is not retained' USING ERRCODE='PT409'; END IF;
 SELECT * INTO selected_source FROM public.engagement_synthesis_sources WHERE id=thematic_request.source_id;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(selected_source.snapshot_text::jsonb->'items') entry WHERE 'item:'||(entry->>'id')=choice->>'targetRecordId')
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(selected_source.snapshot_text::jsonb->'answers') entry WHERE 'answer:'||(entry->>'id')=choice->>'targetRecordId') THEN
  RAISE EXCEPTION 'Thematic context target is outside the retained source' USING ERRCODE='PT409';
 END IF;
 INSERT INTO public.engagement_synthesis_thematic_choices(request_id,target_record_id,context_request_id,choice_text,created_by)
 VALUES(p_request,choice->>'targetRecordId',context.request_id,p_choice_text,auth.uid());
 RETURN read_engagement_synthesis_thematic_choice(p_campaign,p_request,choice->>'targetRecordId')||jsonb_build_object('replayed',false);
EXCEPTION WHEN data_exception THEN RAISE EXCEPTION 'Invalid thematic input choice' USING ERRCODE='22023';
 WHEN lock_not_available OR deadlock_detected THEN RAISE EXCEPTION 'Thematic input is busy; retry the same choice' USING ERRCODE='PT503';
END $$;
REVOKE ALL ON FUNCTION public.retain_engagement_synthesis_thematic_choice(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.retain_engagement_synthesis_thematic_choice(uuid,uuid,text) TO authenticated;
