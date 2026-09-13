DO $probe$
DECLARE owner_id uuid; workspace uuid;
BEGIN
 SELECT m.user_id,c.workspace_id INTO owner_id,workspace FROM engagement_campaigns c JOIN workspace_members m ON m.workspace_id=c.workspace_id
 WHERE c.id='a3c41566-bfd4-40f2-b467-96ee79054ec6' AND m.role='owner' LIMIT 1;
 IF owner_id IS NULL THEN RAISE EXCEPTION 'Missing named browser fixture'; END IF;
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
 PERFORM set_config('openplan.reader_workspace',workspace::text,true);
 IF has_function_privilege('anon','read_engagement_response_history(uuid)','EXECUTE') THEN RAISE EXCEPTION 'READER: anonymous execution'; END IF;
END $probe$;
SET LOCAL ROLE authenticated;
DO $probe$
DECLARE result jsonb; row jsonb; campaign uuid:=gen_random_uuid(); response uuid:=gen_random_uuid();
BEGIN
 result:=read_engagement_response_history('a3c41566-bfd4-40f2-b467-96ee79054ec6');
 IF (result->>'count')::int<>1005 OR jsonb_array_length(result->'entries')<>1005 THEN RAISE EXCEPTION 'READER: complete 1005 history copies'; END IF;
 FOR row IN SELECT * FROM jsonb_array_elements(result->'entries') LOOP
  IF row->>'campaign_id'<>'a3c41566-bfd4-40f2-b467-96ee79054ec6' THEN RAISE EXCEPTION 'READER: campaign scope'; END IF;
  IF row->>'record_sha256'<>encode(extensions.digest(row->>'record_text','sha256'),'hex') THEN RAISE EXCEPTION 'READER: exact retained checksum'; END IF;
 END LOOP;
 INSERT INTO engagement_campaigns(id,workspace_id,title) VALUES(campaign,current_setting('openplan.reader_workspace')::uuid,'SYNTHETIC history reader');
 PERFORM set_config('openplan.reader_campaign',campaign::text,true);
 IF read_engagement_response_history(campaign)->>'count'<>'0' THEN RAISE EXCEPTION 'READER: healthy empty'; END IF;
 INSERT INTO engagement_closeloop_entries(id,campaign_id,theme_title,we_did) VALUES(response,campaign,'SYNTHETIC response','Original answer');
 UPDATE engagement_closeloop_entries SET we_did='Corrected answer' WHERE id=response;
 DELETE FROM engagement_closeloop_entries WHERE id=response;
 result:=read_engagement_response_history(campaign);
 IF result->>'count'<>'3' OR result->'entries'->0->>'revision'<>'1' OR result->'entries'->2->>'event'<>'removed'
  OR (result->'entries'->0->>'record_text')::jsonb->>'we_did'<>'Original answer' THEN RAISE EXCEPTION 'READER: removed original and ordered corrections'; END IF;
END $probe$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','e737fbca-c318-4930-a19b-8084be03cfe9',true);
SET LOCAL ROLE authenticated;
DO $probe$ BEGIN
 IF read_engagement_response_history(current_setting('openplan.reader_campaign')::uuid)->>'count'<>'0' THEN RAISE EXCEPTION 'READER: outsider denied'; END IF;
END $probe$;
RESET ROLE;
INSERT INTO workspace_members(workspace_id,user_id,role) VALUES(current_setting('openplan.reader_workspace')::uuid,'e737fbca-c318-4930-a19b-8084be03cfe9','viewer');
SET LOCAL ROLE authenticated;
DO $probe$ BEGIN
 IF read_engagement_response_history(current_setting('openplan.reader_campaign')::uuid)->>'count'<>'0' THEN RAISE EXCEPTION 'READER: viewer denied'; END IF;
END $probe$;
RESET ROLE;
