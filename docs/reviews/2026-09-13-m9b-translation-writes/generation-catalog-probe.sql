CREATE FUNCTION pg_temp.catalog_refusal(statement text,expected text,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE=expected THEN RETURN; END IF;
  RAISE EXCEPTION 'Refusal % expected %, got %: %',label,expected,SQLSTATE,SQLERRM;
 END;
 RAISE EXCEPTION 'Guard failed: %',label;
END $$;
DO $$
DECLARE f jsonb:=current_setting('openplan.catalog_fixture')::jsonb; r jsonb; entry jsonb; n int; status text;
 statuses text[]:=ARRAY['queued','reserved','running','completed','incomplete','failed','interrupted','cancelled'];
BEGIN
 INSERT INTO auth.users(id,aud,role,email) SELECT id,'authenticated','authenticated',id::text||'@catalog.synthetic.invalid'
 FROM unnest(ARRAY[(f->>'actorId')::uuid,(f->>'member')::uuid,(f->>'viewer')::uuid,(f->>'outsider')::uuid]) id;
 INSERT INTO workspaces(id,name,slug) VALUES((f->>'workspaceId')::uuid,'SYNTHETIC catalog',f->>'workspaceId');
 INSERT INTO workspace_members(workspace_id,user_id,role) VALUES((f->>'workspaceId')::uuid,(f->>'actorId')::uuid,'owner'),
 ((f->>'workspaceId')::uuid,(f->>'member')::uuid,'member'),((f->>'workspaceId')::uuid,(f->>'viewer')::uuid,'viewer');
 INSERT INTO engagement_campaigns(id,workspace_id,title,created_by) VALUES
 ((f->>'campaignId')::uuid,(f->>'workspaceId')::uuid,f->>'source',(f->>'actorId')::uuid),
 ((f->>'foreignCampaign')::uuid,(f->>'workspaceId')::uuid,'SYNTHETIC empty other campaign',(f->>'actorId')::uuid);
 -- Catalog projection fixtures cover every state. They do not claim a model ran:
 -- terminal rows are inserted directly, without fabricating output receipts.
 FOR r,n IN SELECT value,ordinality::int FROM jsonb_array_elements(f->'requests') WITH ORDINALITY LOOP
  INSERT INTO engagement_translation_generation_requests(id,campaign_id,workspace_id,actor_id,locale,intent,credential,created_at)
  VALUES((r->>'id')::uuid,(f->>'campaignId')::uuid,(f->>'workspaceId')::uuid,(f->>'actorId')::uuid,'es',
   jsonb_build_object('requestId',r->>'id','actorId',f->>'actorId','campaignId',f->>'campaignId','locale','es','fields',r->'fields'),r->'credential',(r->>'createdAt')::timestamptz);
  status:=statuses[1+(n%8)];
  FOR entry IN SELECT value FROM jsonb_array_elements(r->'fields') LOOP
   INSERT INTO engagement_translation_generation_fields(id,request_id,ordinal,address,packet_canonical,state,attempt_id,reservation_id,reserved_at,lease_expires_at,finished_at)
   VALUES((entry->>'id')::uuid,(r->>'id')::uuid,CASE WHEN entry#>>'{address,field}'='title' THEN 1 ELSE 2 END,entry->'address',entry->>'packetCanonical',status,
    CASE WHEN status<>'queued' THEN gen_random_uuid() END,CASE WHEN status<>'queued' THEN gen_random_uuid() END,
    CASE WHEN status<>'queued' THEN now() END,CASE WHEN status<>'queued' THEN now()+interval '1 minute' END,
    CASE WHEN status NOT IN ('queued','reserved','running') THEN now() END);
  END LOOP;
 END LOOP;
 -- An intentionally inconsistent imported row tests the workspace filter even
 -- when the campaign ID is the caller's. It is not a valid generation request.
 INSERT INTO workspaces(id,name,slug) VALUES((f->>'foreignWorkspace')::uuid,'SYNTHETIC foreign workspace',f->>'foreignWorkspace');
 INSERT INTO engagement_translation_generation_requests(id,campaign_id,workspace_id,actor_id,locale,intent,credential,created_at)
 VALUES((f->>'foreignRequest')::uuid,(f->>'campaignId')::uuid,(f->>'foreignWorkspace')::uuid,(f->>'outsider')::uuid,'es',
  jsonb_build_object('fields',f#>'{requests,0,fields}'),f#>'{requests,0,credential}','2099-01-01Z');
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',current_setting('openplan.catalog_fixture')::jsonb->>'actorId',true) IS NOT NULL;
DO $$
DECLARE f jsonb:=current_setting('openplan.catalog_fixture')::jsonb; first jsonb; second jsonb; empty_page jsonb; row jsonb; item jsonb; expected_state text; ordinal int;
 states text[]:=ARRAY['queued','reserved','running','completed','incomplete','failed','interrupted','cancelled'];
BEGIN
 first:=list_translation_generation_requests((f->>'campaignId')::uuid);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(first->'requests') e WHERE e->>'id'=f->>'foreignRequest') THEN RAISE EXCEPTION 'Catalog leaked foreign workspace'; END IF;
 IF jsonb_array_length(first->'requests')<>20 OR first->'next'='null'::jsonb THEN RAISE EXCEPTION 'Catalog first page lost continuation'; END IF;
 second:=list_translation_generation_requests((f->>'campaignId')::uuid,(first#>>'{next,createdAt}')::timestamptz,(first#>>'{next,id}')::uuid);
 IF jsonb_array_length(second->'requests')<>3 OR second->'next'<>'null'::jsonb THEN RAISE EXCEPTION 'Catalog tail repeated or skipped requests'; END IF;
 empty_page:=list_translation_generation_requests((f->>'foreignCampaign')::uuid);
 IF empty_page->'requests'<>'[]'::jsonb OR empty_page->'next'<>'null'::jsonb THEN RAISE EXCEPTION 'Catalog leaked another campaign'; END IF;
 FOR row IN SELECT value FROM jsonb_array_elements((first->'requests')||(second->'requests')) LOOP
  SELECT value,ordinality::int INTO item,ordinal FROM jsonb_array_elements(f->'requests') WITH ORDINALITY WHERE value->>'id'=row->>'id';
  expected_state:=states[1+(ordinal%8)];
  IF (row->>'fieldCount')::int<>2 OR (row#>>ARRAY['counts',expected_state])::int<>2
   OR (SELECT sum(value::int) FROM jsonb_each_text(row->'counts'))<>2 THEN RAISE EXCEPTION 'Catalog state counts differ from fields'; END IF;
  IF row->>'createdAt' IS DISTINCT FROM item->>'createdAt' THEN RAISE EXCEPTION 'Catalog timestamp lost microseconds'; END IF;
  IF row->>'actorId' IS DISTINCT FROM f->>'actorId' OR row->>'locale'<>'es' THEN RAISE EXCEPTION 'Catalog identity differs'; END IF;
 END LOOP;
 IF first->>'campaignId' IS DISTINCT FROM f->>'campaignId' OR first->>'workspaceId' IS DISTINCT FROM f->>'workspaceId'
 OR first::text LIKE '%credential%' OR first::text LIKE '%packetCanonical%' OR first::text LIKE '%SYNTHETIC%' THEN RAISE EXCEPTION 'Catalog exposed private payload or wrong scope'; END IF;
 PERFORM set_config('openplan.catalog_pages',jsonb_build_array(first,second)::text,true);
 PERFORM pg_temp.catalog_refusal(format('SELECT list_translation_generation_requests(%L,NULL,%L)',f->>'campaignId',f#>>'{requests,0,id}'),'22023','partial cursor id');
 PERFORM pg_temp.catalog_refusal(format('SELECT list_translation_generation_requests(%L,now(),NULL)',f->>'campaignId'),'22023','partial cursor time');
 PERFORM pg_temp.catalog_refusal('SELECT id FROM engagement_translation_generation_requests','42501','direct private table');
 PERFORM set_config('request.jwt.claim.sub',f->>'member',true);
 IF list_translation_generation_requests((f->>'campaignId')::uuid) IS DISTINCT FROM first THEN RAISE EXCEPTION 'Member catalog differs'; END IF;
END $$;
SELECT 'CATALOG_PAGES:'||current_setting('openplan.catalog_pages');
RESET ROLE;
DELETE FROM workspace_members WHERE workspace_id=(current_setting('openplan.catalog_fixture')::jsonb->>'workspaceId')::uuid AND user_id=(current_setting('openplan.catalog_fixture')::jsonb->>'member')::uuid;
SET LOCAL ROLE authenticated;
DO $$
DECLARE f jsonb:=current_setting('openplan.catalog_fixture')::jsonb; person text;
BEGIN
 FOREACH person IN ARRAY ARRAY['member','viewer','outsider'] LOOP
  PERFORM set_config('request.jwt.claim.sub',f->>person,true);
  PERFORM pg_temp.catalog_refusal(format('SELECT list_translation_generation_requests(%L)',f->>'campaignId'),'42501',person||' catalog access');
 END LOOP;
 PERFORM set_config('request.jwt.claim.sub',f->>'actorId',true);
END $$;
SET LOCAL ROLE anon;
SELECT pg_temp.catalog_refusal(format('SELECT list_translation_generation_requests(%L)',current_setting('openplan.catalog_fixture')::jsonb->>'campaignId'),'42501','anonymous catalog access');
RESET ROLE;
SELECT 'CATALOG_PROBE_PASSED';
