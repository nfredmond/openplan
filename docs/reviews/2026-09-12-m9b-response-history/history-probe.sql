DO $probe$
DECLARE workspace uuid; actor uuid; campaign uuid:=gen_random_uuid(); sibling uuid:=gen_random_uuid(); response uuid:=gen_random_uuid();
BEGIN
 SELECT c.workspace_id,m.user_id INTO workspace,actor FROM engagement_campaigns c JOIN workspace_members m ON m.workspace_id=c.workspace_id
 WHERE c.id='a3c41566-bfd4-40f2-b467-96ee79054ec6' AND m.role='owner' LIMIT 1;
 IF workspace IS NULL THEN RAISE EXCEPTION 'Missing named synthetic browser fixture'; END IF;
 IF NOT EXISTS(SELECT 1 FROM engagement_response_history h JOIN engagement_closeloop_entries e ON e.id=h.response_id
  WHERE e.campaign_id='a3c41566-bfd4-40f2-b467-96ee79054ec6' AND e.sort_order=0 AND h.revision=1 AND h.event='legacy_baseline' AND h.actor_id IS NULL AND h.record_json=to_jsonb(e)) THEN
  RAISE EXCEPTION 'HISTORY: truthful legacy baseline'; END IF;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('openplan.history_campaign',campaign::text,true);
 PERFORM set_config('openplan.history_sibling',sibling::text,true);
 PERFORM set_config('openplan.history_response',response::text,true);
 PERFORM set_config('openplan.history_workspace',workspace::text,true);
 INSERT INTO engagement_campaigns(id,workspace_id,title) VALUES(campaign,workspace,'SYNTHETIC response history'),(sibling,workspace,'SYNTHETIC history scope');
END $probe$;
SET LOCAL ROLE authenticated;
DO $probe$
DECLARE c uuid:=current_setting('openplan.history_campaign')::uuid; r uuid:=current_setting('openplan.history_response')::uuid; blocked boolean:=false; events text[];
BEGIN
 INSERT INTO engagement_closeloop_entries(id,campaign_id,theme_title,we_did) VALUES(r,c,'SYNTHETIC response','SYNTHETIC original');
 IF NOT EXISTS(SELECT 1 FROM engagement_response_history WHERE response_id=r AND revision=1 AND event='created' AND actor_id=auth.uid() AND record_json->>'we_did'='SYNTHETIC original') THEN RAISE EXCEPTION 'HISTORY: original and actor'; END IF;
 UPDATE engagement_closeloop_entries SET we_did='SYNTHETIC correction' WHERE id=r;
 UPDATE engagement_closeloop_entries SET status='published' WHERE id=r;
 UPDATE engagement_closeloop_entries SET we_did=we_did WHERE id=r;
 UPDATE engagement_closeloop_entries SET status='draft' WHERE id=r;
 SELECT array_agg(event ORDER BY revision) INTO events FROM engagement_response_history WHERE response_id=r;
 IF events<>ARRAY['created','corrected','published','unpublished'] THEN RAISE EXCEPTION 'HISTORY: complete ordered transitions'; END IF;
 IF EXISTS(SELECT 1 FROM engagement_response_history WHERE response_id=r AND record_sha256<>encode(extensions.digest(record_json::text,'sha256'),'hex')) THEN RAISE EXCEPTION 'HISTORY: snapshot checksum'; END IF;
 BEGIN
  UPDATE engagement_closeloop_entries SET campaign_id=current_setting('openplan.history_sibling')::uuid WHERE id=r;
 EXCEPTION WHEN raise_exception THEN blocked=SQLERRM='Response identity and campaign are immutable'; END;
 IF NOT blocked THEN RAISE EXCEPTION 'HISTORY: campaign identity'; END IF;
 blocked=false;
 BEGIN UPDATE engagement_response_history SET actor_id=NULL WHERE response_id=r;
 EXCEPTION WHEN insufficient_privilege THEN blocked=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'HISTORY: staff cannot rewrite history'; END IF;
 DELETE FROM engagement_closeloop_entries WHERE id=r;
 SELECT array_agg(event ORDER BY revision) INTO events FROM engagement_response_history WHERE response_id=r;
 IF events<>ARRAY['created','corrected','published','unpublished','removed'] THEN RAISE EXCEPTION 'HISTORY: removal retained'; END IF;
 IF NOT EXISTS(SELECT 1 FROM engagement_response_history WHERE response_id=r AND revision=1 AND record_json->>'we_did'='SYNTHETIC original') THEN RAISE EXCEPTION 'HISTORY: original survives removal'; END IF;
 blocked=false;
 BEGIN INSERT INTO engagement_closeloop_entries(id,campaign_id,theme_title) VALUES(r,c,'SYNTHETIC reused identity');
 EXCEPTION WHEN raise_exception OR unique_violation THEN blocked=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'HISTORY: removed identity cannot be reused'; END IF;
END $probe$;
DO $probe$
DECLARE source uuid:=gen_random_uuid(); response uuid:=gen_random_uuid(); c uuid:=current_setting('openplan.history_campaign')::uuid; prior timestamptz;
BEGIN
 INSERT INTO engagement_items(id,campaign_id,body,source_type,status) VALUES(source,c,'SYNTHETIC reviewed source','internal','approved') RETURNING updated_at INTO prior;
 INSERT INTO engagement_closeloop_entries(id,campaign_id,theme_title,we_did,status,source_item_ids) VALUES(response,c,'SYNTHETIC linked response','SYNTHETIC published copy','published',ARRAY[source]);
 UPDATE engagement_items SET body='SYNTHETIC corrected source',review_expected_updated_at=prior,review_reason='SYNTHETIC reason for source correction' WHERE id=source;
 IF NOT EXISTS(SELECT 1 FROM engagement_closeloop_entries WHERE id=response AND status='draft' AND published_at IS NULL) THEN RAISE EXCEPTION 'HISTORY: source still withdraws publication'; END IF;
 IF NOT EXISTS(SELECT 1 FROM engagement_response_history WHERE response_id=response AND revision=2 AND event='unpublished' AND record_json->>'status'='draft') THEN RAISE EXCEPTION 'HISTORY: source withdrawal retained'; END IF;
 IF NOT EXISTS(SELECT 1 FROM engagement_response_history WHERE response_id=response AND revision=1 AND record_json->>'status'='published' AND record_json->>'we_did'='SYNTHETIC published copy') THEN RAISE EXCEPTION 'HISTORY: prior published copy retained'; END IF;
END $probe$;
RESET ROLE;
DO $probe$
DECLARE blocked boolean:=false;
BEGIN
 BEGIN UPDATE engagement_response_history SET actor_id=actor_id WHERE response_id=current_setting('openplan.history_response')::uuid;
 EXCEPTION WHEN raise_exception THEN blocked=SQLERRM='Engagement history is immutable'; END;
 IF NOT blocked THEN RAISE EXCEPTION 'HISTORY: immutable even for privileged writers'; END IF;
 IF has_table_privilege('anon','engagement_response_history','SELECT') OR has_function_privilege('anon','retain_engagement_response_history()','EXECUTE') THEN RAISE EXCEPTION 'HISTORY: anonymous grant'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id='e737fbca-c318-4930-a19b-8084be03cfe9') THEN RAISE EXCEPTION 'Missing synthetic outsider'; END IF;
 PERFORM set_config('request.jwt.claim.sub','e737fbca-c318-4930-a19b-8084be03cfe9',true);
END $probe$;
SET LOCAL ROLE authenticated;
DO $probe$ BEGIN
 IF EXISTS(SELECT 1 FROM engagement_response_history WHERE campaign_id=current_setting('openplan.history_campaign')::uuid) THEN RAISE EXCEPTION 'HISTORY: outsider denied'; END IF;
END $probe$;
RESET ROLE;
INSERT INTO workspace_members(workspace_id,user_id,role) VALUES(current_setting('openplan.history_workspace')::uuid,'e737fbca-c318-4930-a19b-8084be03cfe9','viewer');
SET LOCAL ROLE authenticated;
DO $probe$ BEGIN
 IF EXISTS(SELECT 1 FROM engagement_response_history WHERE campaign_id=current_setting('openplan.history_campaign')::uuid) THEN RAISE EXCEPTION 'HISTORY: viewer denied'; END IF;
END $probe$;
RESET ROLE;
