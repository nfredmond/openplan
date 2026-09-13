DO $proof$
DECLARE campaign uuid:='a3c41566-bfd4-40f2-b467-96ee79054ec6'; workspace uuid; response uuid;
 actor uuid:='4a21e42f-27a7-474d-9a7a-5912c70af359'; viewer uuid:=gen_random_uuid(); original uuid:=gen_random_uuid(); replacement uuid:=gen_random_uuid();
 i integer; events text[]; digest text; snapshot jsonb; refused boolean;
BEGIN
 SELECT workspace_id INTO STRICT workspace FROM engagement_campaigns WHERE id=campaign;
 SELECT id INTO STRICT response FROM engagement_closeloop_entries WHERE campaign_id=campaign ORDER BY id LIMIT 1;
 IF NOT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=workspace AND user_id=actor AND role IN ('owner','admin','member')) THEN RAISE EXCEPTION 'Probe actor does not own named fixture'; END IF;
 IF EXISTS(SELECT 1 FROM engagement_content_translations WHERE campaign_id=campaign AND locale='qaa') THEN RAISE EXCEPTION 'Refuse existing probe locale'; END IF;
 IF NOT EXISTS(SELECT 1 FROM engagement_translation_history WHERE campaign_id=campaign AND event='legacy_baseline' AND record_json->>'locale'='qab') THEN RAISE EXCEPTION 'Missing observed baseline fixture'; END IF;
 IF EXISTS(SELECT 1 FROM engagement_content_translations t LEFT JOIN engagement_translation_history h ON h.translation_id=t.id AND h.revision=1
 WHERE h.id IS NULL OR h.event<>'legacy_baseline' OR h.actor_id IS NOT NULL OR h.record_json IS DISTINCT FROM to_jsonb(t)) THEN RAISE EXCEPTION 'Baseline changed current rows or invented actor'; END IF;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
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
 refused:=false;
 BEGIN UPDATE engagement_translation_history SET record_json='{}'::jsonb WHERE translation_id=original AND revision=1;
 EXCEPTION WHEN raise_exception THEN refused:=true; END;
 IF NOT refused THEN RAISE EXCEPTION 'Retained history tampering survived'; END IF;
 SET LOCAL ROLE authenticated;
 snapshot:=public.read_engagement_translation_history(campaign);
 IF (snapshot->>'count')::integer<1011 OR jsonb_array_length(snapshot->'entries')<>(snapshot->>'count')::integer THEN RAISE EXCEPTION 'Staff history incomplete'; END IF;
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
 RAISE NOTICE 'TRANSLATION_HISTORY_PROBE: baseline, exact original, acceptance, correction, no-op, removal, recreation, immutable address/history, private complete reader passed';
END $proof$;
