DO $proof$
DECLARE workspace uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); delegate uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid();
 foreign_workspace uuid:=gen_random_uuid(); feed uuid; current_version uuid; version uuid; worker_token uuid; next_token uuid:=gen_random_uuid();
 command uuid; receipt jsonb; request jsonb; saved jsonb; bad text; object_path text; original_loaded timestamptz;
 original_closure text; tract_geoid text:='synthetic-terminal-'||gen_random_uuid();
BEGIN
 INSERT INTO auth.users(id,email) VALUES(actor,actor||'@example.invalid'),(delegate,delegate||'@example.invalid'),(viewer,viewer||'@example.invalid');
 INSERT INTO public.workspaces(id,name,slug) VALUES(workspace,'Synthetic terminal import','terminal-'||workspace),
  (foreign_workspace,'Synthetic foreign terminal import','terminal-'||foreign_workspace);
 INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(workspace,actor,'owner'),(workspace,delegate,'owner'),
  (workspace,viewer,'viewer'),(foreign_workspace,actor,'owner');
 INSERT INTO public.census_tracts(geoid,state_fips,county_fips,name,geometry)
 VALUES(tract_geoid,'99','999','Synthetic polar terminal tract',public.ST_Multi(public.ST_MakeEnvelope(169,84,171,86,4326)));
 SET LOCAL ROLE service_role;
 receipt:=pg_temp.ready_gtfs(workspace,actor,NULL,10,10);
 current_version:=(receipt->>'versionId')::uuid; feed:=(receipt->>'feedId')::uuid;
 receipt:=public.adopt_gtfs_ingest(workspace,current_version,gen_random_uuid(),actor);
 original_loaded:=(receipt->>'adoptedAt')::timestamptz;
 BEGIN
  PERFORM public.cancel_gtfs_ingest(workspace,current_version,gen_random_uuid(),actor,'Synthetic cancellation');
  RAISE EXCEPTION 'ready feed cancelled';
 EXCEPTION WHEN SQLSTATE '55000' THEN
  IF SQLERRM<>'GTFS terminal command requires an unfinished managed import' THEN RAISE; END IF;
 END;
 FOR mode IN 1..4 LOOP
  command:=gen_random_uuid();
  IF mode IN (1,2) THEN
   request:=pg_temp.ready_gtfs(workspace,actor,feed,8,8,false);
   worker_token:=(request->>'token')::uuid;
  ELSIF mode=3 THEN
   request:=public.admit_gtfs_ingest(gen_random_uuid(),workspace,actor,feed,
    jsonb_build_object('kind','upload','provisionalName','Synthetic awaiting archive','uploadSha256',repeat('e',64),'uploadBytes',99));
   worker_token:=NULL;
  ELSE
   request:=public.admit_gtfs_ingest(gen_random_uuid(),workspace,actor,feed,
    '{"kind":"url","provisionalName":"Synthetic queued URL","sourceUrl":"https://example.invalid/feed.zip","normalizedSourceUrl":"https://example.invalid/feed.zip"}');
   worker_token:=NULL;
  END IF;
  version:=(request->>'versionId')::uuid;
  object_path:=CASE WHEN mode=4 THEN NULL ELSE workspace||'/'||feed||'/'||version||'.zip' END;
  BEGIN
   PERFORM public.cancel_gtfs_ingest(workspace,version,gen_random_uuid(),viewer,'Synthetic cancellation');
   RAISE EXCEPTION 'viewer cancelled import';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
   PERFORM public.cancel_gtfs_ingest(foreign_workspace,version,gen_random_uuid(),actor,'Synthetic cancellation');
   RAISE EXCEPTION 'foreign workspace cancelled import';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  FOR bad IN SELECT value FROM (VALUES(NULL::text),(''),('   '),(repeat('x',2001))) AS invalid(value) LOOP
   BEGIN
    PERFORM public.cancel_gtfs_ingest(workspace,version,gen_random_uuid(),actor,bad);
    RAISE EXCEPTION 'invalid terminal reason accepted';
   EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  END LOOP;
  IF mode=1 THEN
   -- The database owner supplies malformed private contexts to isolate each
   -- trigger predicate. Runtime service calls cannot create these records.
   FOR i IN 1..5 LOOP
    RESET ROLE;
    INSERT INTO openplan_gtfs.write_context VALUES(
     CASE WHEN i=1 THEN txid_current()+1 ELSE txid_current() END,
     CASE WHEN i=2 THEN gen_random_uuid() ELSE version END,
     CASE WHEN i=3 THEN 'wrong-kind' ELSE 'termination' END,
     CASE WHEN i=4 THEN 'INSERT' ELSE 'DELETE' END,worker_token);
    SET LOCAL ROLE service_role;
    BEGIN
     IF i=5 THEN UPDATE public.gtfs_route_service_levels SET trips_per_day=2 WHERE feed_version_id=version;
     ELSE DELETE FROM public.gtfs_route_service_levels WHERE feed_version_id=version; END IF;
     RAISE EXCEPTION 'invalid terminal context authorized derived mutation';
    EXCEPTION WHEN SQLSTATE '55000' THEN
     IF SQLERRM<>'Managed GTFS rows require an owned batch command' THEN RAISE; END IF;
    END;
    RESET ROLE;
    DELETE FROM openplan_gtfs.write_context;
    SET LOCAL ROLE service_role;
   END LOOP;
   IF (SELECT count(*) FROM public.gtfs_tract_service WHERE feed_version_id=version)<>1 THEN RAISE EXCEPTION 'terminal tract fixture missing'; END IF;
   BEGIN
    PERFORM public.fail_gtfs_ingest(version,gen_random_uuid(),command,'partial_write','Synthetic failure');
    RAISE EXCEPTION 'wrong worker closed import';
   EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
   BEGIN
    PERFORM public.fail_gtfs_ingest(version,worker_token,command,'unknown_failure','Synthetic failure');
    RAISE EXCEPTION 'unknown terminal failure code accepted';
   EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
   RESET ROLE;
   UPDATE openplan_gtfs.executions SET lease_until=clock_timestamp()-interval '1 second' WHERE version_id=version;
   SET LOCAL ROLE service_role;
   BEGIN
    PERFORM public.fail_gtfs_ingest(version,worker_token,command,'partial_write','Synthetic failure');
    RAISE EXCEPTION 'expired worker closed import';
   EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
   PERFORM public.claim_gtfs_ingest(version,next_token);
   BEGIN
    PERFORM public.fail_gtfs_ingest(version,worker_token,command,'partial_write','Synthetic failure');
    RAISE EXCEPTION 'replaced worker closed import';
   EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
   worker_token:=next_token;
   RESET ROLE;
   SELECT pg_get_functiondef('public.close_failed_gtfs_version(uuid,text,text,text)'::regprocedure) INTO original_closure;
   EXECUTE $replace$CREATE OR REPLACE FUNCTION public.close_failed_gtfs_version(p_version_id uuid,p_code text,p_detail text,p_storage_path text DEFAULT NULL)
    RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public AS $refusal$
    SELECT '{"recorded":false,"feedStatusChanged":false}'::jsonb; $refusal$$replace$;
   SET LOCAL ROLE service_role;
   BEGIN
    PERFORM public.fail_gtfs_ingest(version,worker_token,command,'partial_write','Synthetic failure');
    RAISE EXCEPTION 'refused closure recorded terminal success';
   EXCEPTION WHEN SQLSTATE '55000' THEN
    IF SQLERRM<>'GTFS terminal closure was refused' THEN RAISE; END IF;
   END;
   RESET ROLE;
   EXECUTE original_closure;
   SET LOCAL ROLE service_role;
   saved:=public.fail_gtfs_ingest(version,worker_token,command,'partial_write','Synthetic failure');
   IF saved->>'state' IS DISTINCT FROM 'failed' THEN RAISE EXCEPTION 'worker failure state incorrect'; END IF;
   IF public.fail_gtfs_ingest(version,worker_token,command,'partial_write','Synthetic failure') IS DISTINCT FROM saved THEN
    RAISE EXCEPTION 'failure replay changed receipt'; END IF;
   BEGIN
    PERFORM public.fail_gtfs_ingest(version,worker_token,command,'partial_write','Changed synthetic failure');
    RAISE EXCEPTION 'changed terminal payload accepted';
   EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM<>'GTFS terminal command payload changed' THEN RAISE; END IF;
   END;
  ELSE
   IF mode=2 THEN
    RESET ROLE;
    UPDATE public.workspace_members SET role='viewer' WHERE workspace_id=workspace AND user_id=actor;
    SET LOCAL ROLE service_role;
    BEGIN
     PERFORM public.fail_gtfs_ingest(version,worker_token,gen_random_uuid(),'partial_write','Synthetic revoked failure');
     RAISE EXCEPTION 'revoked worker closed import';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
   END IF;
   saved:=public.cancel_gtfs_ingest(workspace,version,command,delegate,'Synthetic cancellation');
   IF saved->>'state' IS DISTINCT FROM 'cancelled' THEN RAISE EXCEPTION 'cancellation state incorrect'; END IF;
   IF public.cancel_gtfs_ingest(workspace,version,command,delegate,'Synthetic cancellation') IS DISTINCT FROM saved THEN
    RAISE EXCEPTION 'cancellation replay changed receipt'; END IF;
   BEGIN
    PERFORM public.cancel_gtfs_ingest(workspace,version,command,delegate,'Changed synthetic cancellation');
    RAISE EXCEPTION 'changed terminal payload accepted';
   EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
   RESET ROLE;
   UPDATE public.workspace_members SET role='owner' WHERE workspace_id=workspace AND user_id=actor;
   SET LOCAL ROLE service_role;
  END IF;
  IF saved->>'cleanupPending' IS DISTINCT FROM (object_path IS NOT NULL)::text
   OR saved->'closure'->>'recorded' IS DISTINCT FROM 'true'
   OR saved->'closure'->>'feedStatusChanged' IS DISTINCT FROM 'false' THEN
   RAISE EXCEPTION 'terminal cleanup or feed receipt incorrect'; END IF;
  IF EXISTS(SELECT 1 FROM public.gtfs_route_service_levels WHERE feed_version_id=version)
   OR EXISTS(SELECT 1 FROM public.gtfs_stop_service_levels WHERE feed_version_id=version)
   OR EXISTS(SELECT 1 FROM public.gtfs_tract_service WHERE feed_version_id=version) THEN
   RAISE EXCEPTION 'terminal closure retained derived rows'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.gtfs_feed_versions WHERE id=version AND status='failed'
    AND ingest_closed_at IS NOT NULL AND route_service_level_rows=0 AND stop_service_level_rows=0
    AND tract_service_rows IS NULL AND tract_service_computed_at IS NULL AND NOT is_current) THEN
   RAISE EXCEPTION 'terminal public state incorrect'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.gtfs_feeds WHERE id=feed AND current_version_id=current_version
   AND status='ready' AND loaded_at=original_loaded) THEN RAISE EXCEPTION 'terminal closure changed current feed'; END IF;
  IF object_path IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.gtfs_ingest_storage_cleanup WHERE version_id=version AND storage_path=object_path) THEN
   RAISE EXCEPTION 'terminal archive cleanup omitted'; END IF;
  IF object_path IS NULL AND EXISTS(SELECT 1 FROM public.gtfs_ingest_storage_cleanup WHERE version_id=version) THEN
   RAISE EXCEPTION 'unprepared URL fabricated cleanup'; END IF;
  IF public.renew_gtfs_ingest(version,worker_token) IS NOT FALSE
   OR public.claim_gtfs_ingest(version,gen_random_uuid()) IS NOT NULL THEN RAISE EXCEPTION 'terminal import reclaimed'; END IF;
  BEGIN
   PERFORM public.cancel_gtfs_ingest(workspace,version,gen_random_uuid(),delegate,'Synthetic cancellation');
   RAISE EXCEPTION 'terminal import closed again';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
  FOR i IN 1..2 LOOP
   PERFORM set_config('role',CASE i WHEN 1 THEN 'anon' ELSE 'authenticated' END,true);
   IF mode=1 THEN
    BEGIN
     PERFORM public.fail_gtfs_ingest(version,worker_token,command,'partial_write','Synthetic failure');
     RAISE EXCEPTION 'client called failure';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
   ELSE
    BEGIN
     PERFORM public.cancel_gtfs_ingest(workspace,version,command,delegate,'Synthetic cancellation');
     RAISE EXCEPTION 'client called cancellation';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
   END IF;
  END LOOP;
  RESET ROLE;
  IF EXISTS(SELECT 1 FROM openplan_gtfs.write_context) THEN RAISE EXCEPTION 'terminal context leaked'; END IF;
  IF NOT EXISTS(SELECT 1 FROM openplan_gtfs.executions WHERE version_id=version
    AND state=CASE mode WHEN 1 THEN 'failed' ELSE 'cancelled' END AND token IS NULL AND lease_until IS NULL AND prepared_token IS NULL) THEN
   RAISE EXCEPTION 'terminal private state incorrect'; END IF;
  IF (SELECT count(*) FROM openplan_gtfs.terminal_receipts WHERE version_id=version)<>1 THEN RAISE EXCEPTION 'terminal receipt missing'; END IF;
  UPDATE public.workspace_members SET role='viewer' WHERE workspace_id=workspace AND user_id=CASE mode WHEN 1 THEN actor ELSE delegate END;
  SET LOCAL ROLE service_role;
  BEGIN
   IF mode=1 THEN PERFORM public.fail_gtfs_ingest(version,worker_token,command,'partial_write','Synthetic failure');
   ELSE PERFORM public.cancel_gtfs_ingest(workspace,version,command,delegate,'Synthetic cancellation'); END IF;
   RAISE EXCEPTION 'revoked actor recovered terminal receipt';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  UPDATE public.workspace_members SET role='owner' WHERE workspace_id=workspace AND user_id=CASE mode WHEN 1 THEN actor ELSE delegate END;
  SET LOCAL ROLE service_role;
 END LOOP;
 RESET ROLE;
 DELETE FROM public.gtfs_feeds WHERE id=feed;
 SET LOCAL ROLE service_role;
 IF public.cancel_gtfs_ingest(workspace,version,command,delegate,'Synthetic cancellation') IS DISTINCT FROM saved THEN
  RAISE EXCEPTION 'deleted feed terminal receipt lost'; END IF;
 RESET ROLE;
 DELETE FROM public.workspaces WHERE id IN (workspace,foreign_workspace);
 DELETE FROM public.census_tracts WHERE geoid=tract_geoid;
END $proof$;
