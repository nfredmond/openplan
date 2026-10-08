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
 WHERE r.campaign_id='71e5671b-d3df-43aa-ba1c-75dfce09e0d7'
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
  RAISE NOTICE 'verified stage % request %',parent.stage,parent.id;
 END LOOP;
 IF (SELECT count(*) FROM engagement_synthesis_execution_queue)<>3 THEN RAISE EXCEPTION 'Three stage queue records required'; END IF;
END $$;
