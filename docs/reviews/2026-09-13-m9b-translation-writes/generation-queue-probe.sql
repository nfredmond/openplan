CREATE FUNCTION pg_temp.require_queue_refusal(statement text,expected text,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE=expected THEN RETURN; END IF;
  RAISE EXCEPTION 'Refusal % expected %, got %: %',label,expected,SQLSTATE,SQLERRM;
 END;
 RAISE EXCEPTION 'Guard failed: %',label;
END $$;
CREATE FUNCTION pg_temp.require_private_queue_hidden(statement text,label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE visible bigint;
BEGIN
 BEGIN EXECUTE statement INTO visible;
 EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
 IF visible<>0 THEN RAISE EXCEPTION 'Private queue leak: %',label; END IF;
END $$;
DO $probe$
DECLARE
 fixture jsonb:=current_setting('openplan.queue_fixture')::jsonb;
 workspace uuid:=(fixture->>'workspaceId')::uuid; campaign uuid:=(fixture->>'campaignId')::uuid;
 actor uuid:=(fixture->>'actorId')::uuid; viewer uuid:=(fixture->>'viewerId')::uuid; outsider uuid:=(fixture->>'outsiderId')::uuid;
 request uuid:=(fixture->>'requestId')::uuid; first_field uuid:=(fixture#>>'{fields,0,id}')::uuid;
 second_field uuid:=(fixture#>>'{fields,1,id}')::uuid; other uuid:=gen_random_uuid(); stale uuid:=gen_random_uuid();
 fields jsonb:=fixture->'fields'; credential jsonb:=fixture->'credential'; key_hash text:=fixture->>'selectedKeyHash';
 call_sql text; result jsonb; original_claim jsonb; second_claim jsonb; replay jsonb; envelope jsonb; expired_id uuid:=gen_random_uuid();
BEGIN
 INSERT INTO auth.users(id,aud,role,email) SELECT id,'authenticated','authenticated',id::text||'@queue-probe.invalid' FROM unnest(ARRAY[actor,viewer,outsider]) id;
 INSERT INTO workspaces(id,name,slug) VALUES(workspace,'SYNTHETIC generation queue',workspace::text);
 INSERT INTO workspace_members(workspace_id,user_id,role) VALUES(workspace,actor,'owner'),(workspace,viewer,'viewer');
 INSERT INTO engagement_campaigns(id,workspace_id,title,summary,created_by,default_content_locale)
 VALUES(campaign,workspace,fixture->>'source',fixture->>'source',actor,NULL);
 INSERT INTO workspace_integration_keys(workspace_id,provider,key_ciphertext,key_last4,configured_by)
 VALUES(workspace,'anthropic',fixture->>'keyCiphertext','-KEY',actor);
 call_sql:=format('SELECT create_translation_generation_request(%L,%L,%L,%L,%L,%L,%L)',request,actor,campaign,'es',fields,credential,key_hash);
 SET LOCAL ROLE anon;
 PERFORM pg_temp.require_queue_refusal(call_sql,'42501','anonymous queue command');
 SET LOCAL ROLE authenticated;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM pg_temp.require_queue_refusal(call_sql,'42501','authenticated direct queue command');
 SET LOCAL ROLE service_role;
 PERFORM pg_temp.require_queue_refusal(format('SELECT create_translation_generation_request(%L,%L,%L,%L,%L,%L,%L)',request,viewer,campaign,'es',fields,credential,key_hash),'42501','viewer queue');
 PERFORM pg_temp.require_queue_refusal(format('SELECT create_translation_generation_request(%L,%L,%L,%L,%L,%L,%L)',request,outsider,campaign,'es',fields,credential,key_hash),'42501','outsider queue');
 PERFORM pg_temp.require_queue_refusal(format('SELECT create_translation_generation_request(%L,%L,%L,%L,%L,%L,%L)',request,actor,campaign,'es',fields,credential,repeat('0',64)),'PT409','changed key before queue');
 envelope:=fields||jsonb_build_array(jsonb_set(jsonb_set(fields->0,'{id}',to_jsonb(other)),'{packetCanonical}',to_jsonb(replace(fields#>>'{0,packetCanonical}',first_field::text,other::text))));
 PERFORM pg_temp.require_queue_refusal(format('SELECT create_translation_generation_request(%L,%L,%L,%L,%L,%L,%L)',request,actor,campaign,'es',envelope,credential,key_hash),'22023','duplicate addresses with distinct field identities');
 PERFORM pg_temp.require_queue_refusal(format('SELECT create_translation_generation_request(%L,%L,%L,%L,%L,%L,%L)',request,actor,campaign,'es',fields,jsonb_set(credential,'{workspaceId}',to_jsonb(gen_random_uuid())),key_hash),'22023','foreign credential workspace');
 PERFORM pg_temp.require_queue_refusal(format('SELECT create_translation_generation_request(%L,%L,%L,%L,%L,%L,%L)',request,actor,campaign,'es',
  jsonb_set(fields,'{0,packetCanonical}',to_jsonb(replace(fields#>>'{0,packetCanonical}','Keep the final words.','FORGED words.'))),credential,key_hash),'22023','packet differs from source');
 IF EXISTS(SELECT 1 FROM engagement_translation_generation_requests WHERE id=request) THEN RAISE EXCEPTION 'Whole request rollback failed'; END IF;
 result:=create_translation_generation_request(request,actor,campaign,'es',fields,credential,key_hash);
 IF result IS DISTINCT FROM jsonb_build_object('requestId',request,'created',true) THEN RAISE EXCEPTION 'Positive queue creation failed'; END IF;
 IF (SELECT count(*) FROM engagement_translation_generation_fields WHERE request_id=request)<>2
 OR (SELECT intent->'fields' FROM engagement_translation_generation_requests WHERE id=request) IS DISTINCT FROM fields
 OR (SELECT packet_canonical FROM engagement_translation_generation_fields WHERE id=first_field) IS DISTINCT FROM fields#>>'{0,packetCanonical}'
 OR EXISTS(SELECT 1 FROM usage_events WHERE workspace_id=workspace) THEN RAISE EXCEPTION 'Queue source custody or unspent state failed'; END IF;
 SET LOCAL ROLE anon;
 PERFORM pg_temp.require_private_queue_hidden(format('SELECT count(*) FROM engagement_translation_generation_requests WHERE id=%L',request),'anonymous request');
 PERFORM pg_temp.require_private_queue_hidden(format('SELECT count(*) FROM engagement_translation_generation_fields WHERE request_id=%L',request),'anonymous fields');
 SET LOCAL ROLE authenticated;
 PERFORM pg_temp.require_private_queue_hidden(format('SELECT count(*) FROM engagement_translation_generation_requests WHERE id=%L',request),'authenticated request');
 PERFORM pg_temp.require_private_queue_hidden(format('SELECT count(*) FROM engagement_translation_generation_fields WHERE request_id=%L',request),'authenticated fields');
 SET LOCAL ROLE service_role;
 -- Retry does not reseal/reselect a credential or rerun source checks.
 RESET ROLE;
 UPDATE engagement_campaigns SET title='SYNTHETIC changed source' WHERE id=campaign;
 SET LOCAL ROLE service_role;
 replay:=create_translation_generation_request(request,actor,campaign,'es',fields,NULL,NULL);
 IF replay IS DISTINCT FROM jsonb_build_object('requestId',request,'created',false) THEN RAISE EXCEPTION 'Exact queue replay failed'; END IF;
 PERFORM pg_temp.require_queue_refusal(format('SELECT create_translation_generation_request(%L,%L,%L,%L,%L,NULL,NULL)',request,actor,campaign,'vi',fields),'PT409','changed request retry');
 PERFORM pg_temp.require_queue_refusal(format('SELECT create_translation_generation_request(%L,%L,%L,%L,%L,NULL,NULL)',request,viewer,campaign,'es',fields),'42501','viewer receipt replay');
 PERFORM pg_temp.require_queue_refusal(format('SELECT claim_translation_generation_field(%L)',first_field),'PT409','source changed before claim');
 RESET ROLE;
 UPDATE engagement_campaigns SET title=fixture->>'source' WHERE id=campaign;
 INSERT INTO engagement_content_translations(id,workspace_id,campaign_id,entity_type,entity_id,field,locale,translated_text,source,created_by)
 VALUES(stale,workspace,campaign,'campaign',campaign,'title','es','SYNTHETIC newer saved wording','operator',actor);
 SET LOCAL ROLE service_role;
 PERFORM pg_temp.require_queue_refusal(format('SELECT claim_translation_generation_field(%L)',first_field),'PT409','translation version changed before claim');
 RESET ROLE;
 DELETE FROM engagement_content_translations WHERE id=stale;
 SET LOCAL ROLE service_role;
 original_claim:=claim_translation_generation_field(first_field);
 IF original_claim->>'state' IS DISTINCT FROM 'reserved' OR original_claim->>'attempt_id' IS NULL OR original_claim->>'reservation_id' IS NULL
 OR EXISTS(SELECT 1 FROM usage_events WHERE workspace_id=workspace) THEN RAISE EXCEPTION 'Claim reservation is not an actual dispatch'; END IF;
 IF claim_translation_generation_field(first_field) IS NOT NULL THEN RAISE EXCEPTION 'A reserved field was claimed twice'; END IF;
 PERFORM pg_temp.require_queue_refusal(format('SELECT authorize_translation_generation_dispatch(%L,%L,%L)',first_field,gen_random_uuid(),original_claim->>'reservation_id'),'42501','wrong attempt');
 RESET ROLE;
 UPDATE engagement_campaigns SET title='SYNTHETIC changed source' WHERE id=campaign;
 SET LOCAL ROLE service_role;
 PERFORM pg_temp.require_queue_refusal(format('SELECT authorize_translation_generation_dispatch(%L,%L,%L)',first_field,original_claim->>'attempt_id',original_claim->>'reservation_id'),'PT409','source changed before dispatch');
 RESET ROLE;
 UPDATE engagement_campaigns SET title=fixture->>'source' WHERE id=campaign;
 UPDATE workspace_integration_keys SET key_ciphertext='SYNTHETIC replaced encrypted key' WHERE workspace_id=workspace AND provider='anthropic';
 SET LOCAL ROLE service_role;
 PERFORM pg_temp.require_queue_refusal(format('SELECT authorize_translation_generation_dispatch(%L,%L,%L)',first_field,original_claim->>'attempt_id',original_claim->>'reservation_id'),'PT409','key changed before dispatch');
 RESET ROLE;
 UPDATE workspace_integration_keys SET key_ciphertext=fixture->>'keyCiphertext' WHERE workspace_id=workspace AND provider='anthropic';
 -- Keep a second owner while testing loss of the requesting actor's role.
 UPDATE workspace_members SET role='owner' WHERE workspace_id=workspace AND user_id=viewer;
 UPDATE workspace_members SET role='viewer' WHERE workspace_id=workspace AND user_id=actor;
 SET LOCAL ROLE service_role;
 PERFORM pg_temp.require_queue_refusal(format('SELECT authorize_translation_generation_dispatch(%L,%L,%L)',first_field,original_claim->>'attempt_id',original_claim->>'reservation_id'),'42501','access lost before dispatch');
 RESET ROLE;
 UPDATE workspace_members SET role='owner' WHERE workspace_id=workspace AND user_id=actor;
 UPDATE workspace_members SET role='viewer' WHERE workspace_id=workspace AND user_id=viewer;
 SET LOCAL ROLE service_role;
 result:=authorize_translation_generation_dispatch(first_field,(original_claim->>'attempt_id')::uuid,(original_claim->>'reservation_id')::uuid);
 replay:=authorize_translation_generation_dispatch(first_field,(original_claim->>'attempt_id')::uuid,(original_claim->>'reservation_id')::uuid);
 IF result IS DISTINCT FROM replay OR result->>'state' IS DISTINCT FROM 'running'
 OR (SELECT count(*) FROM usage_events WHERE workspace_id=workspace)<>1
 OR NOT EXISTS(SELECT 1 FROM usage_events WHERE workspace_id=workspace AND metadata_json->>'dispatchReservation'='true') THEN
  RAISE EXCEPTION 'Dispatch retry or conservative usage evidence failed';
 END IF;
 IF claim_translation_generation_field(first_field) IS NOT NULL THEN RAISE EXCEPTION 'Running attempt was reclaimed'; END IF;
 PERFORM pg_temp.require_queue_refusal(format('UPDATE engagement_translation_generation_fields SET state=%L WHERE id=%L','queued',first_field),'42501','service direct field write');
 RESET ROLE;
 PERFORM pg_temp.require_queue_refusal(format('UPDATE engagement_translation_generation_requests SET locale=%L WHERE id=%L','vi',request),'23514','request immutable');
 PERFORM pg_temp.require_queue_refusal(format('UPDATE engagement_translation_generation_fields SET packet_canonical=%L WHERE id=%L','{}',first_field),'23514','packet immutable');
 PERFORM pg_temp.require_queue_refusal(format('UPDATE engagement_translation_generation_fields SET attempt_id=%L WHERE id=%L',gen_random_uuid(),first_field),'23514','attempt immutable');
 PERFORM pg_temp.require_queue_refusal(format('UPDATE engagement_translation_generation_fields SET state=%L WHERE id=%L','queued',first_field),'23514','never requeue');
 -- A retained expired reservation represents an earlier worker whose lease ended.
 INSERT INTO engagement_translation_generation_fields(id,request_id,ordinal,address,packet_canonical,state,attempt_id,reservation_id,reserved_at,lease_expires_at)
 VALUES(expired_id,request,3,fields#>'{0,address}',replace(fields#>>'{0,packetCanonical}',first_field::text,expired_id::text),'reserved',gen_random_uuid(),gen_random_uuid(),clock_timestamp()-interval '4 minutes',clock_timestamp()-interval '1 minute');
 SET LOCAL ROLE service_role;
 result:=claim_translation_generation_field(expired_id);
 IF result IS NOT NULL OR (SELECT state FROM engagement_translation_generation_fields WHERE id=expired_id)<>'interrupted' THEN
  RAISE EXCEPTION 'Expired reservation was reclaimed';
 END IF;
 IF (SELECT count(*) FROM usage_events WHERE workspace_id=workspace)<>1 THEN RAISE EXCEPTION 'Expiry created a dispatch event'; END IF;
 RESET ROLE;
 -- Public events never consume the staff allowance.
 INSERT INTO usage_events(workspace_id,event_key,bucket_key,weight,idempotency_key,metadata_json)
 SELECT workspace,n::text,'engagement_public_translation',1,'public:'||workspace::text||':'||n,'{}'::jsonb FROM generate_series(1,30) n;
 SET LOCAL ROLE service_role;
 second_claim:=claim_translation_generation_field(second_field);
 IF second_claim->>'state' IS DISTINCT FROM 'reserved' THEN RAISE EXCEPTION 'Public traffic consumed staff allowance'; END IF;
 RESET ROLE;
 -- A fresh unclaimed field is blocked by nineteen dispatched staff events and
 -- one live reservation. It remains queued, with no attempted generation.
 INSERT INTO engagement_translation_generation_fields(id,request_id,ordinal,address,packet_canonical)
 VALUES(other,request,4,fields#>'{1,address}',replace(fields#>>'{1,packetCanonical}',second_field::text,other::text));
 INSERT INTO usage_events(workspace_id,event_key,bucket_key,weight,idempotency_key,metadata_json)
 SELECT workspace,n::text,'assistant_chat',1,'staff:'||workspace::text||':'||n,'{}'::jsonb FROM generate_series(1,18) n;
 SET LOCAL ROLE service_role;
 PERFORM pg_temp.require_queue_refusal(format('SELECT claim_translation_generation_field(%L)',other),'PT429','reserved staff allowance');
 IF (SELECT state FROM engagement_translation_generation_fields WHERE id=other)<>'queued' THEN RAISE EXCEPTION 'Rate refusal consumed an attempt'; END IF;
 RESET ROLE;
 INSERT INTO usage_events(workspace_id,event_key,bucket_key,weight,idempotency_key,metadata_json)
 VALUES(workspace,'last-staff-slot','assistant_chat',1,'last-staff-slot:'||workspace::text,'{}'::jsonb);
 SET LOCAL ROLE service_role;
 PERFORM pg_temp.require_queue_refusal(format('SELECT authorize_translation_generation_dispatch(%L,%L,%L)',second_field,second_claim->>'attempt_id',second_claim->>'reservation_id'),'PT429','allowance consumed after reservation');
 IF (SELECT state FROM engagement_translation_generation_fields WHERE id=second_field)<>'reserved' THEN RAISE EXCEPTION 'Late rate refusal authorized dispatch'; END IF;
 RESET ROLE;
 SET LOCAL ROLE service_role;
 result:=stop_translation_generation_field(other,NULL,'failed','translation_credential_unavailable');
 IF result->>'state' IS DISTINCT FROM 'failed' OR result->>'attemptId' IS NOT NULL THEN RAISE EXCEPTION 'Unclaimed failure invented an attempt'; END IF;
 IF result IS DISTINCT FROM stop_translation_generation_field(other,NULL,'failed','translation_credential_unavailable') THEN RAISE EXCEPTION 'Failure replay changed'; END IF;
 PERFORM pg_temp.require_queue_refusal(format('SELECT stop_translation_generation_field(%L,NULL,%L,%L)',other,'cancelled','translation_cancelled'),'PT409','different failure replay');
 IF claim_translation_generation_field(other) IS NOT NULL THEN RAISE EXCEPTION 'Failed field was reclaimed'; END IF;
 RESET ROLE;
 UPDATE workspace_integration_keys SET key_ciphertext='SYNTHETIC invalidated running credential' WHERE workspace_id=workspace AND provider='anthropic';
 SET LOCAL ROLE service_role;
 result:=read_translation_generation_status(first_field,(original_claim->>'attempt_id')::uuid);
 IF result IS DISTINCT FROM jsonb_build_object('fieldId',first_field,'attemptId',original_claim->>'attempt_id','state','interrupted',
  'failureCode','translation_source_or_key_changed','leaseExpiresAt',original_claim->'lease_expires_at') THEN RAISE EXCEPTION 'Changed-key status or minimal disclosure failed'; END IF;
 PERFORM pg_temp.require_queue_refusal(format('SELECT read_translation_generation_status(%L,%L)',first_field,gen_random_uuid()),'42501','wrong status attempt');
 RESET ROLE;
 UPDATE workspace_integration_keys SET key_ciphertext=fixture->>'keyCiphertext' WHERE workspace_id=workspace AND provider='anthropic';
 SET LOCAL ROLE service_role;
 IF claim_translation_generation_field(first_field) IS NOT NULL THEN RAISE EXCEPTION 'Interrupted field was reclaimed'; END IF;
 IF (SELECT count(*) FROM usage_events WHERE workspace_id=workspace AND bucket_key='engagement_content_translation')<>1 THEN RAISE EXCEPTION 'Terminal handling changed dispatch counts'; END IF;
 RESET ROLE;
 PERFORM pg_temp.require_queue_refusal(format('UPDATE engagement_translation_generation_fields SET failure_code=%L WHERE id=%L','rewritten',first_field),'23514','terminal outcome immutable');
 PERFORM set_config('openplan.queue_probe_passed','true',true);
END $probe$;
SELECT jsonb_build_object('queueProbePassed',current_setting('openplan.queue_probe_passed')='true');
