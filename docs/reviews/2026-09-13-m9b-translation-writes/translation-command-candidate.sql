-- Unreleased transaction candidate. The probe installs this only inside a
-- rollback transaction on the named disposable schema328 stack. Do not grant
-- or ship until every producer, generation custody, UI and recovery are joined.
CREATE TABLE public.engagement_translation_write_receipts (
 campaign_id uuid NOT NULL,
 request_id uuid NOT NULL,
 actor_id uuid NOT NULL,
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 payload_sha256 text GENERATED ALWAYS AS (encode(extensions.digest(payload::text,'sha256'),'hex')) STORED,
 result_json jsonb CHECK(result_json IS NULL OR jsonb_typeof(result_json)='object'),
 result_sha256 text GENERATED ALWAYS AS (encode(extensions.digest(result_json::text,'sha256'),'hex')) STORED,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(campaign_id,request_id)
);
ALTER TABLE public.engagement_translation_write_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engagement_translation_write_receipts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.engagement_translation_write_receipts TO authenticated;
CREATE POLICY translation_receipts_staff_read ON public.engagement_translation_write_receipts
 FOR SELECT TO authenticated USING(EXISTS(
  SELECT 1 FROM public.engagement_campaigns c JOIN public.workspace_members m ON m.workspace_id=c.workspace_id
  WHERE c.id=campaign_id AND m.user_id=auth.uid() AND m.role IN ('owner','admin','member')
 ));
CREATE FUNCTION public.seal_translation_write_receipt() RETURNS trigger LANGUAGE plpgsql
 SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.result_json IS NOT NULL THEN
  RAISE EXCEPTION 'Translation write receipts are retained unchanged';
 END IF;
 IF NEW.campaign_id IS DISTINCT FROM OLD.campaign_id OR NEW.request_id IS DISTINCT FROM OLD.request_id
  OR NEW.actor_id IS DISTINCT FROM OLD.actor_id OR NEW.payload IS DISTINCT FROM OLD.payload
  OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.result_json IS NULL THEN
  RAISE EXCEPTION 'Only an unfinished receipt result may be completed';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.seal_translation_write_receipt() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER translation_receipt_seal BEFORE UPDATE OR DELETE ON public.engagement_translation_write_receipts
 FOR EACH ROW EXECUTE FUNCTION public.seal_translation_write_receipt();

-- Matches the local JavaScript engine's String.trim whitespace set and
-- checked against hashTranslationSource in the probe. Preserve raw words in the
-- receipt; this compatibility hash intentionally trims only for existing readers.
CREATE FUNCTION public.translation_source_compatibility_hash(p_words text) RETURNS text
 LANGUAGE sql IMMUTABLE STRICT SET search_path=public,pg_temp AS $$
 SELECT encode(extensions.digest(btrim(p_words,
 chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||
 chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||
 chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||
 chr(8287)||chr(12288)||chr(65279)),'sha256'),'hex');
$$;
REVOKE ALL ON FUNCTION public.translation_source_compatibility_hash(text) FROM PUBLIC,anon,authenticated;

-- Read the addressed source in the command's transaction. Unpublished/empty
-- sources can be withdrawn, but cannot be newly translated or accepted.
CREATE FUNCTION public.translation_source_snapshot(p_campaign uuid,p_entity text,p_id uuid,p_field text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE words text; available boolean; source_locale text;
BEGIN
 SELECT default_content_locale INTO source_locale FROM engagement_campaigns WHERE id=p_campaign;
 IF p_entity='campaign' AND p_id=p_campaign AND p_field IN ('title','summary','public_description') THEN
  SELECT CASE p_field WHEN 'title' THEN title WHEN 'summary' THEN summary ELSE public_description END,true
   INTO words,available FROM engagement_campaigns WHERE id=p_campaign;
 ELSIF p_entity='category' AND p_field IN ('label','description') THEN
  SELECT CASE p_field WHEN 'label' THEN label ELSE description END,true
   INTO words,available FROM engagement_categories WHERE id=p_id AND campaign_id=p_campaign;
 ELSIF p_entity='survey_question' AND p_field IN ('prompt','help_text') THEN
  SELECT CASE p_field WHEN 'prompt' THEN prompt ELSE help_text END,is_active AND status='published'
   INTO words,available FROM engagement_survey_questions WHERE id=p_id AND campaign_id=p_campaign;
 ELSIF p_entity='survey_question_option' AND p_field='label' THEN
  SELECT o.label,o.is_active AND q.is_active AND q.status='published' INTO words,available
   FROM engagement_survey_question_options o JOIN engagement_survey_questions q ON q.id=o.question_id
   WHERE o.id=p_id AND o.campaign_id=p_campaign AND q.campaign_id=p_campaign;
 ELSIF p_entity='close_loop_entry' AND p_field IN ('theme_title','you_said','we_did') THEN
  SELECT CASE p_field WHEN 'theme_title' THEN theme_title WHEN 'you_said' THEN you_said ELSE we_did END,status='published'
   INTO words,available FROM engagement_closeloop_entries WHERE id=p_id AND campaign_id=p_campaign;
 ELSE
  RAISE EXCEPTION 'Unsupported translation address' USING ERRCODE='22023';
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'Translation source no longer exists' USING ERRCODE='PT409'; END IF;
 RETURN jsonb_build_object('text',words,'sourceLocale',source_locale,'available',
  COALESCE(available,false) AND words IS NOT NULL AND translation_source_compatibility_hash(words)<>translation_source_compatibility_hash(''));
END $$;
REVOKE ALL ON FUNCTION public.translation_source_snapshot(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated;

ALTER TABLE public.engagement_translation_history ADD COLUMN write_request_id uuid;
CREATE FUNCTION public.link_translation_history_receipt() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE active_request uuid; receipt public.engagement_translation_write_receipts%ROWTYPE;
BEGIN
 BEGIN active_request:=NULLIF(current_setting('openplan.translation_write_request',true),'')::uuid;
 EXCEPTION WHEN invalid_text_representation THEN RETURN NEW; END;
 IF active_request IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO receipt FROM engagement_translation_write_receipts
 WHERE campaign_id=NEW.campaign_id AND request_id=active_request AND actor_id=auth.uid() AND result_json IS NULL;
 IF FOUND AND receipt.payload->>'locale'=NEW.record_json->>'locale'
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(receipt.payload->'entries') e
  WHERE e->>'entityType'=NEW.record_json->>'entity_type' AND e->>'entityId'=NEW.record_json->>'entity_id'
   AND e->>'field'=NEW.record_json->>'field') THEN
  NEW.write_request_id:=active_request;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.link_translation_history_receipt() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER translation_history_receipt BEFORE INSERT ON public.engagement_translation_history
 FOR EACH ROW EXECUTE FUNCTION public.link_translation_history_receipt();

CREATE FUNCTION public.write_engagement_translations(
 p_campaign uuid,p_request uuid,p_operation text,p_locale text,p_reason text,p_entries jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 campaign public.engagement_campaigns%ROWTYPE;
 receipt public.engagement_translation_write_receipts%ROWTYPE;
 previous public.engagement_content_translations%ROWTYPE;
 saved public.engagement_content_translations%ROWTYPE;
 entry jsonb; expected jsonb; actual_source jsonb; envelope jsonb; results jsonb:='[]'::jsonb;
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
 -- This candidate deliberately refuses the unfinished producer; it must be
 -- implemented with retained generation results before the command is shipped.
 IF p_operation='publish_generated' THEN
  RAISE EXCEPTION 'Durable generation publication is not installed' USING ERRCODE='0A000';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_entries) e WHERE jsonb_typeof(e)<>'object'
  OR NOT (e ?& ARRAY['entityType','entityId','field','expectedSource','expectedTranslation'])
  OR jsonb_typeof(e->'entityType')<>'string' OR jsonb_typeof(e->'entityId')<>'string' OR jsonb_typeof(e->'field')<>'string'
  OR jsonb_typeof(e->'expectedSource')<>'object'
  OR (e->'expectedTranslation'<>'null'::jsonb AND jsonb_typeof(e->'expectedTranslation')<>'object')
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(e) k WHERE k NOT IN ('entityType','entityId','field','expectedSource','expectedTranslation','text'))
  OR (p_operation='save' AND (NOT e ? 'text' OR jsonb_typeof(e->'text')<>'string' OR length(e->>'text') NOT BETWEEN 1 AND 8000
    OR translation_source_compatibility_hash(e->>'text')=translation_source_compatibility_hash('')))
  OR (p_operation<>'save' AND e ? 'text')) THEN
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
   IF has_previous OR p_operation<>'save' THEN RAISE EXCEPTION 'Translation presence changed' USING ERRCODE='PT409'; END IF;
  ELSE
   IF NOT has_previous OR expected IS DISTINCT FROM jsonb_build_object('id',previous.id,'revision',
    (SELECT max(h.revision) FROM engagement_translation_history h WHERE h.translation_id=previous.id)) THEN
    RAISE EXCEPTION 'Translation changed; review its saved version' USING ERRCODE='PT409';
   END IF;
  END IF;
  IF (has_previous OR p_operation<>'save') AND NULLIF(btrim(p_reason),'') IS NULL THEN
   RAISE EXCEPTION 'A reason is required for changing retained wording' USING ERRCODE='22023';
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
  results:=results||jsonb_build_array(jsonb_build_object('entry',to_jsonb(saved),'revision',revision,'removed',p_operation='withdraw'));
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
