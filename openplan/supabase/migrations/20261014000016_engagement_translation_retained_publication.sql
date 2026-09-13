-- Publish exact retained generation through the existing versioned command.
-- Execution stays revoked until the API/editor and legacy producers are joined.
-- No provider call, selected-key lookup or automatic publication is added.

-- Resolve one immutable generation reference inside the authorized write command.
-- Current key selection and the generating actor's current membership do not
-- invalidate already-retained completed output. Publication has its own actor.
CREATE FUNCTION public.retained_translation_publication(p_campaign uuid,p_workspace uuid,p_locale text,p_entry jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE ref jsonb:=p_entry->'generation'; job public.engagement_translation_generation_fields;
 request public.engagement_translation_generation_requests; output public.engagement_translation_generation_outputs;
 words text; model text;
BEGIN
 IF jsonb_typeof(ref) IS DISTINCT FROM 'object' OR NOT ref ?& ARRAY['requestId','fieldId','attemptId','deliveryDigest']
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(ref) k WHERE k NOT IN ('requestId','fieldId','attemptId','deliveryDigest'))
 OR jsonb_typeof(ref->'requestId') IS DISTINCT FROM 'string' OR jsonb_typeof(ref->'fieldId') IS DISTINCT FROM 'string'
 OR jsonb_typeof(ref->'attemptId') IS DISTINCT FROM 'string' OR jsonb_typeof(ref->'deliveryDigest') IS DISTINCT FROM 'string'
 OR ref->>'deliveryDigest' !~ '^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION 'Invalid retained generation reference' USING ERRCODE='22023';
 END IF;
 SELECT * INTO job FROM engagement_translation_generation_fields WHERE id=(ref->>'fieldId')::uuid;
 IF NOT FOUND OR job.request_id IS DISTINCT FROM (ref->>'requestId')::uuid OR job.attempt_id IS DISTINCT FROM (ref->>'attemptId')::uuid THEN
  RAISE EXCEPTION 'Retained generation identity differs' USING ERRCODE='PT409';
 END IF;
 SELECT * INTO STRICT request FROM engagement_translation_generation_requests WHERE id=job.request_id;
 IF request.campaign_id IS DISTINCT FROM p_campaign OR request.workspace_id IS DISTINCT FROM p_workspace OR request.locale IS DISTINCT FROM p_locale THEN
  RAISE EXCEPTION 'Retained generation scope differs' USING ERRCODE='PT409';
 END IF;
 IF job.address IS DISTINCT FROM (p_entry-'generation') THEN
  RAISE EXCEPTION 'Retained generation source or saved baseline differs' USING ERRCODE='PT409';
 END IF;
 SELECT * INTO output FROM engagement_translation_generation_outputs WHERE field_id=job.id AND attempt_id=job.attempt_id;
 IF NOT FOUND OR output.delivery_digest IS DISTINCT FROM ref->>'deliveryDigest' THEN
  RAISE EXCEPTION 'Retained generation delivery differs' USING ERRCODE='PT409';
 END IF;
 IF job.state<>'completed' OR output.status<>'completed' OR output.accepted_state<>'completed' THEN
  RAISE EXCEPTION 'Only successfully completed generation can be published' USING ERRCODE='PT409';
 END IF;
 -- Only completed output reaches JSONB text conversion. Opaque provider
 -- metadata may contain unsupported Unicode escapes and stays untouched.
 words:=output.output_json::jsonb#>>'{}';
 model:=request.credential#>>'{configuration,modelId}';
 IF words IS NULL OR length(words) NOT BETWEEN 1 AND 8000
 OR translation_source_compatibility_hash(words)=translation_source_compatibility_hash('')
 OR output.binding_canonical::jsonb->>'outputHash' IS DISTINCT FROM encode(extensions.digest(words,'sha256'),'hex')
 OR model IS NULL OR output.binding_canonical::jsonb->>'model' IS DISTINCT FROM model THEN
  RAISE EXCEPTION 'Retained generation words or model differ' USING ERRCODE='PT409';
 END IF;
 RETURN jsonb_build_object('words',words,'model',model,'generation',ref||jsonb_build_object('actorId',request.actor_id,
  'outputHash',output.binding_canonical::jsonb->>'outputHash'));
END $$;
REVOKE ALL ON FUNCTION public.retained_translation_publication(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.write_engagement_translations(
 p_campaign uuid,p_request uuid,p_operation text,p_locale text,p_reason text,p_entries jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 campaign public.engagement_campaigns%ROWTYPE;
 receipt public.engagement_translation_write_receipts%ROWTYPE;
 previous public.engagement_content_translations%ROWTYPE;
 saved public.engagement_content_translations%ROWTYPE;
 entry jsonb; expected jsonb; actual_source jsonb; publication jsonb; envelope jsonb; results jsonb:='[]'::jsonb;
 revision bigint; has_previous boolean; target_entity_id uuid;
 previous_context text:=current_setting('openplan.translation_write_request',true);
 previous_timeout text:=current_setting('lock_timeout');
BEGIN
 -- No paid operation occurs here. Bounded acquisition also covers foreign-key
 -- checks/cascades whose implicit locks are not visible in the application SQL.
 PERFORM set_config('lock_timeout','100ms',true);
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Staff authentication required' USING ERRCODE='42501'; END IF;
 -- Refuse outsiders before exposing contention or acquiring campaign locks.
 -- The locked membership check below still protects changes during acquisition.
 IF NOT EXISTS(SELECT 1 FROM engagement_campaigns c JOIN workspace_members m ON m.workspace_id=c.workspace_id
  WHERE c.id=p_campaign AND m.user_id=auth.uid() AND m.role IN ('owner','admin','member')) THEN
  RAISE EXCEPTION 'Staff campaign access required' USING ERRCODE='42501';
 END IF;
 IF p_campaign IS NULL OR NOT pg_try_advisory_xact_lock(hashtextextended('engagement-response:'||p_campaign::text,0)) THEN
  RAISE EXCEPTION 'Translation sources are busy; retry the same request' USING ERRCODE='PT503';
 END IF;
 SELECT * INTO campaign FROM engagement_campaigns WHERE id=p_campaign FOR UPDATE NOWAIT;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=campaign.workspace_id
  AND user_id=auth.uid() AND role IN ('owner','admin','member') FOR SHARE NOWAIT) THEN
  RAISE EXCEPTION 'Staff campaign access required' USING ERRCODE='42501';
 END IF;
 IF p_request IS NULL OR p_operation IS NULL OR p_operation NOT IN ('save','accept','withdraw','publish_generated')
  OR p_locale IS NULL OR p_locale !~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
  OR length(p_locale)>35 OR length(p_reason)>2000 OR p_entries IS NULL
  OR jsonb_typeof(p_entries)<>'array' OR jsonb_array_length(p_entries) NOT BETWEEN 1 AND 200
  OR octet_length(p_entries::text)>8388608 THEN
  RAISE EXCEPTION 'Invalid translation command' USING ERRCODE='22023';
 END IF;
 envelope:=jsonb_build_object('schema',1,'campaignId',p_campaign,'requestId',p_request,'actorId',auth.uid(),
  'operation',p_operation,'locale',p_locale,'reason',p_reason,'entries',p_entries);
 SELECT * INTO receipt FROM engagement_translation_write_receipts WHERE campaign_id=p_campaign AND request_id=p_request;
 IF FOUND THEN
  IF receipt.actor_id IS DISTINCT FROM auth.uid() OR receipt.payload IS DISTINCT FROM envelope THEN
   RAISE EXCEPTION 'Request id already names different content' USING ERRCODE='PT409';
  END IF;
  IF receipt.result_json IS NULL THEN RAISE EXCEPTION 'Translation receipt is unfinished' USING ERRCODE='PT503'; END IF;
  PERFORM set_config('lock_timeout',previous_timeout,true);
  RETURN receipt.result_json||jsonb_build_object('replayed',true);
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_entries) e WHERE jsonb_typeof(e)<>'object'
  OR NOT (e ?& ARRAY['entityType','entityId','field','expectedSource','expectedTranslation'])
  OR jsonb_typeof(e->'entityType')<>'string' OR jsonb_typeof(e->'entityId')<>'string' OR jsonb_typeof(e->'field')<>'string'
  OR jsonb_typeof(e->'expectedSource')<>'object'
  OR (e->'expectedTranslation'<>'null'::jsonb AND jsonb_typeof(e->'expectedTranslation')<>'object')
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(e) k WHERE k NOT IN ('entityType','entityId','field','expectedSource','expectedTranslation','text','generation'))
  OR (p_operation='save' AND (NOT e ? 'text' OR jsonb_typeof(e->'text')<>'string' OR length(e->>'text') NOT BETWEEN 1 AND 8000
    OR translation_source_compatibility_hash(e->>'text')=translation_source_compatibility_hash('')))
  OR (p_operation<>'save' AND e ? 'text')
  OR (p_operation='publish_generated' AND NOT e ? 'generation')
  OR (p_operation<>'publish_generated' AND e ? 'generation')) THEN
  RAISE EXCEPTION 'Invalid translation entries' USING ERRCODE='22023';
 END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_entries))<>(SELECT count(DISTINCT (e->>'entityType',e->>'entityId',e->>'field')) FROM jsonb_array_elements(p_entries) e) THEN
  RAISE EXCEPTION 'A translation address appears twice' USING ERRCODE='22023';
 END IF;
 INSERT INTO engagement_translation_write_receipts(campaign_id,request_id,actor_id,payload)
 VALUES(p_campaign,p_request,auth.uid(),envelope);
 PERFORM set_config('openplan.translation_write_request',p_request::text,true);
 FOR entry IN SELECT value FROM jsonb_array_elements(p_entries) ORDER BY value->>'entityType',value->>'entityId',value->>'field' LOOP
  target_entity_id:=(entry->>'entityId')::uuid;
  actual_source:=translation_source_snapshot(p_campaign,entry->>'entityType',target_entity_id,entry->>'field');
  IF actual_source IS DISTINCT FROM entry->'expectedSource' THEN
   RAISE EXCEPTION 'Translation source changed; review its current words' USING ERRCODE='PT409';
  END IF;
  IF p_operation<>'withdraw' AND NOT (actual_source->>'available')::boolean THEN
   RAISE EXCEPTION 'Translation source is not published or contains no words' USING ERRCODE='PT409';
  END IF;
  SELECT * INTO previous FROM engagement_content_translations WHERE campaign_id=p_campaign
   AND entity_type=entry->>'entityType' AND entity_id=target_entity_id AND field=entry->>'field' AND locale=p_locale FOR UPDATE NOWAIT;
  has_previous:=FOUND;
  expected:=entry->'expectedTranslation';
  IF expected='null'::jsonb THEN
   IF has_previous OR p_operation NOT IN ('save','publish_generated') THEN RAISE EXCEPTION 'Translation presence changed' USING ERRCODE='PT409'; END IF;
  ELSE
   IF NOT has_previous OR expected IS DISTINCT FROM jsonb_build_object('id',previous.id,'revision',
    (SELECT max(h.revision) FROM engagement_translation_history h WHERE h.translation_id=previous.id)) THEN
    RAISE EXCEPTION 'Translation changed; review its saved version' USING ERRCODE='PT409';
   END IF;
  END IF;
  IF (has_previous OR p_operation<>'save') AND (p_reason IS NULL OR translation_source_compatibility_hash(p_reason)=translation_source_compatibility_hash('')) THEN
   RAISE EXCEPTION 'A reason is required for changing retained wording' USING ERRCODE='22023';
  END IF;
  IF p_operation='publish_generated' THEN
   publication:=retained_translation_publication(p_campaign,campaign.workspace_id,p_locale,entry);
  END IF;
  IF p_operation='withdraw' THEN
   DELETE FROM engagement_content_translations WHERE id=previous.id RETURNING * INTO saved;
  ELSIF p_operation='accept' THEN
   IF previous.source<>'machine' THEN RAISE EXCEPTION 'Only machine wording can be accepted' USING ERRCODE='PT409'; END IF;
   IF previous.source_text_hash IS DISTINCT FROM translation_source_compatibility_hash(actual_source->>'text') THEN
    RAISE EXCEPTION 'Machine wording belongs to a different or unknown source version' USING ERRCODE='PT409';
   END IF;
   UPDATE engagement_content_translations SET source='operator',machine_model=NULL,
    source_text_hash=translation_source_compatibility_hash(actual_source->>'text'),updated_at=clock_timestamp()
    WHERE id=previous.id RETURNING * INTO saved;
  ELSIF p_operation='publish_generated' THEN
   IF has_previous THEN
    UPDATE engagement_content_translations SET translated_text=publication->>'words',source='machine',machine_model=publication->>'model',
     source_text_hash=translation_source_compatibility_hash(actual_source->>'text'),created_by=auth.uid(),updated_at=clock_timestamp()
     WHERE id=previous.id RETURNING * INTO saved;
   ELSE
    INSERT INTO engagement_content_translations(workspace_id,campaign_id,entity_type,entity_id,field,locale,translated_text,source,machine_model,source_text_hash,created_by)
    VALUES(campaign.workspace_id,p_campaign,entry->>'entityType',target_entity_id,entry->>'field',p_locale,publication->>'words','machine',publication->>'model',
     translation_source_compatibility_hash(actual_source->>'text'),auth.uid()) RETURNING * INTO saved;
   END IF;
  ELSIF has_previous THEN
   UPDATE engagement_content_translations SET translated_text=entry->>'text',source='operator',machine_model=NULL,
    source_text_hash=translation_source_compatibility_hash(actual_source->>'text'),created_by=auth.uid(),updated_at=clock_timestamp()
    WHERE id=previous.id RETURNING * INTO saved;
  ELSE
   INSERT INTO engagement_content_translations(workspace_id,campaign_id,entity_type,entity_id,field,locale,translated_text,source,source_text_hash,created_by)
   VALUES(campaign.workspace_id,p_campaign,entry->>'entityType',target_entity_id,entry->>'field',p_locale,entry->>'text','operator',
    translation_source_compatibility_hash(actual_source->>'text'),auth.uid()) RETURNING * INTO saved;
  END IF;
  SELECT max(h.revision) INTO revision FROM engagement_translation_history h WHERE h.translation_id=saved.id;
  -- A new generation receipt matters even when words/model/actor are identical.
  -- The ordinary history trigger skips content-identical updates; retain this
  -- explicit publication decision and link it using the active write receipt.
  IF p_operation='publish_generated' AND has_previous AND revision=(expected->>'revision')::bigint THEN
   revision:=revision+1;
   INSERT INTO engagement_translation_history(campaign_id,translation_id,revision,actor_id,event,record_json)
   VALUES(p_campaign,saved.id,revision,auth.uid(),'corrected',to_jsonb(saved));
  END IF;
  results:=results||jsonb_build_array(jsonb_build_object('entry',to_jsonb(saved),'revision',revision,'removed',p_operation='withdraw')
   ||CASE WHEN p_operation='publish_generated' THEN jsonb_build_object('generation',publication->'generation') ELSE '{}'::jsonb END);
 END LOOP;
 UPDATE engagement_translation_write_receipts SET result_json=jsonb_build_object('campaignId',p_campaign,'requestId',p_request,
  'operation',p_operation,'locale',p_locale,'replayed',false,'entries',results)
  WHERE campaign_id=p_campaign AND request_id=p_request RETURNING * INTO receipt;
 PERFORM set_config('openplan.translation_write_request',COALESCE(previous_context,''),true);
 PERFORM set_config('lock_timeout',previous_timeout,true);
 RETURN receipt.result_json;
EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
 RAISE EXCEPTION 'Translation records are busy; no command was committed. Retry the same request' USING ERRCODE='PT503';
END $$;
REVOKE ALL ON FUNCTION public.write_engagement_translations(uuid,uuid,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
