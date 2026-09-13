-- Run after broadcast-probe.sql inside the same rolled-back transaction.
INSERT INTO engagement_email_outbox(campaign_id,to_email,subject,status,transport,error,created_at) VALUES
 ('b76fe95e-3a5e-4791-a232-dd65d85b8a57','private@example.invalid','SYNTHETIC legacy failure','failed','private@example.invalid','private@example.invalid','2030-01-01');
INSERT INTO engagement_email_outbox(campaign_id,to_email,subject,status,transport)
 SELECT '6f633265-d967-4ecb-982c-5cc1991bc5b6','foreign@example.invalid','SYNTHETIC other campaign','skipped','none' FROM generate_series(1,1500);
SELECT set_config('request.jwt.claim.sub','4a21e42f-27a7-474d-9a7a-5912c70af359',true);
DO $$
DECLARE r jsonb; expected_count bigint;
BEGIN
 SELECT count(*) INTO expected_count FROM engagement_email_outbox WHERE campaign_id='b76fe95e-3a5e-4791-a232-dd65d85b8a57';
 r=public.read_engagement_email_delivery_summary('b76fe95e-3a5e-4791-a232-dd65d85b8a57');
 IF (r->>'total')::bigint<>expected_count OR expected_count<1005 THEN RAISE EXCEPTION 'Complete campaign count lost rows or included another campaign'; END IF;
 IF (r->'counts'->>'uncertain')::bigint<>1 OR (r->'counts'->>'attempting')::bigint<>1 OR (r->'counts'->>'cancelled')::bigint<>3 THEN RAISE EXCEPTION 'Durable states were replaced by legacy queued counts'; END IF;
 IF (SELECT sum(value::bigint) FROM jsonb_each_text(r->'counts'))<>expected_count THEN RAISE EXCEPTION 'Messages were counted more than once'; END IF;
 IF r::text LIKE '%example.invalid%' OR r::text LIKE '%to_email%' OR r::text LIKE '%unsubscribe%' THEN RAISE EXCEPTION 'Private participant or provider strings escaped the aggregate'; END IF;
 IF r->'lastFailure'->>'message' IS DISTINCT FROM 'A delivery failure was recorded. This does not establish whether the message reached an inbox.' THEN RAISE EXCEPTION 'Private provider error was not withheld'; END IF;
 IF r->'broadcasts'->>'prepared'<>'1' THEN RAISE EXCEPTION 'Prepared publication count missing'; END IF;
END $$;
INSERT INTO engagement_campaigns(id,workspace_id,title) VALUES('ae000000-0000-4000-8000-000000000020','f02e465a-40bd-4304-b4af-d45daff29d3d','SYNTHETIC empty delivery summary');
DO $$ DECLARE r jsonb; BEGIN
 r=public.read_engagement_email_delivery_summary('ae000000-0000-4000-8000-000000000020');
 IF r->>'total'<>'0' OR r->'transports'<>'[]'::jsonb OR r->'lastRecordedAt'<>'null'::jsonb
 OR (SELECT sum(value::bigint) FROM jsonb_each_text(r->'counts'))<>0
 OR (SELECT sum(value::bigint) FROM jsonb_each_text(r->'broadcasts'))<>0 THEN RAISE EXCEPTION 'Known empty campaign was not reported completely'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT public.write_engagement_response('b76fe95e-3a5e-4791-a232-dd65d85b8a57','ae000000-0000-4000-8000-000000000010','create',NULL,NULL,NULL,
 '{"theme_title":"SYNTHETIC pending summary","we_did":"Saved update","status":"published"}');
DO $$ BEGIN
 IF public.read_engagement_email_delivery_summary('b76fe95e-3a5e-4791-a232-dd65d85b8a57')->'broadcasts'->>'queued'<>'1' THEN RAISE EXCEPTION 'Unprepared publication was invisible'; END IF;
END $$;
RESET ROLE;
-- Status variants are synthetic summary fixtures, not proof of worker transitions.
UPDATE engagement_response_broadcasts SET state='no_share_token' WHERE request_id='ae000000-0000-4000-8000-000000000010';
DO $$ BEGIN
 IF public.read_engagement_email_delivery_summary('b76fe95e-3a5e-4791-a232-dd65d85b8a57')->'broadcasts'->>'noShareToken'<>'1' THEN RAISE EXCEPTION 'Missing-share preparation was invisible'; END IF;
END $$;
UPDATE engagement_response_broadcasts SET state='cancelled' WHERE request_id='ae000000-0000-4000-8000-000000000010';
DO $$ BEGIN
 IF public.read_engagement_email_delivery_summary('b76fe95e-3a5e-4791-a232-dd65d85b8a57')->'broadcasts'->>'cancelled'<>'1' THEN RAISE EXCEPTION 'Cancelled preparation was invisible'; END IF;
END $$;
INSERT INTO auth.users(id,email,aud,role) VALUES('ae000000-0000-4000-8000-000000000001','summary-viewer@example.invalid','authenticated','authenticated');
INSERT INTO workspace_members(workspace_id,user_id,role) VALUES('f02e465a-40bd-4304-b4af-d45daff29d3d','ae000000-0000-4000-8000-000000000001','viewer');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','ae000000-0000-4000-8000-000000000001',true);
DO $$ DECLARE refused boolean:=false; BEGIN
 BEGIN PERFORM public.read_engagement_email_delivery_summary('b76fe95e-3a5e-4791-a232-dd65d85b8a57'); EXCEPTION WHEN insufficient_privilege THEN refused=true; END;
 IF NOT refused THEN RAISE EXCEPTION 'Viewer read private delivery outcomes'; END IF;
END $$;
RESET ROLE;
UPDATE workspace_members SET role='member' WHERE workspace_id='f02e465a-40bd-4304-b4af-d45daff29d3d' AND user_id='ae000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF public.read_engagement_email_delivery_summary('b76fe95e-3a5e-4791-a232-dd65d85b8a57')->>'ok'<>'true' THEN RAISE EXCEPTION 'Authorized staff summary unavailable'; END IF;
END $$;
RESET ROLE;
DELETE FROM workspace_members WHERE workspace_id='f02e465a-40bd-4304-b4af-d45daff29d3d' AND user_id='ae000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
DO $$ DECLARE refused boolean:=false; BEGIN
 BEGIN PERFORM public.read_engagement_email_delivery_summary('b76fe95e-3a5e-4791-a232-dd65d85b8a57'); EXCEPTION WHEN insufficient_privilege THEN refused=true; END;
 IF NOT refused THEN RAISE EXCEPTION 'Revoked staff read private delivery outcomes'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF has_function_privilege('anon','public.read_engagement_email_delivery_summary(uuid)','EXECUTE') THEN RAISE EXCEPTION 'Anonymous delivery summary execution permitted'; END IF;
END $$;
