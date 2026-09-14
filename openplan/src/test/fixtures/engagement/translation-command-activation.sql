-- Real role checks inside the caller's rollback transaction. No grant is added
-- by this fixture: creation must use the installed command privilege.
CREATE FUNCTION pg_temp.require_activation_denial(statement text,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN insufficient_privilege THEN RETURN;
 END;
 RAISE EXCEPTION 'Activation guard failed: %',label;
END $$;
DO $proof$
DECLARE actor uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
 workspace uuid:=gen_random_uuid(); campaign uuid:=gen_random_uuid(); request uuid:=gen_random_uuid();
 payload jsonb; result jsonb; replay jsonb; translated uuid; digest text; person uuid; operation text;
BEGIN
 INSERT INTO auth.users(id,aud,role,email) SELECT id,'authenticated','authenticated',id::text||'@activation.synthetic.invalid' FROM unnest(ARRAY[actor,viewer,outsider]) id;
 INSERT INTO workspaces(id,name,slug) VALUES(workspace,'SYNTHETIC command activation',workspace::text);
 INSERT INTO workspace_members(workspace_id,user_id,role) VALUES(workspace,actor,'owner'),(workspace,viewer,'viewer');
 INSERT INTO engagement_campaigns(id,workspace_id,title,created_by) VALUES(campaign,workspace,'SYNTHETIC activation source',actor);
 payload:=jsonb_build_array(jsonb_build_object('entityType','campaign','entityId',campaign,'field','title',
 'expectedSource',jsonb_build_object('text','SYNTHETIC activation source','available',true,'sourceLocale',NULL),'expectedTranslation',NULL,'text','SYNTHETIC checked wording'));
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 SET LOCAL ROLE authenticated;
 BEGIN result:=write_engagement_translations(campaign,request,'save','qaa',NULL,payload);
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Activated staff command failed: % %',SQLSTATE,SQLERRM; END;
 translated:=(result#>>'{entries,0,entry,id}')::uuid;
 IF result#>>'{entries,0,entry,translated_text}' IS DISTINCT FROM 'SYNTHETIC checked wording' OR result#>>'{entries,0,revision}' IS DISTINCT FROM '1'
 OR NOT EXISTS(SELECT 1 FROM engagement_content_translations WHERE id=translated AND created_by=actor)
 THEN RAISE EXCEPTION 'Activated command lost saved wording or staff read'; END IF;
 SELECT record_sha256 INTO STRICT digest FROM engagement_translation_history WHERE translation_id=translated AND revision=1;
 -- Valid own-campaign writes isolate permission denial from relational or RLS errors.
 PERFORM pg_temp.require_activation_denial(format('INSERT INTO engagement_content_translations(workspace_id,campaign_id,entity_type,entity_id,field,locale,translated_text,source,created_by) VALUES(%L,%L,%L,%L,%L,%L,%L,%L,%L)',workspace,campaign,'campaign',campaign,'title','qab','SYNTHETIC bypass','operator',actor),'direct insert');
 PERFORM pg_temp.require_activation_denial(format('UPDATE engagement_content_translations SET translated_text=%L WHERE id=%L','SYNTHETIC bypass',translated),'direct update');
 PERFORM pg_temp.require_activation_denial(format('DELETE FROM engagement_content_translations WHERE id=%L',translated),'direct delete');
 -- A caller-set receipt context must not reopen direct DML.
 PERFORM set_config('openplan.translation_write_request',request::text,true);
 PERFORM pg_temp.require_activation_denial(format('UPDATE engagement_content_translations SET translated_text=%L WHERE id=%L','SYNTHETIC forged context',translated),'forged receipt context');
 PERFORM set_config('openplan.translation_write_request','',true);
 payload:=jsonb_set(jsonb_set(payload,'{0,expectedTranslation}',jsonb_build_object('id',translated,'revision',1)),'{0,text}','"SYNTHETIC corrected wording"');
 result:=write_engagement_translations(campaign,gen_random_uuid(),'save','qaa','SYNTHETIC correction',payload);
 IF result#>>'{entries,0,revision}' IS DISTINCT FROM '2' THEN RAISE EXCEPTION 'Activated correction failed'; END IF;
 payload:=(payload->0)-'text';payload:=jsonb_set(payload,'{expectedTranslation,revision}','2');
 result:=write_engagement_translations(campaign,gen_random_uuid(),'withdraw','qaa','SYNTHETIC withdrawal',jsonb_build_array(payload));
 IF result#>>'{entries,0,revision}' IS DISTINCT FROM '3' OR result#>>'{entries,0,removed}' IS DISTINCT FROM 'true'
 OR EXISTS(SELECT 1 FROM engagement_content_translations WHERE id=translated)
 OR NOT EXISTS(SELECT 1 FROM engagement_translation_history WHERE translation_id=translated AND revision=1 AND record_sha256=digest)
 THEN RAISE EXCEPTION 'Activated withdrawal or original custody failed'; END IF;
 payload:=jsonb_build_array(jsonb_set(jsonb_set(payload,'{expectedTranslation}','null'),'{text}','"SYNTHETIC checked wording"'));
 replay:=write_engagement_translations(campaign,request,'save','qaa',NULL,payload);
 IF replay->>'replayed' IS DISTINCT FROM 'true' OR replay#>>'{entries,0,revision}' IS DISTINCT FROM '1'
 OR EXISTS(SELECT 1 FROM engagement_content_translations WHERE id=translated) THEN RAISE EXCEPTION 'Activated retry resurrected withdrawn wording'; END IF;
 FOREACH person IN ARRAY ARRAY[viewer,outsider] LOOP
  PERFORM set_config('request.jwt.claim.sub',person::text,true);
  PERFORM pg_temp.require_activation_denial(format('SELECT write_engagement_translations(%L,%L,%L,%L,NULL,%L)',campaign,gen_random_uuid(),'save','qab',payload),'nonstaff command');
  PERFORM pg_temp.require_activation_denial(format('SELECT write_engagement_translations(%L,%L,%L,%L,NULL,%L)',campaign,request,'save','qaa',payload),'nonstaff retry');
 END LOOP;
 RESET ROLE;
 SET LOCAL ROLE anon;
 PERFORM pg_temp.require_activation_denial(format('SELECT write_engagement_translations(%L,%L,%L,%L,NULL,%L)',campaign,request,'save','qaa',payload),'anonymous command');
 RESET ROLE;
 FOREACH operation IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
  IF has_table_privilege('authenticated','public.engagement_content_translations',operation)
  OR has_table_privilege('anon','public.engagement_content_translations',operation) THEN RAISE EXCEPTION 'Activation privilege remains: %',operation; END IF;
 END LOOP;
 IF has_function_privilege('anon','public.write_engagement_translations(uuid,uuid,text,text,text,jsonb)','EXECUTE')
 THEN RAISE EXCEPTION 'Anonymous command grant remains'; END IF;
END $proof$;
SELECT 'translation-command-activation-verified';
