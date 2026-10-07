-- Follow native-probe.sql in the same rollback-only synthetic transaction.
DO $$
DECLARE queued public.engagement_synthesis_execution_queue; request public.engagement_synthesis_generation_requests;
 permission public.engagement_synthesis_generation_authorizations; command jsonb; receipt jsonb;
 fresh_id uuid; fresh_intent text; fresh_command jsonb; role_name text;
 expired_command jsonb; expiring_receipt jsonb; expiring_bytes text;
BEGIN
 FOR queued IN SELECT * FROM engagement_synthesis_execution_queue ORDER BY stage LOOP
  SELECT * INTO request FROM engagement_synthesis_generation_requests WHERE id=queued.request_id;
  SELECT * INTO permission FROM engagement_synthesis_generation_authorizations WHERE id=queued.authorization_id;
  command:=queued.command_text::jsonb;
  PERFORM set_config('request.jwt.claim.sub',request.actor_id::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  receipt:=enqueue_engagement_synthesis_execution(queued.command_text);
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
  PERFORM set_config('request.jwt.claim.sub',request.actor_id::text,true);
  EXECUTE 'RESET ROLE';
  FOREACH role_name IN ARRAY ARRAY['anon','service_role'] LOOP
   EXECUTE format('SET LOCAL ROLE %I',role_name);
   BEGIN
    PERFORM enqueue_engagement_synthesis_execution(queued.command_text);
    RAISE EXCEPTION 'Nonstaff execute allowed for %',role_name;
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
  PERFORM enqueue_engagement_synthesis_execution(fresh_command::text);
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
  RAISE NOTICE 'authenticated role and cancellation verified for %',queued.stage;
 END LOOP;
END $$;
