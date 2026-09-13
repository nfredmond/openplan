-- Synthetic security fixtures, always inside the caller's rolled-back transaction.
INSERT INTO auth.users(id,email,aud,role) VALUES
  ('ac000000-0000-4000-8000-000000000001','response-staff-probe@example.invalid','authenticated','authenticated'),
  ('ac000000-0000-4000-8000-000000000002','response-outsider-probe@example.invalid','authenticated','authenticated');
INSERT INTO workspace_members(workspace_id,user_id,role) VALUES
  ('f02e465a-40bd-4304-b4af-d45daff29d3d','ac000000-0000-4000-8000-000000000001','member');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','4a21e42f-27a7-474d-9a7a-5912c70af359',true);
SELECT public.write_engagement_response('b76fe95e-3a5e-4791-a232-dd65d85b8a57',
  'ac000000-0000-4000-8000-000000000010','create',NULL,NULL,NULL,
  '{"theme_title":"SYNTHETIC authority probe","we_did":"Retained actor words","status":"published"}');
DO $$
DECLARE response jsonb;
BEGIN
  response=public.read_engagement_response_broadcast('b76fe95e-3a5e-4791-a232-dd65d85b8a57','ac000000-0000-4000-8000-000000000010');
  IF response->>'state' IS DISTINCT FROM 'queued' THEN RAISE EXCEPTION 'Author could not read the publication report'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','ac000000-0000-4000-8000-000000000001',true);
DO $$
DECLARE refused boolean:=false; response_key uuid; observed_version timestamptz; result jsonb;
BEGIN
  SELECT response_id INTO STRICT response_key FROM engagement_response_write_receipts WHERE request_id='ac000000-0000-4000-8000-000000000010';
  BEGIN
    PERFORM public.write_engagement_response('b76fe95e-3a5e-4791-a232-dd65d85b8a57',
      'ac000000-0000-4000-8000-000000000010','create',NULL,NULL,NULL,
      '{"theme_title":"SYNTHETIC authority probe","we_did":"Retained actor words","status":"published"}');
  EXCEPTION WHEN unique_violation THEN refused=true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'A different staff actor replayed the original request'; END IF;
  SELECT updated_at INTO STRICT observed_version FROM engagement_closeloop_entries WHERE engagement_closeloop_entries.id=response_key;
  result=public.write_engagement_response('b76fe95e-3a5e-4791-a232-dd65d85b8a57',gen_random_uuid(),'update',response_key,observed_version,
    'SYNTHETIC second actor correction','{"we_did":"Second actor reviewed correction"}');
  IF result->'entry'->>'we_did' IS DISTINCT FROM 'Second actor reviewed correction' THEN RAISE EXCEPTION 'Authorized second staff actor could not correct with a new request'; END IF;
  refused=false;
  BEGIN
    PERFORM public.write_engagement_response('6f633265-d967-4ecb-982c-5cc1991bc5b6',gen_random_uuid(),'update',response_key,
      (result->'entry'->>'updated_at')::timestamptz,'SYNTHETIC wrong campaign','{"we_did":"Foreign campaign words"}');
  EXCEPTION WHEN no_data_found THEN refused=true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'A staff actor corrected a response through another campaign'; END IF;
END $$;
RESET ROLE;
UPDATE workspace_members SET role='viewer' WHERE workspace_id='f02e465a-40bd-4304-b4af-d45daff29d3d' AND user_id='ac000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
DO $$
DECLARE refused boolean:=false;
BEGIN
  IF EXISTS(SELECT 1 FROM engagement_response_write_receipts WHERE request_id='ac000000-0000-4000-8000-000000000010') THEN RAISE EXCEPTION 'Viewer read private write receipts'; END IF;
  BEGIN
    PERFORM public.write_engagement_response('b76fe95e-3a5e-4791-a232-dd65d85b8a57',gen_random_uuid(),'create',NULL,NULL,NULL,'{"theme_title":"SYNTHETIC viewer write"}');
  EXCEPTION WHEN insufficient_privilege THEN refused=true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'Viewer wrote a staff response'; END IF;
  refused=false;
  BEGIN
    PERFORM public.read_engagement_response_broadcast('b76fe95e-3a5e-4791-a232-dd65d85b8a57','ac000000-0000-4000-8000-000000000010');
  EXCEPTION WHEN insufficient_privilege THEN refused=true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'Viewer read private subscriber status'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','ac000000-0000-4000-8000-000000000002',true);
DO $$
DECLARE refused boolean:=false;
BEGIN
  IF EXISTS(SELECT 1 FROM engagement_response_write_receipts WHERE request_id='ac000000-0000-4000-8000-000000000010') THEN RAISE EXCEPTION 'Outsider read private write receipts'; END IF;
  BEGIN
    PERFORM public.write_engagement_response('b76fe95e-3a5e-4791-a232-dd65d85b8a57',gen_random_uuid(),'create',NULL,NULL,NULL,'{"theme_title":"SYNTHETIC outsider write"}');
  EXCEPTION WHEN insufficient_privilege THEN refused=true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'Outsider wrote a staff response'; END IF;
  refused=false;
  BEGIN
    PERFORM public.read_engagement_response_broadcast('b76fe95e-3a5e-4791-a232-dd65d85b8a57','ac000000-0000-4000-8000-000000000010');
  EXCEPTION WHEN insufficient_privilege THEN refused=true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'Outsider read private subscriber status'; END IF;
END $$;
RESET ROLE;
-- Preserve the workspace owner floor while testing revocation of the original actor.
UPDATE workspace_members SET role='owner' WHERE workspace_id='f02e465a-40bd-4304-b4af-d45daff29d3d' AND user_id='ac000000-0000-4000-8000-000000000001';
DELETE FROM workspace_members WHERE workspace_id='f02e465a-40bd-4304-b4af-d45daff29d3d' AND user_id='4a21e42f-27a7-474d-9a7a-5912c70af359';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','4a21e42f-27a7-474d-9a7a-5912c70af359',true);
DO $$
DECLARE refused boolean:=false;
BEGIN
  BEGIN
    PERFORM public.write_engagement_response('b76fe95e-3a5e-4791-a232-dd65d85b8a57',
      'ac000000-0000-4000-8000-000000000010','create',NULL,NULL,NULL,
      '{"theme_title":"SYNTHETIC authority probe","we_did":"Retained actor words","status":"published"}');
  EXCEPTION WHEN insufficient_privilege THEN refused=true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'Revoked actor replayed a private receipt'; END IF;
END $$;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub','',true);
DO $$
DECLARE refused boolean:=false;
BEGIN
  BEGIN
    PERFORM public.write_engagement_response('b76fe95e-3a5e-4791-a232-dd65d85b8a57',gen_random_uuid(),'create',NULL,NULL,NULL,'{"theme_title":"SYNTHETIC anonymous write"}');
  EXCEPTION WHEN insufficient_privilege THEN refused=true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'Anonymous caller wrote a staff response'; END IF;
  IF has_function_privilege('anon','public.write_engagement_response(uuid,uuid,text,uuid,timestamptz,text,jsonb)','EXECUTE')
    OR has_function_privilege('anon','public.read_engagement_response_broadcast(uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous caller has private response RPC privilege';
  END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF has_table_privilege('authenticated','public.engagement_response_broadcasts','SELECT')
    OR has_table_privilege('authenticated','public.engagement_response_broadcast_messages','SELECT')
    OR has_table_privilege('service_role','public.engagement_response_broadcast_messages','SELECT') THEN
    RAISE EXCEPTION 'Sensitive broadcast records have direct read privileges';
  END IF;
  RAISE NOTICE 'Staff actor identity, viewer/outsider privacy, revocation and anonymous/direct privilege probes passed';
END $$;
