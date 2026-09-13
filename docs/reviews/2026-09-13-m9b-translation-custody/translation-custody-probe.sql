\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='20s';
DO $proof$
DECLARE
 campaign uuid := 'a3c41566-bfd4-40f2-b467-96ee79054ec6';
 workspace uuid;
 response uuid;
 captured jsonb;
 originals integer;
 corrections integer;
 response_versions integer;
BEGIN
 SELECT workspace_id INTO STRICT workspace FROM public.engagement_campaigns WHERE id=campaign;
 SELECT id INTO STRICT response FROM public.engagement_closeloop_entries WHERE campaign_id=campaign ORDER BY id LIMIT 1;
 IF EXISTS(SELECT 1 FROM public.engagement_content_translations WHERE campaign_id=campaign AND locale='qaa') THEN
   RAISE EXCEPTION 'Refuse to replace existing probe-locale rows';
 END IF;
 INSERT INTO public.engagement_content_translations(workspace_id,campaign_id,entity_type,entity_id,field,locale,translated_text,source,machine_model,source_text_hash)
 VALUES(workspace,campaign,'campaign',campaign,'title','qaa','Synthetic original campaign translation','machine','synthetic-custody-probe',repeat('a',64));
 SELECT t INTO STRICT captured FROM public.engagement_configuration_versions v, LATERAL jsonb_array_elements(v.definition_json->'translations') t
 WHERE v.campaign_id=campaign AND t->>'locale'='qaa' AND t->>'translated_text'='Synthetic original campaign translation' LIMIT 1;
 IF captured ? 'machine_model' OR captured ? 'created_by' THEN RAISE EXCEPTION 'Inventory changed: configuration now retains authorship/model'; END IF;
 UPDATE public.engagement_content_translations SET translated_text='Synthetic corrected campaign translation',source='operator',machine_model=NULL
 WHERE campaign_id=campaign AND locale='qaa';
 DELETE FROM public.engagement_content_translations WHERE campaign_id=campaign AND locale='qaa';
 SELECT count(*) INTO originals FROM public.engagement_configuration_versions v, LATERAL jsonb_array_elements(v.definition_json->'translations') t
 WHERE v.campaign_id=campaign AND t->>'locale'='qaa' AND t->>'translated_text'='Synthetic original campaign translation';
 SELECT count(*) INTO corrections FROM public.engagement_configuration_versions v, LATERAL jsonb_array_elements(v.definition_json->'translations') t
 WHERE v.campaign_id=campaign AND t->>'locale'='qaa' AND t->>'translated_text'='Synthetic corrected campaign translation';
 IF originals<>1 OR corrections<>1 THEN RAISE EXCEPTION 'Campaign wording custody control failed: original %, corrected %', originals, corrections; END IF;
 INSERT INTO public.engagement_content_translations(workspace_id,campaign_id,entity_type,entity_id,field,locale,translated_text,source,machine_model,source_text_hash)
 VALUES(workspace,campaign,'close_loop_entry',response,'we_did','qaa','Synthetic original response translation','machine','synthetic-custody-probe',repeat('b',64));
 UPDATE public.engagement_content_translations SET translated_text='Synthetic corrected response translation',source='operator',machine_model=NULL
 WHERE campaign_id=campaign AND locale='qaa';
 DELETE FROM public.engagement_content_translations WHERE campaign_id=campaign AND locale='qaa';
 SELECT count(*) INTO response_versions FROM public.engagement_configuration_versions v, LATERAL jsonb_array_elements(v.definition_json->'translations') t
 WHERE v.campaign_id=campaign AND t->>'locale'='qaa' AND t->>'entity_type'='close_loop_entry';
 IF response_versions<>0 THEN RAISE EXCEPTION 'Inventory changed: configuration retains response translations'; END IF;
 IF EXISTS(SELECT 1 FROM public.engagement_content_translations WHERE campaign_id=campaign AND locale='qaa') THEN RAISE EXCEPTION 'Withdrawal failed'; END IF;
 RAISE NOTICE 'CUSTODY_PROBE: campaign_original=1 campaign_corrected=1 response_translation_versions=0 configuration_author_and_model=absent; all writes rolled back';
END $proof$;
ROLLBACK;
