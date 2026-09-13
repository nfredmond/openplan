DO $$
DECLARE workspace uuid; actor uuid; campaign uuid:=gen_random_uuid(); sibling uuid:=gen_random_uuid();
BEGIN
 SELECT c.workspace_id, m.user_id INTO workspace,actor
 FROM engagement_campaigns c JOIN workspace_members m ON m.workspace_id=c.workspace_id
 WHERE c.id='51df702f-76ad-44a0-a028-88c451096368' AND m.role='owner' LIMIT 1;
 IF workspace IS NULL THEN RAISE EXCEPTION 'Missing named synthetic browser fixture'; END IF;
 PERFORM set_config('openplan.test_campaign',campaign::text,true);
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 INSERT INTO engagement_campaigns(id,workspace_id,title) VALUES
  (campaign,workspace,'SYNTHETIC snapshot verification'),(sibling,workspace,'SYNTHETIC sibling control');
 INSERT INTO engagement_closeloop_entries(campaign_id,theme_title,you_said,we_did,status,sort_order,created_at)
 SELECT campaign,'SYNTHETIC '||n,'Test input','Test response',CASE WHEN n%2=0 THEN 'published' ELSE 'draft' END,0,'2026-09-12T00:00:00Z'::timestamptz
 FROM generate_series(1,1005) n;
 INSERT INTO engagement_closeloop_entries(campaign_id,theme_title) VALUES(sibling,'SYNTHETIC other campaign');
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE result jsonb; published jsonb; expected_ids jsonb; actual_ids jsonb; keys text[];
BEGIN
 result=read_engagement_response_snapshot(current_setting('openplan.test_campaign')::uuid,false);
 IF (result->>'count')::int<>1005 OR jsonb_array_length(result->'entries')<>1005 THEN RAISE EXCEPTION 'M9B: complete scoped count'; END IF;
 IF result->>'campaignId'<>current_setting('openplan.test_campaign') OR result->>'publishedOnly'<>'false' THEN RAISE EXCEPTION 'M9B: scope receipt'; END IF;
 SELECT jsonb_agg(id::text ORDER BY id) INTO expected_ids FROM engagement_closeloop_entries WHERE campaign_id=current_setting('openplan.test_campaign')::uuid;
 SELECT jsonb_agg(value->>'id') INTO actual_ids FROM jsonb_array_elements(result->'entries');
 IF actual_ids<>expected_ids THEN RAISE EXCEPTION 'M9B: stable total order'; END IF;
 SELECT array_agg(key ORDER BY key) INTO keys FROM jsonb_object_keys(result->'entries'->0) key;
 IF keys<>ARRAY['ai_assisted','campaign_id','category_id','created_at','id','published_at','sort_order','source_item_ids','status','theme_title','updated_at','we_did','you_said']::text[] THEN RAISE EXCEPTION 'M9B: exact response projection'; END IF;
 published=read_engagement_response_snapshot(current_setting('openplan.test_campaign')::uuid,true);
 IF (published->>'count')::int<>502 OR EXISTS(SELECT 1 FROM jsonb_array_elements(published->'entries') row WHERE row->>'status'<>'published') THEN RAISE EXCEPTION 'M9B: published-only scope'; END IF;
 IF read_engagement_response_snapshot(NULL,false) IS NOT NULL THEN RAISE EXCEPTION 'M9B: null scope refused'; END IF;
 PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 result=read_engagement_response_snapshot(current_setting('openplan.test_campaign')::uuid,false);
 IF (result->>'count')::int<>0 THEN RAISE EXCEPTION 'M9B: caller RLS'; END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
 IF has_function_privilege('anon','public.read_engagement_response_snapshot(uuid,boolean)','EXECUTE') THEN RAISE EXCEPTION 'M9B: anonymous execution refused'; END IF;
 IF (SELECT provolatile FROM pg_proc WHERE oid='public.read_engagement_response_snapshot(uuid,boolean)'::regprocedure)<>'s' THEN RAISE EXCEPTION 'M9B: stable snapshot declaration'; END IF;
END $$;
SET LOCAL ROLE service_role;
DO $$
DECLARE result jsonb;
BEGIN
 result=read_engagement_response_snapshot(current_setting('openplan.test_campaign')::uuid,true);
 IF (result->>'count')::int<>502 THEN RAISE EXCEPTION 'M9B: service public scope'; END IF;
END $$;
RESET ROLE;
