-- Import retains a new review revision. Earlier revisions and approvals remain
-- immutable. TypeScript reconstructs every original input/capture and compares
-- the complete proposal; this transaction additionally fences native scope,
-- selected final output, current staff and the exact review parent.
CREATE FUNCTION public.check_synthesis_thematic_review_import(p_campaign uuid,p_workspace uuid,p_source uuid,
 p_source_sha256 text,p_reference jsonb,p_origin jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE request public.engagement_synthesis_generation_requests; plan public.engagement_synthesis_generation_plans;
 selected public.engagement_synthesis_generation_selections; captured public.engagement_synthesis_generation_outputs;
 -- Original context can contain escaped NUL or unpaired UTF-16 units. JSON
 -- text retains them. Even json field extraction rejects these values. The
 -- application replays proposal semantics; native code binds the original text
 -- hash, source, safe history manifest and actual selected final capture.
 history jsonb; sequence numeric;
BEGIN
 IF jsonb_typeof(p_reference) IS DISTINCT FROM 'object' OR NOT p_reference ?& ARRAY['requestId','selectionSequence','historyManifestSha256','proposalSha256','finalCaptureSha256']
 OR (SELECT count(*) FROM jsonb_object_keys(p_reference))<>5
 OR jsonb_typeof(p_reference->'requestId') IS DISTINCT FROM 'string'
 OR jsonb_typeof(p_reference->'selectionSequence') IS DISTINCT FROM 'number'
 OR EXISTS(SELECT 1 FROM jsonb_each(p_reference) e WHERE e.key IN ('historyManifestSha256','proposalSha256','finalCaptureSha256')
  AND (jsonb_typeof(e.value)<>'string' OR e.value#>>'{}' !~ '^[a-f0-9]{64}$')) THEN
  RAISE EXCEPTION 'Invalid thematic proposal reference' USING ERRCODE='22023';
 END IF;
 sequence:=(p_reference->>'selectionSequence')::numeric;
 IF sequence NOT BETWEEN 0 AND 9007199254740991 OR sequence<>trunc(sequence) THEN
  RAISE EXCEPTION 'Invalid thematic proposal sequence' USING ERRCODE='22023';
 END IF;
 IF jsonb_typeof(p_origin) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_origin))<>4
 OR p_origin->>'interpretation' IS DISTINCT FROM 'machine_unreviewed' OR p_origin->'reference' IS DISTINCT FROM p_reference
 OR jsonb_typeof(p_origin->'proposalText') IS DISTINCT FROM 'string' OR jsonb_typeof(p_origin->'historyText') IS DISTINCT FROM 'string'
 OR json_typeof((p_origin->>'proposalText')::json) IS DISTINCT FROM 'object'
 OR (p_origin->>'historyText' IS JSON OBJECT WITH UNIQUE KEYS) IS NOT TRUE
 OR encode(extensions.digest(p_origin->>'proposalText','sha256'),'hex') IS DISTINCT FROM p_reference->>'proposalSha256'
 OR encode(extensions.digest(p_origin->>'historyText','sha256'),'hex') IS DISTINCT FROM p_reference->>'historyManifestSha256' THEN
  RAISE EXCEPTION 'Original thematic import evidence differs' USING ERRCODE='22023';
 END IF;
 SELECT * INTO request FROM engagement_synthesis_generation_requests WHERE id=(p_reference->>'requestId')::uuid;
 IF request.id IS NULL OR request.campaign_id IS DISTINCT FROM p_campaign OR request.workspace_id IS DISTINCT FROM p_workspace
 OR request.source_id IS DISTINCT FROM p_source OR request.intent_text::jsonb->>'sourceSha256' IS DISTINCT FROM p_source_sha256
 OR NOT EXISTS(SELECT 1 FROM engagement_synthesis_thematic_requests WHERE request_id=request.id) THEN
  RAISE EXCEPTION 'Thematic import source scope differs' USING ERRCODE='PT409';
 END IF;
 SELECT * INTO plan FROM engagement_synthesis_generation_plans WHERE request_id=request.id;
 IF plan.request_id IS NULL OR NOT EXISTS(SELECT 1 FROM engagement_synthesis_generation_plan_seals WHERE request_id=request.id)
 OR sequence>(SELECT coalesce(max(sequence_no),0) FROM engagement_synthesis_generation_selections WHERE request_id=request.id) THEN
  RAISE EXCEPTION 'Thematic import plan or sequence is unavailable' USING ERRCODE='PT409';
 END IF;
 SELECT * INTO selected FROM engagement_synthesis_generation_selections
 WHERE request_id=request.id AND task_index=(plan.header_text::jsonb->>'frameCount')::bigint AND sequence_no<=sequence
 ORDER BY sequence_no DESC LIMIT 1;
 SELECT * INTO captured FROM engagement_synthesis_generation_outputs WHERE attempt_id=selected.attempt_id;
 IF captured.attempt_id IS NULL OR captured.capture_sha256 IS DISTINCT FROM p_reference->>'finalCaptureSha256' THEN
  RAISE EXCEPTION 'Selected thematic final capture differs' USING ERRCODE='PT409';
 END IF;
 history:=(p_origin->>'historyText')::jsonb;
 IF history->>'purpose' IS DISTINCT FROM 'private_synthesis_thematic_history' OR history->>'status' IS DISTINCT FROM 'proposal_complete'
 OR history->>'requestId' IS DISTINCT FROM request.id::text OR history->>'campaignId' IS DISTINCT FROM p_campaign::text
 OR history->>'workspaceId' IS DISTINCT FROM p_workspace::text OR history->'throughSequence' IS DISTINCT FROM p_reference->'selectionSequence'
 OR history->>'headerSha256' IS DISTINCT FROM plan.header_sha256 THEN
  RAISE EXCEPTION 'Thematic proposal history binding differs' USING ERRCODE='22023';
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.check_synthesis_thematic_review_import(uuid,uuid,uuid,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.retain_engagement_synthesis_review(p_campaign uuid,p_actor uuid,p_workspace uuid,p_intent jsonb,
 p_source uuid,p_source_sha256 text,p_preparation_text text,p_content_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE workspace uuid; request uuid; review uuid; operation text; saved public.engagement_synthesis_review_revisions;
 root public.engagement_synthesis_reviews; parent public.engagement_synthesis_review_revisions;
 source public.engagement_synthesis_sources; preparation jsonb; content jsonb;
BEGIN
 IF p_actor IS NULL OR p_workspace IS NULL THEN RAISE EXCEPTION 'Staff campaign access required' USING ERRCODE='42501'; END IF;
 SELECT c.workspace_id INTO workspace FROM engagement_campaigns c WHERE c.id=p_campaign FOR SHARE NOWAIT;
 IF NOT FOUND OR workspace IS DISTINCT FROM p_workspace OR NOT EXISTS(SELECT 1 FROM workspace_members m
  WHERE m.workspace_id=workspace AND m.user_id=p_actor AND m.role IN ('owner','admin','member') FOR SHARE NOWAIT) THEN
  RAISE EXCEPTION 'Staff campaign access required' USING ERRCODE='42501';
 END IF;
 IF jsonb_typeof(p_intent) IS DISTINCT FROM 'object' OR p_intent->>'actorId' IS DISTINCT FROM p_actor::text
  OR p_intent->>'workspaceId' IS DISTINCT FROM workspace::text OR p_intent->>'requestId' IS NULL THEN
  RAISE EXCEPTION 'Invalid synthesis review intent' USING ERRCODE='22023';
 END IF;
 operation:=p_intent->>'operation'; request:=(p_intent->>'requestId')::uuid;
 IF operation='create' THEN
  review:=request;
  IF NOT p_intent ?& ARRAY['requestId','actorId','workspaceId','operation','sourceId','sourceSha256']
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_intent) k WHERE k NOT IN ('requestId','actorId','workspaceId','operation','sourceId','sourceSha256'))
   OR p_intent->>'sourceId' IS DISTINCT FROM p_source::text OR p_intent->>'sourceSha256' IS DISTINCT FROM p_source_sha256 THEN
   RAISE EXCEPTION 'Invalid synthesis review creation' USING ERRCODE='22023';
  END IF;
 ELSIF operation='correct' THEN
  review:=(p_intent->>'reviewId')::uuid;
  IF NOT p_intent ?& ARRAY['requestId','actorId','workspaceId','operation','reviewId','expectedRevisionId','expectedRevisionSha256','reason','change']
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_intent) k WHERE k NOT IN ('requestId','actorId','workspaceId','operation','reviewId','expectedRevisionId','expectedRevisionSha256','reason','change'))
   OR review IS NULL OR (p_intent->>'expectedRevisionId') IS NULL OR (p_intent->>'expectedRevisionSha256') IS NULL
   OR jsonb_typeof(p_intent->'reason') IS DISTINCT FROM 'string' OR length(btrim(p_intent->>'reason'))=0
   OR jsonb_typeof(p_intent->'change') IS DISTINCT FROM 'object' THEN
   RAISE EXCEPTION 'Invalid synthesis review correction' USING ERRCODE='22023';
  END IF;
 ELSIF operation='import_thematic' THEN
  review:=(p_intent->>'reviewId')::uuid;
  IF NOT p_intent ?& ARRAY['requestId','actorId','workspaceId','operation','reviewId','expectedRevisionId','expectedRevisionSha256','reason','proposal']
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_intent) k WHERE k NOT IN ('requestId','actorId','workspaceId','operation','reviewId','expectedRevisionId','expectedRevisionSha256','reason','proposal'))
   OR review IS NULL OR p_intent->>'expectedRevisionId' IS NULL OR p_intent->>'expectedRevisionSha256' IS NULL
   OR jsonb_typeof(p_intent->'reason') IS DISTINCT FROM 'string' OR length(btrim(p_intent->>'reason'))=0 THEN
   RAISE EXCEPTION 'Invalid thematic review import' USING ERRCODE='22023';
  END IF;
 ELSE RAISE EXCEPTION 'Invalid synthesis review operation' USING ERRCODE='22023';
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('engagement-synthesis-review-request:'||request::text,0))
  OR NOT pg_try_advisory_xact_lock(hashtextextended('engagement-synthesis-review:'||review::text,0)) THEN
  RAISE EXCEPTION 'Review is busy; retry the same request' USING ERRCODE='PT503';
 END IF;
 SELECT * INTO saved FROM engagement_synthesis_review_revisions WHERE id=request;
 IF FOUND THEN
  SELECT * INTO root FROM engagement_synthesis_reviews WHERE id=saved.review_id;
  IF saved.review_id IS DISTINCT FROM review OR saved.actor_id IS DISTINCT FROM p_actor OR saved.intent_json IS DISTINCT FROM p_intent
   OR root.campaign_id IS DISTINCT FROM p_campaign OR root.workspace_id IS DISTINCT FROM workspace
   OR root.source_id IS DISTINCT FROM p_source OR root.source_sha256 IS DISTINCT FROM p_source_sha256 THEN
   RAISE EXCEPTION 'Synthesis review retry differs' USING ERRCODE='PT409';
  END IF;
  RETURN public.engagement_synthesis_review_receipt(request,true);
 END IF;
 SELECT * INTO source FROM engagement_synthesis_sources WHERE id=p_source AND campaign_id=p_campaign AND workspace_id=workspace;
 IF NOT FOUND OR source.snapshot_sha256 IS DISTINCT FROM p_source_sha256 THEN
  RAISE EXCEPTION 'Retained review source differs' USING ERRCODE='PT409';
 END IF;
 IF (p_content_text IS JSON OBJECT) IS NOT TRUE THEN RAISE EXCEPTION 'Invalid review content' USING ERRCODE='22023'; END IF;
 content:=p_content_text::jsonb;
 IF content->>'schemaVersion' IS DISTINCT FROM '1' OR content->>'status' IS DISTINCT FROM 'staff_draft'
  OR content->>'sourceId' IS DISTINCT FROM p_source::text OR content->>'sourceSha256' IS DISTINCT FROM p_source_sha256 THEN
  RAISE EXCEPTION 'Review content source differs' USING ERRCODE='22023';
 END IF;
 IF operation='create' THEN
  IF content ? 'machineOrigin' THEN RAISE EXCEPTION 'Creation cannot claim a machine proposal' USING ERRCODE='22023'; END IF;
  IF (p_preparation_text IS JSON OBJECT) IS NOT TRUE THEN RAISE EXCEPTION 'Invalid review preparation' USING ERRCODE='22023'; END IF;
  preparation:=p_preparation_text::jsonb;
  IF preparation->>'algorithmVersion' IS DISTINCT FROM '1' OR preparation->>'interpretation' IS DISTINCT FROM 'not_assessed'
   OR preparation#>>'{source,requestId}' IS DISTINCT FROM p_source::text OR preparation#>>'{source,sha256}' IS DISTINCT FROM p_source_sha256
   OR preparation#>>'{source,campaignId}' IS DISTINCT FROM p_campaign::text OR preparation#>>'{source,workspaceId}' IS DISTINCT FROM workspace::text THEN
   RAISE EXCEPTION 'Review preparation source differs' USING ERRCODE='22023';
  END IF;
  INSERT INTO engagement_synthesis_reviews(id,campaign_id,workspace_id,source_id,source_sha256,actor_id,preparation_text)
   VALUES(review,p_campaign,workspace,p_source,p_source_sha256,p_actor,p_preparation_text);
  INSERT INTO engagement_synthesis_review_revisions(id,review_id,revision_no,actor_id,intent_json,content_text)
   VALUES(request,review,1,p_actor,p_intent,p_content_text);
 ELSE
  SELECT * INTO root FROM engagement_synthesis_reviews WHERE id=review;
  IF NOT FOUND OR root.campaign_id IS DISTINCT FROM p_campaign OR root.workspace_id IS DISTINCT FROM workspace
   OR root.source_id IS DISTINCT FROM p_source OR root.source_sha256 IS DISTINCT FROM p_source_sha256 OR p_preparation_text IS NOT NULL THEN
   RAISE EXCEPTION 'Review context differs' USING ERRCODE='PT409';
  END IF;
  SELECT * INTO parent FROM engagement_synthesis_review_revisions WHERE review_id=review ORDER BY revision_no DESC LIMIT 1;
  IF NOT FOUND OR parent.id::text IS DISTINCT FROM p_intent->>'expectedRevisionId'
   OR parent.content_sha256 IS DISTINCT FROM p_intent->>'expectedRevisionSha256' THEN
   RAISE EXCEPTION 'Review has a newer revision' USING ERRCODE='PT409';
  END IF;
  IF operation='import_thematic' THEN
   PERFORM check_synthesis_thematic_review_import(p_campaign,workspace,p_source,p_source_sha256,p_intent->'proposal',content->'machineOrigin');
  ELSIF (parent.content_text::jsonb->'machineOrigin') IS DISTINCT FROM (content->'machineOrigin') THEN
   RAISE EXCEPTION 'Correction cannot change original machine evidence' USING ERRCODE='22023';
  END IF;
  IF parent.content_text=p_content_text THEN RAISE EXCEPTION 'Review correction changes nothing' USING ERRCODE='22023'; END IF;
  INSERT INTO engagement_synthesis_review_revisions(id,review_id,revision_no,parent_id,parent_sha256,actor_id,intent_json,reason,content_text)
   VALUES(request,review,parent.revision_no+1,parent.id,parent.content_sha256,p_actor,p_intent,p_intent->>'reason',p_content_text);
 END IF;
 RETURN public.engagement_synthesis_review_receipt(request,false);
EXCEPTION WHEN lock_not_available THEN
 RAISE EXCEPTION 'Review is busy; retry the same request' USING ERRCODE='PT503';
END $$;
REVOKE ALL ON FUNCTION public.retain_engagement_synthesis_review(uuid,uuid,uuid,jsonb,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.retain_engagement_synthesis_review(uuid,uuid,uuid,jsonb,uuid,text,text,text) TO service_role;
