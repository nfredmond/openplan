CREATE TEMP TABLE translation_history_result(passed boolean NOT NULL);
DO $proof$
DECLARE campaign uuid:=gen_random_uuid(); workspace uuid:=gen_random_uuid(); response uuid:=gen_random_uuid();
 actor uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid(); original uuid:=gen_random_uuid(); replacement uuid:=gen_random_uuid();
 category uuid:=gen_random_uuid(); category_translation uuid:=gen_random_uuid(); category_hash text;
 i integer; events text[]; digest text; snapshot jsonb; refused boolean;
BEGIN
 INSERT INTO auth.users(id,aud,role,email) VALUES(actor,'authenticated','authenticated',actor::text||'@translation-history.invalid');
 INSERT INTO workspaces(id,name,slug) VALUES(workspace,'SYNTHETIC translation history',workspace::text);
 INSERT INTO workspace_members(workspace_id,user_id,role) VALUES(workspace,actor,'owner');
 INSERT INTO engagement_campaigns(id,workspace_id,title,created_by) VALUES(campaign,workspace,'SYNTHETIC history fixture',actor);
 INSERT INTO engagement_closeloop_entries(id,campaign_id,theme_title,we_did) VALUES(response,campaign,'SYNTHETIC history response','SYNTHETIC source');
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 SET LOCAL ROLE authenticated;
 INSERT INTO engagement_content_translations(id,workspace_id,campaign_id,entity_type,entity_id,field,locale,translated_text,source,machine_model,source_text_hash,created_by)
 VALUES(original,workspace,campaign,'close_loop_entry',response,'we_did','qaa','Synthetic original translation','machine','synthetic-model',repeat('a',64),actor);
 SELECT record_sha256 INTO STRICT digest FROM engagement_translation_history WHERE translation_id=original AND revision=1;
 UPDATE engagement_content_translations SET source='operator',machine_model=NULL WHERE id=original;
 UPDATE engagement_content_translations SET translated_text='Synthetic corrected translation' WHERE id=original;
 UPDATE engagement_content_translations SET updated_at=clock_timestamp() WHERE id=original;
 DELETE FROM engagement_content_translations WHERE id=original;
 SELECT array_agg(event ORDER BY revision) INTO events FROM engagement_translation_history WHERE translation_id=original;
 IF events IS DISTINCT FROM ARRAY['created','accepted','corrected','removed'] THEN RAISE EXCEPTION 'Wrong translation sequence: %',events; END IF;
 IF NOT EXISTS(SELECT 1 FROM engagement_translation_history WHERE translation_id=original AND revision=1 AND record_sha256=digest
 AND record_json->>'translated_text'='Synthetic original translation' AND record_json->>'machine_model'='synthetic-model' AND actor_id=actor) THEN RAISE EXCEPTION 'Original model, words, actor or hash lost'; END IF;
 INSERT INTO engagement_content_translations(id,workspace_id,campaign_id,entity_type,entity_id,field,locale,translated_text,source)
 VALUES(replacement,workspace,campaign,'close_loop_entry',response,'we_did','qaa','Synthetic recreated translation','operator');
 refused:=false;
 BEGIN UPDATE engagement_content_translations SET locale='qab' WHERE id=replacement;
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Translation identity and address are immutable' THEN refused:=true; ELSE RAISE; END IF; END;
 IF NOT refused THEN RAISE EXCEPTION 'Address mutation survived'; END IF;
 FOR i IN 1..1005 LOOP
  UPDATE engagement_content_translations SET translated_text='Synthetic retained correction '||i WHERE id=replacement;
 END LOOP;
 DELETE FROM engagement_content_translations WHERE id=replacement;
 refused:=false;
 BEGIN
 INSERT INTO engagement_content_translations(id,workspace_id,campaign_id,entity_type,entity_id,field,locale,translated_text,source)
 VALUES(original,workspace,campaign,'close_loop_entry',response,'we_did','qaa','Synthetic reused identity','operator');
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='A retained translation identity cannot be reused' THEN refused:=true; ELSE RAISE; END IF; END;
 IF NOT refused THEN RAISE EXCEPTION 'Removed identity reuse survived'; END IF;
 INSERT INTO engagement_categories(id,campaign_id,label,slug) VALUES(category,campaign,'SYNTHETIC source category',category::text);
 INSERT INTO engagement_content_translations(id,workspace_id,campaign_id,entity_type,entity_id,field,locale,translated_text,source)
 VALUES(category_translation,workspace,campaign,'category',category,'label','qaa','SYNTHETIC removed-source translation','operator');
 SELECT record_sha256 INTO STRICT category_hash FROM engagement_translation_history WHERE translation_id=category_translation AND revision=1;
 DELETE FROM engagement_categories WHERE id=category;
 IF EXISTS(SELECT 1 FROM engagement_content_translations WHERE id=category_translation)
 OR NOT EXISTS(SELECT 1 FROM engagement_translation_history WHERE translation_id=category_translation AND revision=1 AND record_sha256=category_hash)
 OR NOT EXISTS(SELECT 1 FROM engagement_translation_history WHERE translation_id=category_translation AND revision=2 AND event='removed' AND record_json->>'translated_text'='SYNTHETIC removed-source translation')
 THEN RAISE EXCEPTION 'Source cleanup lost retained translation'; END IF;
 RESET ROLE;
 refused:=false;
 BEGIN UPDATE engagement_translation_history SET record_json='{}'::jsonb WHERE translation_id=original AND revision=1;
 EXCEPTION WHEN raise_exception THEN refused:=true; END;
 IF NOT refused THEN RAISE EXCEPTION 'Retained history tampering survived'; END IF;
 SET LOCAL ROLE authenticated;
 snapshot:=public.read_engagement_translation_history(campaign);
 IF (snapshot->>'count')::integer<>1013 OR jsonb_array_length(snapshot->'entries')<>(snapshot->>'count')::integer THEN RAISE EXCEPTION 'Staff history incomplete'; END IF;
 PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 snapshot:=public.read_engagement_translation_history(campaign);
 IF (snapshot->>'count')::integer<>0 THEN RAISE EXCEPTION 'Foreign actor read history'; END IF;
 RESET ROLE;
 INSERT INTO auth.users(id,aud,role,email) VALUES(viewer,'authenticated','authenticated',viewer::text||'@translation-probe.invalid');
 INSERT INTO workspace_members(workspace_id,user_id,role) VALUES(workspace,viewer,'viewer');
 PERFORM set_config('request.jwt.claim.sub',viewer::text,true);
 SET LOCAL ROLE authenticated;
 snapshot:=public.read_engagement_translation_history(campaign);
 IF (snapshot->>'count')::integer<>0 THEN RAISE EXCEPTION 'Viewer read private history'; END IF;
 RESET ROLE;
 SET LOCAL ROLE anon;
 refused:=false;
 BEGIN PERFORM public.read_engagement_translation_history(campaign); EXCEPTION WHEN insufficient_privilege THEN refused:=true; END;
 IF NOT refused THEN RAISE EXCEPTION 'Anonymous history read survived'; END IF;
 RESET ROLE;
 INSERT INTO pg_temp.translation_history_result VALUES(true);
 RAISE NOTICE 'TRANSLATION_HISTORY_PROBE: baseline, exact original, acceptance, correction, no-op, removal, recreation, immutable address/history, source cleanup, private complete reader passed';
END $proof$;

SELECT 'translation-history-verified' FROM pg_temp.translation_history_result WHERE passed;
