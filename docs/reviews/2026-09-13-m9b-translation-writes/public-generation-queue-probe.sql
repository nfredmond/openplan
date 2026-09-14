CREATE FUNCTION pg_temp.require_public_refusal(statement text,expected text,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE=expected THEN RETURN; END IF;
  RAISE EXCEPTION 'Refusal % expected %, got %: %',label,expected,SQLSTATE,SQLERRM;
 END;
 RAISE EXCEPTION 'Guard failed: %',label;
END $$;
CREATE FUNCTION pg_temp.require_public_hidden(statement text,label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE visible bigint;
BEGIN
 BEGIN EXECUTE statement INTO visible;
 EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
 IF visible<>0 THEN RAISE EXCEPTION 'Private public queue leak: %',label; END IF;
END $$;
-- SQL-only fixture. Credential strings are conspicuously synthetic and cannot
-- invoke a provider. A separate SDK/worker exercise must prove encrypted keys.
CREATE FUNCTION pg_temp.queue_public_fixture(campaign uuid,item uuid,token text,locale text DEFAULT 'es') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE request uuid:=gen_random_uuid(); field uuid:=gen_random_uuid(); source jsonb; credential jsonb; packet text; words text;
BEGIN
 source:=read_public_translation_source(token,item);
 words:=CASE WHEN coalesce(source->>'title','')<>'' THEN (source->>'title')||chr(10)||chr(10)||(source->>'body') ELSE source->>'body' END;
 credential:=jsonb_build_object('workspaceId',source->>'workspaceId','requestId',request,'credentialId',gen_random_uuid(),
 'configuration',jsonb_build_object('provider','anthropic','recipeVersion',1,'modelId','SYNTHETIC-SQL-NO-PROVIDER'),
 'configurationHash',repeat('a',64),'source','env','credentialCiphertext','SYNTHETIC-NOT-A-REAL-KEY');
 packet:=format('{"schemaVersion":1,"workspaceId":%s,"campaignId":%s,"fieldId":%s,"sourceText":%s,"targetLanguage":%s}',
 to_json(source->>'workspaceId'),to_json(campaign),to_json(field),to_json(words),to_json(locale));
 RETURN jsonb_build_object('request',request,'field',field,'source',source,'credential',credential,'packet',packet,
 'ack',create_public_translation_request(request,field,token,item,locale,source,packet,credential,NULL));
END $$;
DO $probe$
DECLARE workspace uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); campaign uuid:=gen_random_uuid(); item uuid:=gen_random_uuid();
 parent uuid:=gen_random_uuid(); reply uuid:=gen_random_uuid(); token text:='SYNTHETIC-public-'||gen_random_uuid()::text;
 fixture jsonb; retry jsonb; claim jsonb; second jsonb; ack jsonb; before_claims bigint; fresh_item uuid; i integer;
 request uuid; field uuid; bad_request uuid:=gen_random_uuid(); bad_field uuid:=gen_random_uuid(); call_sql text; binding jsonb; output_json text; binding_json text; digest text;
BEGIN
 INSERT INTO auth.users(id,aud,role,email) VALUES(actor,'authenticated','authenticated',actor::text||'@public-queue.invalid');
 INSERT INTO workspaces(id,name,slug) VALUES(workspace,'SYNTHETIC public queue',workspace::text);
 INSERT INTO workspace_members(workspace_id,user_id,role) VALUES(workspace,actor,'owner');
 INSERT INTO engagement_campaigns(id,workspace_id,title,created_by,status,share_token) VALUES(campaign,workspace,'SYNTHETIC public queue',actor,'active',token);
 INSERT INTO engagement_items(id,campaign_id,title,body,status,source_type) VALUES
 (item,campaign,'SYNTHETIC title','SYNTHETIC body','approved','internal'),
 (parent,campaign,NULL,'SYNTHETIC pending parent','pending','internal');
 INSERT INTO engagement_items(id,campaign_id,title,body,status,source_type,parent_item_id)
 VALUES(reply,campaign,NULL,'SYNTHETIC reply','approved','internal',parent);
 SET LOCAL ROLE service_role;
 PERFORM pg_temp.require_public_refusal(format('SELECT read_public_translation_source(%L,%L)',token,reply),'42501','unapproved parent');
 PERFORM pg_temp.require_public_refusal(format('SELECT read_public_translation_source(%L,%L)',token,parent),'42501','unapproved item');
 PERFORM pg_temp.require_public_refusal(format('SELECT read_public_translation_source(%L,%L)',token||'-wrong',item),'42501','wrong share token');
 fixture:=pg_temp.queue_public_fixture(campaign,item,token);request:=(fixture->>'request')::uuid;field:=(fixture->>'field')::uuid;
 IF fixture#>>'{ack,created}' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Public queue positive failed'; END IF;
 IF (SELECT authority_kind FROM engagement_translation_generation_requests WHERE id=request) IS DISTINCT FROM 'public'
 OR (SELECT actor_id FROM engagement_translation_generation_requests WHERE id=request) IS NOT NULL
 OR EXISTS(SELECT 1 FROM usage_events WHERE workspace_id=workspace) THEN RAISE EXCEPTION 'Anonymous identity or unspent creation failed'; END IF;
 retry:=pg_temp.queue_public_fixture(campaign,item,token)->'ack';
 IF retry IS DISTINCT FROM jsonb_build_object('requestId',request,'created',false)
 OR (SELECT count(*) FROM engagement_translation_generation_fields WHERE request_id=request)<>1 THEN RAISE EXCEPTION 'Public replay duplicated work'; END IF;
 -- Check that replay needs neither replacement credential nor packet.
 retry:=create_public_translation_request(gen_random_uuid(),gen_random_uuid(),token,item,'es',fixture->'source',NULL,NULL,NULL);
 IF retry->>'requestId' IS DISTINCT FROM request::text THEN RAISE EXCEPTION 'Public replay required a new credential'; END IF;
call_sql:=format('SELECT create_public_translation_request(%L,%L,%L,%L,%L,%L,%L,%L,NULL)',bad_request,bad_field,token,item,'vi',fixture->'source',fixture->>'packet',jsonb_set(fixture->'credential','{requestId}',to_jsonb(bad_request)));
 PERFORM pg_temp.require_public_refusal(call_sql,'22023','wrong packet identity');
 call_sql:=format('SELECT create_public_translation_request(%L,%L,%L,%L,%L,%L,%L,%L,NULL)',bad_request,bad_field,token,item,'vi',fixture->'source',
 jsonb_set(jsonb_set((fixture->>'packet')::jsonb,'{fieldId}',to_jsonb(bad_field)),'{targetLanguage}','"vi"')::text,
 jsonb_set(jsonb_set(fixture->'credential','{requestId}',to_jsonb(bad_request)),'{workspaceId}',to_jsonb(gen_random_uuid())));
 PERFORM pg_temp.require_public_refusal(call_sql,'22023','foreign public credential');

 PERFORM pg_temp.require_public_refusal(format('SELECT create_public_translation_request(%L,%L,%L,%L,%L,%L,NULL,NULL,NULL)',gen_random_uuid(),gen_random_uuid(),token,item,'es',jsonb_set(fixture->'source','{body}','"changed"')),'PT409','changed creation source');
 SET LOCAL ROLE anon;
 PERFORM pg_temp.require_public_hidden('SELECT count(*) FROM engagement_public_translation_requests','anonymous authority rows');
 PERFORM pg_temp.require_public_refusal(format('SELECT read_public_translation_request(%L,%L,%L)',request,token,item),'42501','anonymous direct RPC');
 SET LOCAL ROLE authenticated;
 PERFORM pg_temp.require_public_hidden('SELECT count(*) FROM engagement_public_translation_requests','authenticated authority rows');
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM pg_temp.require_public_refusal(format('SELECT read_translation_generation_request(%L,%L)',campaign,request),'42501','public request in staff reader');
 IF jsonb_array_length(list_translation_generation_requests(campaign)->'requests')<>0 THEN RAISE EXCEPTION 'Public request leaked into staff catalog'; END IF;
 SET LOCAL ROLE service_role;
 ack:=read_public_translation_request(request,token,item);
 IF ack IS DISTINCT FROM jsonb_build_object('requestId',request,'language','es','state','queued','translated',NULL) THEN RAISE EXCEPTION 'Public DTO leaked private fields'; END IF;
 PERFORM pg_temp.require_public_refusal(format('SELECT read_public_translation_request(%L,%L,%L)',request,token,reply),'42501','request item substitution');
 RESET ROLE;
 UPDATE engagement_items SET status='rejected',review_expected_updated_at=updated_at,review_reason='SYNTHETIC withdraw source' WHERE id=item;
 SET LOCAL ROLE service_role;
 PERFORM pg_temp.require_public_refusal(format('SELECT claim_translation_generation_field(%L)',field),'42501','withdrawn item before claim');
 RESET ROLE;
 UPDATE engagement_items SET status='approved',review_expected_updated_at=updated_at,review_reason='SYNTHETIC restore source' WHERE id=item;
 SET LOCAL ROLE service_role;
 claim:=claim_translation_generation_field(field);
 IF claim->>'state' IS DISTINCT FROM 'reserved' OR EXISTS(SELECT 1 FROM usage_events WHERE workspace_id=workspace) THEN RAISE EXCEPTION 'Public claim spent before dispatch'; END IF;
 IF claim_translation_generation_field(field) IS NOT NULL THEN RAISE EXCEPTION 'Public claim duplicated'; END IF;
 PERFORM pg_temp.require_public_refusal(format('SELECT authorize_translation_generation_dispatch(%L,%L,%L)',field,gen_random_uuid(),claim->>'reservation_id'),'42501','wrong dispatch attempt');
 RESET ROLE;
 UPDATE engagement_items SET body='SYNTHETIC changed',review_expected_updated_at=updated_at,review_reason='SYNTHETIC source conflict probe' WHERE id=item;
 SET LOCAL ROLE service_role;
 PERFORM pg_temp.require_public_refusal(format('SELECT authorize_translation_generation_dispatch(%L,%L,%L)',field,claim->>'attempt_id',claim->>'reservation_id'),'PT409','changed source before dispatch');
 PERFORM pg_temp.require_public_refusal(format('SELECT read_public_translation_request(%L,%L,%L)',request,token,item),'PT409','changed public read');
 RESET ROLE;
 UPDATE engagement_items SET body='SYNTHETIC body',review_expected_updated_at=updated_at,review_reason='SYNTHETIC restore probe source' WHERE id=item;
 INSERT INTO usage_events(workspace_id,bucket_key,event_key,weight) SELECT workspace,'assistant_chat','SYNTHETIC staff '||n,1 FROM generate_series(1,20) n;
 SET LOCAL ROLE service_role;
 RESET ROLE;
 INSERT INTO usage_events(workspace_id,bucket_key,event_key,weight) SELECT workspace,'engagement_public_translation','SYNTHETIC public intervening '||n,1 FROM generate_series(1,30) n;
 SET LOCAL ROLE service_role;
 PERFORM pg_temp.require_public_refusal(format('SELECT authorize_translation_generation_dispatch(%L,%L,%L)',field,claim->>'attempt_id',claim->>'reservation_id'),'PT429','public dispatch allowance recheck');
 RESET ROLE;
 UPDATE usage_events SET occurred_at=clock_timestamp()-interval '10 minutes' WHERE workspace_id=workspace AND bucket_key='engagement_public_translation';
 SET LOCAL ROLE service_role;
 ack:=authorize_translation_generation_dispatch(field,(claim->>'attempt_id')::uuid,(claim->>'reservation_id')::uuid);
 PERFORM authorize_translation_generation_dispatch(field,(claim->>'attempt_id')::uuid,(claim->>'reservation_id')::uuid);
 IF ack->>'state' IS DISTINCT FROM 'running' OR (SELECT count(*) FROM usage_events WHERE workspace_id=workspace AND bucket_key='engagement_public_translation' AND occurred_at>=clock_timestamp()-interval '300 seconds')<>1
 OR (SELECT count(*) FROM usage_events WHERE workspace_id=workspace AND bucket_key='engagement_content_translation')<>0 THEN RAISE EXCEPTION 'Public dispatch isolation or exactly-once metering failed'; END IF;
 -- Exercise the existing retained output RPC with a real matching SQL delivery.
 binding:=jsonb_build_object('schemaVersion',1,'provider','anthropic','workspaceId',workspace,'campaignId',campaign,'requestId',request,
 'attemptId',claim->>'attempt_id','fieldId',field,'reservationId',claim->>'reservation_id',
 'credentialId',fixture#>>'{credential,credentialId}','configurationHash',repeat('a',64),'packetHash',claim->>'packet_hash',
 'leaseExpiresAt',claim->>'lease_expires_at','model','SYNTHETIC-SQL-NO-PROVIDER','credentialSource','env','recipeVersion',1,'targetLanguage','es',
 'sourceHash',encode(extensions.digest((fixture->>'packet')::jsonb->>'sourceText','sha256'),'hex'),
 'outputHash',encode(extensions.digest('SINTÉTICO resultado','sha256'),'hex'),'finishReason','stop','inputTokens',NULL,'outputTokens',NULL);
 output_json:=to_json('SINTÉTICO resultado'::text)::text;binding_json:=binding::text;
 digest:=encode(extensions.digest('completed'||chr(10)||output_json||chr(10)||binding_json||chr(10)||'{}','sha256'),'hex');
 PERFORM retain_translation_generation_output(field,(claim->>'attempt_id')::uuid,'completed',output_json,binding_json,'{}',digest);
 PERFORM retain_translation_generation_output(field,(claim->>'attempt_id')::uuid,'completed',output_json,binding_json,'{}',digest);
 ack:=read_public_translation_request(request,token,item);
 IF ack IS DISTINCT FROM jsonb_build_object('requestId',request,'language','es','state','completed','translated','SINTÉTICO resultado') THEN RAISE EXCEPTION 'Completed public output or DTO privacy failed'; END IF;
 RESET ROLE;
 UPDATE engagement_campaigns SET share_token=token||'-replaced' WHERE id=campaign;
 SET LOCAL ROLE service_role;
 PERFORM pg_temp.require_public_refusal(format('SELECT read_public_translation_request(%L,%L,%L)',request,token,item),'42501','replaced token old read');
 PERFORM pg_temp.require_public_refusal(format('SELECT read_public_translation_request(%L,%L,%L)',request,token||'-replaced',item),'42501','replaced token old request');
 RESET ROLE;
 UPDATE engagement_campaigns SET share_token=token,status='closed' WHERE id=campaign;
 SET LOCAL ROLE service_role;
 PERFORM pg_temp.require_public_refusal(format('SELECT read_public_translation_request(%L,%L,%L)',request,token,item),'42501','closed campaign completed output');
 RESET ROLE;
 UPDATE engagement_campaigns SET status='active' WHERE id=campaign;
 -- A paid failure remains charged and interruption never reclaims the same field.
 SET LOCAL ROLE service_role;
 retry:=create_public_translation_request(gen_random_uuid(),gen_random_uuid(),token,item,'es',fixture->'source',NULL,NULL,NULL);
 IF retry->>'requestId' IS DISTINCT FROM request::text OR claim_translation_generation_field(field) IS NOT NULL THEN RAISE EXCEPTION 'Completed public replay dispatched again'; END IF;
 RESET ROLE;
 -- One dispatch plus 29 unspent reservations exhaust the public allowance.
 FOR i IN 1..30 LOOP
  fresh_item:=gen_random_uuid();
  INSERT INTO engagement_items(id,campaign_id,body,status,source_type) VALUES(fresh_item,campaign,'SYNTHETIC allowance '||i,'approved','internal');
  SET LOCAL ROLE service_role;
  second:=pg_temp.queue_public_fixture(campaign,fresh_item,token);
  IF i<30 THEN
   PERFORM claim_translation_generation_field((second->>'field')::uuid);
  ELSE
   PERFORM pg_temp.require_public_refusal(format('SELECT claim_translation_generation_field(%L)',second->>'field'),'PT429','public reservations exhausted');
  END IF;
  RESET ROLE;
 END LOOP;
 SELECT count(*) INTO before_claims FROM engagement_translation_generation_fields f JOIN engagement_translation_generation_requests r ON r.id=f.request_id
 WHERE r.workspace_id=workspace AND f.state='reserved';
 IF before_claims<>29 THEN RAISE EXCEPTION 'Public allowance reservation count differs'; END IF;
 -- Staff reservations share the workspace but not its public allowance.
 UPDATE usage_events SET occurred_at=clock_timestamp()-interval '10 minutes' WHERE workspace_id=workspace AND bucket_key='assistant_chat';
 second:=jsonb_build_object('id',bad_field,'address',jsonb_build_object('entityType','campaign','entityId',campaign,'field','title',
 'expectedSource',translation_source_snapshot(campaign,'campaign',campaign,'title'),'expectedTranslation',NULL),
 'packetCanonical',format('{"schemaVersion":1,"workspaceId":%s,"campaignId":%s,"fieldId":%s,"sourceText":%s,"targetLanguage":"es"}',to_json(workspace),to_json(campaign),to_json(bad_field),to_json('SYNTHETIC public queue'::text)));
 SET LOCAL ROLE service_role;
 PERFORM create_translation_generation_request(bad_request,actor,campaign,'es',jsonb_build_array(second),
 jsonb_set(fixture->'credential','{requestId}',to_jsonb(bad_request)),NULL);
 claim:=claim_translation_generation_field(bad_field);
 IF claim->>'state' IS DISTINCT FROM 'reserved' THEN RAISE EXCEPTION 'Public reservations consumed staff allowance'; END IF;
 RESET ROLE;
 PERFORM pg_temp.require_public_refusal(format('UPDATE engagement_public_translation_requests SET locale=%L WHERE request_id=%L','vi',request),'23514','public authority immutable');
 PERFORM pg_temp.require_public_refusal(format('INSERT INTO engagement_translation_generation_requests(id,campaign_id,workspace_id,actor_id,authority_kind,locale,intent,credential) SELECT gen_random_uuid(),campaign_id,workspace_id,%L,%L,locale,intent,credential FROM engagement_translation_generation_requests WHERE id=%L',actor,'public',request),'23514','public request cannot impersonate staff');
 PERFORM pg_temp.require_public_refusal(format('INSERT INTO engagement_translation_generation_requests(id,campaign_id,workspace_id,actor_id,authority_kind,locale,intent,credential) SELECT gen_random_uuid(),campaign_id,workspace_id,NULL,%L,locale,intent,credential FROM engagement_translation_generation_requests WHERE id=%L','staff',request),'23514','staff request requires actor');
 PERFORM pg_temp.require_public_refusal(format('UPDATE engagement_translation_generation_requests SET actor_id=%L WHERE id=%L',actor,request),'23514','public request immutable');
 RAISE NOTICE 'PUBLIC_QUEUE_PROBE_PASSED';
END $probe$;
