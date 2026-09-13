CREATE TEMP TABLE translation_history_receipts_result(passed boolean NOT NULL);
DO $proof$
DECLARE actor uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
 workspace uuid:=gen_random_uuid(); campaign uuid:=gen_random_uuid(); first_request uuid:=gen_random_uuid();
 corrected_request uuid:=gen_random_uuid(); withdrawn_request uuid:=gen_random_uuid();
 source_words text:=chr(160)||'SYNTHETIC original checked source'||chr(65279);
 corrected_words text:=chr(160)||'SYNTHETIC correction'||chr(65279);
 reason text:=chr(160)||'SYNTHETIC recorded reason'||chr(65279);
 answer jsonb; initial jsonb; current_snapshot jsonb; title_id uuid; original_digest text; refused boolean;
BEGIN
 INSERT INTO auth.users(id,aud,role,email) VALUES
  (actor,'authenticated','authenticated',actor::text||'@translation-receipt-history.invalid'),
  (viewer,'authenticated','authenticated',viewer::text||'@translation-receipt-history.invalid'),
  (outsider,'authenticated','authenticated',outsider::text||'@translation-receipt-history.invalid');
 INSERT INTO workspaces(id,name,slug) VALUES(workspace,'SYNTHETIC receipt history',workspace::text);
 INSERT INTO workspace_members(workspace_id,user_id,role) VALUES(workspace,actor,'owner'),(workspace,viewer,'viewer');
 INSERT INTO engagement_campaigns(id,workspace_id,title,summary,created_by) VALUES(campaign,workspace,source_words,source_words,actor);
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 SET LOCAL ROLE authenticated;
 answer:=write_engagement_translations(campaign,first_request,'save','es',NULL,jsonb_build_array(
  jsonb_build_object('entityType','campaign','entityId',campaign,'field','title','expectedTranslation',NULL,
   'expectedSource',jsonb_build_object('text',source_words,'sourceLocale',NULL,'available',true),'text','SYNTHETIC original title'),
  jsonb_build_object('entityType','campaign','entityId',campaign,'field','summary','expectedTranslation',NULL,
   'expectedSource',jsonb_build_object('text',source_words,'sourceLocale',NULL,'available',true),'text','SYNTHETIC original summary')
 ));
 initial:=read_engagement_translation_history(campaign);
 IF initial->>'schema'<>'2' OR initial->>'count'<>'2' OR initial->>'receiptCount'<>'1' OR jsonb_array_length(initial->'receipts')<>1
 THEN RAISE EXCEPTION 'History did not return one complete batch receipt'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(initial->'entries') h WHERE h->>'write_request_id' IS DISTINCT FROM first_request::text)
 THEN RAISE EXCEPTION 'History command links were missing'; END IF;
 IF (initial->'receipts'->0->>'payload_text')::jsonb->'entries'->0->'expectedSource'->>'text' IS DISTINCT FROM source_words
 OR encode(extensions.digest(initial->'receipts'->0->>'payload_text','sha256'),'hex') IS DISTINCT FROM initial->'receipts'->0->>'payload_sha256'
 OR encode(extensions.digest(initial->'receipts'->0->>'result_text','sha256'),'hex') IS DISTINCT FROM initial->'receipts'->0->>'result_sha256'
 THEN RAISE EXCEPTION 'Exact command bytes or checksums were lost'; END IF;
 SELECT (e->'entry'->>'id')::uuid INTO STRICT title_id FROM jsonb_array_elements(answer->'entries') e WHERE e->'entry'->>'field'='title';
 SELECT record_sha256 INTO STRICT original_digest FROM engagement_translation_history WHERE translation_id=title_id AND revision=1;
 UPDATE engagement_campaigns SET title='SYNTHETIC newly revised source' WHERE id=campaign;
 answer:=write_engagement_translations(campaign,corrected_request,'save','es',reason,jsonb_build_array(
  jsonb_build_object('entityType','campaign','entityId',campaign,'field','title','expectedTranslation',jsonb_build_object('id',title_id,'revision',1),
   'expectedSource',jsonb_build_object('text','SYNTHETIC newly revised source','sourceLocale',NULL,'available',true),'text',corrected_words)
 ));
 -- A pre-command producer still has no receipt. Do not guess its source or reason.
 INSERT INTO engagement_content_translations(workspace_id,campaign_id,entity_type,entity_id,field,locale,translated_text,source)
 VALUES(workspace,campaign,'campaign',campaign,'summary','fr','SYNTHETIC legacy producer','operator');
 UPDATE engagement_campaigns SET title='' WHERE id=campaign;
 answer:=write_engagement_translations(campaign,withdrawn_request,'withdraw','es',reason,jsonb_build_array(
  jsonb_build_object('entityType','campaign','entityId',campaign,'field','title','expectedTranslation',jsonb_build_object('id',title_id,'revision',2),
   'expectedSource',jsonb_build_object('text','','sourceLocale',NULL,'available',false))
 ));
 current_snapshot:=read_engagement_translation_history(campaign);
 IF current_snapshot->>'count'<>'5' OR current_snapshot->>'receiptCount'<>'3'
 THEN RAISE EXCEPTION 'Correction withdrawal and legacy history are incomplete'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(current_snapshot->'entries') h WHERE h->>'translation_id'=title_id::text
  AND h->>'revision'='1' AND h->>'record_sha256'=original_digest)
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(current_snapshot->'entries') h WHERE (h->>'record_text')::jsonb->>'locale'='fr' AND h->'write_request_id'='null'::jsonb)
 THEN RAISE EXCEPTION 'Original custody or unknown legacy evidence changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(current_snapshot->'receipts') r WHERE r->>'request_id'=corrected_request::text
  AND (r->>'payload_text')::jsonb->>'reason'=reason)
 THEN RAISE EXCEPTION 'Correction reason was not retained exactly'; END IF;
 PERFORM set_config('request.jwt.claim.sub',viewer::text,true);
 current_snapshot:=read_engagement_translation_history(campaign);
 IF current_snapshot->>'count'<>'0' OR current_snapshot->>'receiptCount'<>'0' OR current_snapshot->'entries'<>'[]'::jsonb OR current_snapshot->'receipts'<>'[]'::jsonb
 THEN RAISE EXCEPTION 'Viewer received private history or receipts'; END IF;
 PERFORM set_config('request.jwt.claim.sub',outsider::text,true);
 current_snapshot:=read_engagement_translation_history(campaign);
 IF current_snapshot->>'count'<>'0' OR current_snapshot->>'receiptCount'<>'0' OR current_snapshot->'receipts'<>'[]'::jsonb
 THEN RAISE EXCEPTION 'Outsider received private history or receipts'; END IF;
 RESET ROLE;
 IF has_function_privilege('anon','public.read_engagement_translation_history(uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'Anonymous execute privilege survived'; END IF;
 SET LOCAL ROLE anon;
 refused:=false;
 BEGIN PERFORM read_engagement_translation_history(campaign); EXCEPTION WHEN insufficient_privilege THEN refused:=true; END;
 IF NOT refused THEN RAISE EXCEPTION 'Anonymous caller read private history'; END IF;
 RESET ROLE;
 INSERT INTO translation_history_receipts_result VALUES(true);
END $proof$;
SELECT 'translation-history-receipts-verified' FROM translation_history_receipts_result WHERE passed;
