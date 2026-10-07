-- Run after the candidate migration inside a rollback-only transaction on the
-- owned synthetic restore target. Existing sources and outputs stay unchanged.
DO $$
DECLARE parent record; original public.engagement_synthesis_generation_authorizations;
 grant_id uuid; queue_id uuid; intent text; command jsonb; bytes text; receipt jsonb; changed jsonb; field text;
BEGIN
 FOR parent IN SELECT DISTINCT ON (stage) r.*, CASE WHEN t.request_id IS NOT NULL THEN 'thematic'
  WHEN c.request_id IS NOT NULL THEN 'context' ELSE 'segment' END AS stage
 FROM engagement_synthesis_generation_requests r
 JOIN engagement_synthesis_generation_authorizations a ON a.request_id=r.id
 LEFT JOIN engagement_synthesis_thematic_requests t ON t.request_id=r.id
 LEFT JOIN engagement_synthesis_context_requests c ON c.request_id=r.id
 WHERE r.id='f0000000-0000-4000-8000-000000000001'
 AND NOT EXISTS(SELECT 1 FROM engagement_synthesis_generation_cancellations x WHERE x.request_id=r.id)
 ORDER BY stage,r.created_at DESC LOOP
  PERFORM set_config('request.jwt.claim.sub',parent.actor_id::text,true);
  SELECT * INTO original FROM engagement_synthesis_generation_authorizations WHERE request_id=parent.id ORDER BY created_at DESC LIMIT 1;
  intent:=(original.intent_text::jsonb||jsonb_build_object('expiresAt',clock_timestamp()+interval '1 hour'))::text;
  grant_id:=gen_random_uuid();queue_id:=gen_random_uuid();
  CASE parent.stage
   WHEN 'segment' THEN PERFORM authorize_engagement_synthesis_generation(parent.id,grant_id,intent);
   WHEN 'context' THEN PERFORM authorize_engagement_synthesis_context(parent.id,grant_id,intent);
   WHEN 'thematic' THEN PERFORM authorize_engagement_synthesis_thematic(parent.id,grant_id,intent);
  END CASE;
  command:=jsonb_build_object('schemaVersion',1,'queueId',queue_id,'authorizationId',grant_id,
   'authorizationIntentSha256',encode(extensions.digest(intent,'sha256'),'hex'),'campaignId',parent.campaign_id,
   'workspaceId',parent.workspace_id,'requestId',parent.id,'actorId',parent.actor_id,'sourceId',parent.source_id,
   'sourceSha256',parent.intent_text::jsonb->>'sourceSha256','requestIntentSha256',parent.intent_sha256,'stage',parent.stage);
  bytes:=command::text;
  FOREACH field IN ARRAY ARRAY['sourceSha256','requestIntentSha256','authorizationIntentSha256'] LOOP
   changed:=command||jsonb_build_object(field,repeat('0',64));
   BEGIN
    PERFORM enqueue_engagement_synthesis_execution(changed::text);
    RAISE EXCEPTION 'Changed hash accepted: %',field;
   EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  END LOOP;
  BEGIN
   PERFORM enqueue_engagement_synthesis_execution((command||jsonb_build_object('stage',CASE WHEN parent.stage='segment' THEN 'context' ELSE 'segment' END))::text);
   RAISE EXCEPTION 'Changed stage accepted';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  BEGIN
   PERFORM enqueue_engagement_synthesis_execution((command||jsonb_build_object('actorId',gen_random_uuid()))::text);
   RAISE EXCEPTION 'Changed actor accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
   PERFORM enqueue_engagement_synthesis_execution((command||jsonb_build_object('workspaceId',gen_random_uuid()))::text);
   RAISE EXCEPTION 'Foreign workspace accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
   PERFORM enqueue_engagement_synthesis_execution((command||jsonb_build_object('sourceId',gen_random_uuid()))::text);
   RAISE EXCEPTION 'Foreign source accepted';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  BEGIN
   PERFORM enqueue_engagement_synthesis_execution((command||jsonb_build_object('campaignId',gen_random_uuid()))::text);
   RAISE EXCEPTION 'Foreign campaign accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  receipt:=enqueue_engagement_synthesis_execution(bytes);
  IF receipt->>'commandText' IS DISTINCT FROM bytes OR receipt->>'queueId' IS DISTINCT FROM queue_id::text
   OR receipt->>'commandSha256' IS DISTINCT FROM encode(extensions.digest(bytes,'sha256'),'hex') THEN
   RAISE EXCEPTION 'Original queue receipt differs';
  END IF;
  IF enqueue_engagement_synthesis_execution(bytes) IS DISTINCT FROM receipt THEN RAISE EXCEPTION 'Exact replay differs'; END IF;
  BEGIN
   PERFORM enqueue_engagement_synthesis_execution((command||jsonb_build_object('queueId',gen_random_uuid()))::text);
   RAISE EXCEPTION 'Duplicate permission queued';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  BEGIN
   PERFORM enqueue_engagement_synthesis_execution(bytes||' ');
   RAISE EXCEPTION 'Changed original bytes accepted';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  BEGIN
   UPDATE engagement_synthesis_execution_queue SET command_text=command_text||' ' WHERE id=queue_id;
   RAISE EXCEPTION 'Queue history update accepted';
  EXCEPTION WHEN raise_exception THEN
   IF SQLERRM<>'Engagement history is immutable' THEN RAISE; END IF;
  END;
  BEGIN
   DELETE FROM engagement_synthesis_execution_queue WHERE id=queue_id;
   RAISE EXCEPTION 'Queue history deletion accepted';
  EXCEPTION WHEN raise_exception THEN
   IF SQLERRM<>'Engagement history is immutable' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'verified stage % request %',parent.stage,parent.id;
 END LOOP;
 IF (SELECT count(*) FROM engagement_synthesis_execution_queue)<>1 THEN RAISE EXCEPTION 'One fixture queue record required'; END IF;
END $$;

-- Follow native-probe.sql in the same rollback-only synthetic transaction.
DO $$
DECLARE queued public.engagement_synthesis_execution_queue; request public.engagement_synthesis_generation_requests;
 permission public.engagement_synthesis_generation_authorizations; command jsonb; receipt jsonb;
 fresh_id uuid; fresh_intent text; fresh_command jsonb; role_name text;
 expired_command jsonb; expiring_receipt jsonb; expiring_bytes text;
 credential public.workspace_provider_api_credentials;
BEGIN
 FOR queued IN SELECT * FROM engagement_synthesis_execution_queue ORDER BY stage LOOP
  SELECT * INTO request FROM engagement_synthesis_generation_requests WHERE id=queued.request_id;
  SELECT * INTO permission FROM engagement_synthesis_generation_authorizations WHERE id=queued.authorization_id;
  command:=queued.command_text::jsonb;
  PERFORM set_config('request.jwt.claim.sub',request.actor_id::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  receipt:=enqueue_engagement_synthesis_execution(queued.command_text);
  IF read_engagement_synthesis_execution_queue(request.campaign_id,request.id,queued.authorization_id)->'receipt' IS DISTINCT FROM receipt THEN
   RAISE EXCEPTION 'Lookup receipt differs';
  END IF;
  BEGIN
   PERFORM read_engagement_synthesis_execution_queue(request.campaign_id,request.id,gen_random_uuid());
   RAISE EXCEPTION 'Unknown permission lookup allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF receipt->>'queueId' IS DISTINCT FROM queued.id::text THEN RAISE EXCEPTION 'Authenticated replay failed'; END IF;
  BEGIN
   PERFORM 1 FROM engagement_synthesis_execution_queue;
   RAISE EXCEPTION 'Authenticated direct read allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
   UPDATE engagement_synthesis_execution_queue SET stage='segment';
   RAISE EXCEPTION 'Authenticated direct update allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  BEGIN
   PERFORM enqueue_engagement_synthesis_execution(queued.command_text);
   RAISE EXCEPTION 'Foreign actor replay allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
   PERFORM read_engagement_synthesis_execution_queue(request.campaign_id,request.id,queued.authorization_id);
   RAISE EXCEPTION 'Foreign actor lookup allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub',request.actor_id::text,true);
  EXECUTE 'RESET ROLE';
  FOREACH role_name IN ARRAY ARRAY['anon','service_role'] LOOP
   EXECUTE format('SET LOCAL ROLE %I',role_name);
   BEGIN
    PERFORM enqueue_engagement_synthesis_execution(queued.command_text);
    RAISE EXCEPTION 'Nonstaff execute allowed for %',role_name;
   EXCEPTION WHEN insufficient_privilege THEN NULL; END;
   BEGIN
    PERFORM read_engagement_synthesis_execution_queue(request.campaign_id,request.id,queued.authorization_id);
    RAISE EXCEPTION 'Nonstaff lookup allowed';
   EXCEPTION WHEN insufficient_privilege THEN NULL; END;
   EXECUTE 'RESET ROLE';
  END LOOP;
  -- Fresh authenticated scheduling, not only a replay as database owner.
  fresh_id:=gen_random_uuid();fresh_intent:=permission.intent_text;
  EXECUTE 'SET LOCAL ROLE authenticated';
  CASE queued.stage
   WHEN 'segment' THEN PERFORM authorize_engagement_synthesis_generation(request.id,fresh_id,fresh_intent);
   WHEN 'context' THEN PERFORM authorize_engagement_synthesis_context(request.id,fresh_id,fresh_intent);
   WHEN 'thematic' THEN PERFORM authorize_engagement_synthesis_thematic(request.id,fresh_id,fresh_intent);
  END CASE;
  fresh_command:=command||jsonb_build_object('queueId',gen_random_uuid(),'authorizationId',fresh_id);
  IF read_engagement_synthesis_execution_queue(request.campaign_id,request.id,fresh_id)->'receipt' IS DISTINCT FROM 'null'::jsonb THEN
   RAISE EXCEPTION 'Unused permission has queue receipt';
  END IF;
  PERFORM enqueue_engagement_synthesis_execution(fresh_command::text);
  -- Rotation does not alter old receipts, but invalidates an unused allowance.
  fresh_id:=gen_random_uuid();
  CASE queued.stage
   WHEN 'segment' THEN PERFORM authorize_engagement_synthesis_generation(request.id,fresh_id,fresh_intent);
   WHEN 'context' THEN PERFORM authorize_engagement_synthesis_context(request.id,fresh_id,fresh_intent);
   WHEN 'thematic' THEN PERFORM authorize_engagement_synthesis_thematic(request.id,fresh_id,fresh_intent);
  END CASE;
  fresh_command:=command||jsonb_build_object('queueId',gen_random_uuid(),'authorizationId',fresh_id);
  EXECUTE 'RESET ROLE';
  SELECT * INTO STRICT credential FROM workspace_provider_api_credentials WHERE revision_id=request.configuration_revision_id;
  DELETE FROM workspace_provider_api_credentials WHERE revision_id=credential.revision_id;
  INSERT INTO workspace_provider_api_credentials(revision_id,connection_id,workspace_id,credential_ciphertext)
   VALUES(credential.revision_id,credential.connection_id,credential.workspace_id,'v2:SYNTHETIC queue rotation');
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF enqueue_engagement_synthesis_execution(queued.command_text) IS DISTINCT FROM receipt THEN
   RAISE EXCEPTION 'Credential rotation changed original receipt';
  END IF;
  BEGIN
   PERFORM enqueue_engagement_synthesis_execution(fresh_command::text);
   RAISE EXCEPTION 'Changed credential queue accepted';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  EXECUTE 'RESET ROLE';
  DELETE FROM workspace_provider_api_credentials WHERE revision_id=credential.revision_id;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
   PERFORM enqueue_engagement_synthesis_execution(fresh_command::text);
   RAISE EXCEPTION 'Missing credential queue accepted';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  EXECUTE 'RESET ROLE';
  INSERT INTO workspace_provider_api_credentials(revision_id,connection_id,workspace_id,credential_ciphertext)
   VALUES(credential.revision_id,credential.connection_id,credential.workspace_id,credential.credential_ciphertext);
  EXECUTE 'SET LOCAL ROLE authenticated';
  -- Let real time expire two newly authorized grants. Never alter old history.
  fresh_intent:=(permission.intent_text::jsonb||jsonb_build_object('expiresAt',clock_timestamp()+interval '250 milliseconds'))::text;
  FOR n IN 1..2 LOOP
   fresh_id:=gen_random_uuid();
   CASE queued.stage
    WHEN 'segment' THEN PERFORM authorize_engagement_synthesis_generation(request.id,fresh_id,fresh_intent);
    WHEN 'context' THEN PERFORM authorize_engagement_synthesis_context(request.id,fresh_id,fresh_intent);
    WHEN 'thematic' THEN PERFORM authorize_engagement_synthesis_thematic(request.id,fresh_id,fresh_intent);
   END CASE;
   expired_command:=command||jsonb_build_object('queueId',gen_random_uuid(),'authorizationId',fresh_id,
    'authorizationIntentSha256',encode(extensions.digest(fresh_intent,'sha256'),'hex'));
   IF n=1 THEN
    expiring_bytes:=expired_command::text;
    expiring_receipt:=enqueue_engagement_synthesis_execution(expiring_bytes);
   END IF;
  END LOOP;
  PERFORM pg_sleep(0.3);
  IF enqueue_engagement_synthesis_execution(expiring_bytes) IS DISTINCT FROM expiring_receipt THEN
   RAISE EXCEPTION 'Expiry changed original receipt';
  END IF;
  BEGIN
   PERFORM enqueue_engagement_synthesis_execution(expired_command::text);
   RAISE EXCEPTION 'Expired new queue accepted';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  fresh_intent:=permission.intent_text;
  -- Another untouched allowance tests cancellation independently of duplicates.
  fresh_id:=gen_random_uuid();
  CASE queued.stage
   WHEN 'segment' THEN PERFORM authorize_engagement_synthesis_generation(request.id,fresh_id,fresh_intent);
   WHEN 'context' THEN PERFORM authorize_engagement_synthesis_context(request.id,fresh_id,fresh_intent);
   WHEN 'thematic' THEN PERFORM authorize_engagement_synthesis_thematic(request.id,fresh_id,fresh_intent);
  END CASE;
  fresh_command:=command||jsonb_build_object('queueId',gen_random_uuid(),'authorizationId',fresh_id);
  PERFORM cancel_engagement_synthesis_generation_request(request.campaign_id,request.id,gen_random_uuid(),'SYNTHETIC rollback-only execution queue verification');
  IF enqueue_engagement_synthesis_execution(queued.command_text) IS DISTINCT FROM receipt THEN
   RAISE EXCEPTION 'Cancellation changed original receipt';
  END IF;
  BEGIN
   PERFORM enqueue_engagement_synthesis_execution(fresh_command::text);
   RAISE EXCEPTION 'Cancelled new queue accepted';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  EXECUTE 'RESET ROLE';
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF read_engagement_synthesis_execution_queue(request.campaign_id,request.id,queued.authorization_id)->'receipt' IS DISTINCT FROM receipt THEN
   RAISE EXCEPTION 'Cancelled lookup receipt differs';
  END IF;
  EXECUTE 'RESET ROLE';
  RAISE NOTICE 'authenticated role and cancellation verified for %',queued.stage;
 END LOOP;
END $$;

SELECT 'synthesis-execution-queue-verified';
