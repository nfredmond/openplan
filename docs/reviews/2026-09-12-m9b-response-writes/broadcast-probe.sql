-- All recipients and states below are synthetic. No transport is called.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','4a21e42f-27a7-474d-9a7a-5912c70af359',true);
SELECT public.write_engagement_response('b76fe95e-3a5e-4791-a232-dd65d85b8a57',
  'ba000000-0000-4000-8000-000000000001','create',NULL,NULL,NULL,
  '{"theme_title":"SYNTHETIC durable broadcast","you_said":"Reviewed source","we_did":"Reviewed answer","status":"published"}');
SELECT public.write_engagement_response('b76fe95e-3a5e-4791-a232-dd65d85b8a57',
  'ba000000-0000-4000-8000-000000000001','create',NULL,NULL,NULL,
  '{"theme_title":"SYNTHETIC durable broadcast","you_said":"Reviewed source","we_did":"Reviewed answer","status":"published"}');
DO $$
DECLARE refused boolean := false; report jsonb;
BEGIN
  report=public.read_engagement_response_broadcast('b76fe95e-3a5e-4791-a232-dd65d85b8a57','ba000000-0000-4000-8000-000000000001');
  IF report IS NULL OR report->>'state' IS DISTINCT FROM 'queued' OR report->'preparedCount'<>'null'::jsonb THEN
    RAISE EXCEPTION 'An unprepared broadcast claimed a known audience';
  END IF;
  BEGIN
    PERFORM public.prepare_engagement_response_broadcast('http://localhost:3256');
  EXCEPTION WHEN insufficient_privilege THEN refused=true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'Staff caller prepared sensitive delivery messages'; END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF (SELECT count(*) FROM engagement_response_broadcasts WHERE request_id='ba000000-0000-4000-8000-000000000001')<>1
    OR (SELECT count(*) FROM engagement_notifications WHERE payload_json->>'requestId'='ba000000-0000-4000-8000-000000000001')<>1 THEN
    RAISE EXCEPTION 'Identical publication replay duplicated its queue or inbox notification';
  END IF;
END $$;
-- Create >1000 recipients to exceed the REST default. Existing confirmed fixture
-- subscriptions are counted as well; nothing is deleted or silently omitted.
INSERT INTO engagement_subscriptions(campaign_id,email,confirmed,confirm_token,unsubscribe_token)
SELECT 'b76fe95e-3a5e-4791-a232-dd65d85b8a57','broadcast-probe-'||n||'@example.invalid',true,
  gen_random_uuid()::text,gen_random_uuid()::text FROM generate_series(1,1005) n;
CREATE FUNCTION public.probe_response_email_persistence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('openplan.probe_fail_outbox',true)='yes' AND NEW.to_email='broadcast-probe-500@example.invalid' THEN
    RAISE EXCEPTION 'SYNTHETIC outbox persistence failure';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER probe_response_email_persistence BEFORE INSERT ON engagement_email_outbox
  FOR EACH ROW EXECUTE FUNCTION public.probe_response_email_persistence();
DO $$
DECLARE refused boolean := false;
BEGIN
  PERFORM set_config('openplan.probe_fail_outbox','yes',true);
  BEGIN
    PERFORM public.prepare_engagement_response_broadcast('http://localhost:3256');
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'SYNTHETIC outbox persistence failure' THEN RAISE; END IF;
    refused=true;
  END;
  PERFORM set_config('openplan.probe_fail_outbox','no',true);
  IF NOT refused THEN RAISE EXCEPTION 'An outbox failure was disguised as a prepared broadcast'; END IF;
  IF NOT EXISTS(SELECT 1 FROM engagement_response_broadcasts WHERE request_id='ba000000-0000-4000-8000-000000000001'
    AND state='queued' AND prepared_count IS NULL) OR EXISTS(SELECT 1 FROM engagement_email_outbox
      WHERE payload_json->>'responseRequestId'='ba000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'Failed preparation left a partial audience or lost its queued intent';
  END IF;
END $$;
SET LOCAL ROLE service_role;
SELECT public.prepare_engagement_response_broadcast('http://localhost:3256');
RESET ROLE;
DO $$
DECLARE total bigint; job engagement_response_broadcasts%ROWTYPE; message engagement_response_broadcast_messages%ROWTYPE;
  claim jsonb; attempt uuid := gen_random_uuid(); refused boolean := false;
BEGIN
  SELECT * INTO STRICT job FROM engagement_response_broadcasts WHERE request_id='ba000000-0000-4000-8000-000000000001';
  SELECT count(*) INTO total FROM engagement_subscriptions WHERE campaign_id=job.campaign_id AND confirmed AND unsubscribed_at IS NULL;
  IF job.state<>'prepared' OR job.prepared_count<>total OR total<1005
    OR (SELECT count(*) FROM engagement_response_broadcast_messages WHERE request_id=job.request_id)<>total THEN
    RAISE EXCEPTION 'Broadcast preparation lost confirmed subscribers';
  END IF;
  IF EXISTS(SELECT 1 FROM engagement_response_broadcast_messages m JOIN engagement_email_outbox o ON o.id=m.outbox_id
    JOIN engagement_subscriptions s ON s.id=m.subscription_id WHERE m.request_id=job.request_id AND (
      o.body NOT LIKE '%'||'/api/engage/'||job.share_token||'/subscribe/unsubscribe?token='||s.unsubscribe_token
      OR o.body NOT LIKE '%Reviewed answer%' OR o.status<>'queued')) THEN
    RAISE EXCEPTION 'Retained messages lost their response or per-recipient opt-out';
  END IF;
  claim=public.claim_engagement_response_email(attempt);
  IF claim IS NULL OR claim->>'state'<>'attempting' OR claim->>'attemptToken'<>attempt::text OR NOT EXISTS(
    SELECT 1 FROM engagement_email_outbox o JOIN engagement_response_broadcast_messages m ON m.outbox_id=o.id
      WHERE o.id=(claim->>'outboxId')::uuid AND m.attempt_token=attempt AND m.state='attempting') THEN
    RAISE EXCEPTION 'Transport claim did not retain an outbox row and attempt first';
  END IF;
  IF encode(extensions.digest(claim->>'messageText','sha256'),'hex')<>claim->>'contentSha256' THEN
    RAISE EXCEPTION 'Transport claim did not match the retained message checksum';
  END IF;
  BEGIN
    PERFORM public.finish_engagement_response_email((claim->>'outboxId')::uuid,gen_random_uuid(),'accepted','synthetic',NULL);
  EXCEPTION WHEN insufficient_privilege THEN refused=true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'A foreign attempt could finalize delivery'; END IF;
  PERFORM public.finish_engagement_response_email((claim->>'outboxId')::uuid,attempt,'accepted','synthetic',NULL);
  PERFORM public.finish_engagement_response_email((claim->>'outboxId')::uuid,attempt,'accepted','synthetic',NULL);
  refused=false;
  BEGIN
    PERFORM public.finish_engagement_response_email((claim->>'outboxId')::uuid,attempt,'failed','synthetic','Changed outcome');
  EXCEPTION WHEN unique_violation THEN refused=true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'Completed delivery outcome was replaced'; END IF;
  -- An interrupted attempt becomes uncertain and is not the next claim.
  attempt=gen_random_uuid(); claim=public.claim_engagement_response_email(attempt);
  UPDATE engagement_response_broadcast_messages SET started_at=clock_timestamp()-interval '3 minutes'
    WHERE outbox_id=(claim->>'outboxId')::uuid;
  PERFORM public.claim_engagement_response_email(gen_random_uuid());
  IF NOT EXISTS(SELECT 1 FROM engagement_response_broadcast_messages WHERE outbox_id=(claim->>'outboxId')::uuid
    AND state='uncertain' AND attempt_token=attempt) THEN
    RAISE EXCEPTION 'Interrupted delivery was silently reissued or lost its uncertainty';
  END IF;
  -- A participant who opts out after preparation must not reach transport.
  SELECT * INTO message FROM engagement_response_broadcast_messages WHERE state='queued' ORDER BY outbox_id LIMIT 1;
  UPDATE engagement_subscriptions SET confirmed=false,unsubscribed_at=clock_timestamp() WHERE id=message.subscription_id;
  claim=public.claim_engagement_response_email(gen_random_uuid());
  IF claim IS NULL OR claim->>'outboxId'<>message.outbox_id::text OR claim->>'state'<>'cancelled' OR claim ? 'messageText' THEN
    RAISE EXCEPTION 'Unsubscribed participant reached the transport claim';
  END IF;
  -- A changed outbox body cannot replace the retained publication message.
  SELECT * INTO message FROM engagement_response_broadcast_messages WHERE state='queued' ORDER BY outbox_id LIMIT 1;
  UPDATE engagement_email_outbox SET body='SYNTHETIC changed after preparation' WHERE id=message.outbox_id;
  claim=public.claim_engagement_response_email(gen_random_uuid());
  IF claim IS NULL OR claim->>'state'<>'cancelled' OR claim ? 'messageText' THEN
    RAISE EXCEPTION 'Changed retained message reached the transport claim';
  END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE summary jsonb; current_response engagement_closeloop_entries%ROWTYPE; refused boolean; table_name text;
BEGIN
  summary=public.read_engagement_response_broadcast('b76fe95e-3a5e-4791-a232-dd65d85b8a57','ba000000-0000-4000-8000-000000000001');
  IF summary IS NULL OR summary->'counts'->>'accepted'<>'1' OR summary->'counts'->>'uncertain'<>'1'
    OR summary::text LIKE '%example.invalid%' OR summary::text LIKE '%unsubscribe_token%' THEN
    RAISE EXCEPTION 'Staff summary lost uncertainty or disclosed participant identifiers';
  END IF;
  SELECT * INTO STRICT current_response FROM engagement_closeloop_entries
    WHERE id=(SELECT (entry->>'id')::uuid FROM jsonb_to_record(
      (SELECT result_json FROM engagement_response_write_receipts WHERE request_id='ba000000-0000-4000-8000-000000000001')) AS r(entry jsonb));
  PERFORM public.write_engagement_response(current_response.campaign_id,gen_random_uuid(),'update',current_response.id,
    current_response.updated_at,'SYNTHETIC withdraw before delivery','{"status":"draft"}');
  FOREACH table_name IN ARRAY ARRAY['engagement_response_broadcasts','engagement_response_broadcast_messages'] LOOP
    refused=false;
    BEGIN
      EXECUTE format('SELECT 1 FROM public.%I LIMIT 1',table_name);
    EXCEPTION WHEN insufficient_privilege THEN refused=true;
    END;
    IF NOT refused THEN RAISE EXCEPTION 'Staff caller read the private broadcast tables directly'; END IF;
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  refused=false;
  BEGIN
    PERFORM public.read_engagement_response_broadcast('b76fe95e-3a5e-4791-a232-dd65d85b8a57','ba000000-0000-4000-8000-000000000001');
  EXCEPTION WHEN insufficient_privilege THEN refused=true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'An outsider read the private broadcast summary'; END IF;
END $$;
SET LOCAL ROLE service_role;
DO $$
DECLARE claim jsonb;
BEGIN
  claim=public.claim_engagement_response_email(gen_random_uuid());
  IF claim IS NULL OR claim->>'state'<>'cancelled' OR claim ? 'messageText' THEN
    RAISE EXCEPTION 'Withdrawn response reached a later transport claim';
  END IF;
END $$;
RESET ROLE;
