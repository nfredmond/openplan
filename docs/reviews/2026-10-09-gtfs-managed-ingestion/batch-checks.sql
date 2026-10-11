DO $proof$
DECLARE workspace uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); version uuid; feed uuid;
 token uuid:=gen_random_uuid(); next_token uuid:=gen_random_uuid(); command uuid:=gen_random_uuid();
 source jsonb; archive jsonb; rows jsonb; stop_rows jsonb; receipt jsonb; preparation jsonb; bad_rows jsonb; plan jsonb;
BEGIN
 INSERT INTO auth.users(id,email) VALUES(actor,actor||'@example.invalid');
 INSERT INTO public.workspaces(id,name,slug) VALUES(workspace,'Synthetic managed batch','gtfs-batch-'||workspace);
 INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(workspace,actor,'owner');
 source:=jsonb_build_object('kind','upload','provisionalName','Synthetic batch source',
  'uploadSha256',repeat('d',64),'uploadBytes',123);
 plan:=jsonb_build_object('sha256',repeat('e',64),'bytes',100,'routeRows',2,'stopRows',1,'routeBatches',2,'stopBatches',1);
 SET LOCAL ROLE service_role;
 receipt:=public.admit_gtfs_ingest(gen_random_uuid(),workspace,actor,NULL,source);
 version:=(receipt->>'versionId')::uuid; feed:=(receipt->>'feedId')::uuid;
 archive:=jsonb_build_object('path',workspace||'/'||feed||'/'||version||'.zip','sha256',repeat('d',64),'bytes',123);
 PERFORM public.confirm_gtfs_archive(version,NULL,archive);
 PERFORM public.claim_gtfs_ingest(version,token);
 BEGIN
  PERFORM public.prepare_gtfs_derived(version,token,plan);
  RAISE EXCEPTION 'preparation accepted before parsing';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 PERFORM public.stage_gtfs_ingest(version,token,'parsing');
 rows:=jsonb_build_array(jsonb_build_object('workspace_id',workspace,'feed_version_id',version,
  'route_id','R','route_type',3,'service_day','monday','trips_per_day',1,'stops_served',1,
  'derivation_method','scheduled','scheduled_trips',1,'frequency_trips',0,
  'peak_headway_is_lower_bound',true,'median_headway_basis','not_determined_too_few_departures','departures_beyond_bin_range',0));
 stop_rows:=jsonb_build_array((rows->0)-'route_id'-'route_type'-'stops_served'||jsonb_build_object(
  'stop_id','S','stop_name','Synthetic stop','latitude',44,'longitude',-104,'routes_serving',1,'route_ids',jsonb_build_array('R')));
 BEGIN
  PERFORM public.write_gtfs_ingest_batch(version,token,command,'route',0,rows);
  RAISE EXCEPTION 'unprepared owner wrote batch';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 FOR bad_rows IN SELECT value FROM jsonb_array_elements('[{"bytes":"100"},{"bytes":100.5},{"bytes":0},{"routeBatches":3},{"sha256":"bad"},{"unexpected":true}]'::jsonb) LOOP
  BEGIN
   PERFORM public.prepare_gtfs_derived(version,token,plan||bad_rows);
   RAISE EXCEPTION 'invalid derived output plan accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 END LOOP;
 BEGIN
  PERFORM public.prepare_gtfs_derived(version,token,plan||jsonb_build_object('sha256',repeat('1',64)::numeric));
  RAISE EXCEPTION 'numeric derived digest accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 preparation:=public.prepare_gtfs_derived(version,token,plan);
 IF preparation->>'removedRoutes' IS DISTINCT FROM '0' THEN RAISE EXCEPTION 'initial preparation removed rows'; END IF;
 BEGIN
  PERFORM public.write_gtfs_ingest_batch(version,token,command,'route',1,rows);
  RAISE EXCEPTION 'batch ordinal gap accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 BEGIN
  PERFORM public.write_gtfs_ingest_batch(version,token,command,'route',0,
   jsonb_set(rows,'{0,workspace_id}','null'));
  RAISE EXCEPTION 'batch workspace scope change accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN
  IF SQLERRM<>'Batch row scope differs' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM public.write_gtfs_ingest_batch(version,token,command,'route',0,
   jsonb_set(rows,'{0,unexpected}','true'));
  RAISE EXCEPTION 'unexpected batch field accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN
  IF SQLERRM<>'Unexpected batch field' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM public.write_gtfs_ingest_batch(version,token,command,'route',0,'[]');
  RAISE EXCEPTION 'empty batch accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 SELECT jsonb_agg((rows->0)||jsonb_build_object('route_id','R'||i)) INTO bad_rows FROM generate_series(1,1001) i;
 BEGIN
  PERFORM public.write_gtfs_ingest_batch(version,token,command,'route',0,bad_rows);
  RAISE EXCEPTION 'oversized batch accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 receipt:=public.write_gtfs_ingest_batch(version,token,command,'route',0,rows);
 BEGIN
  PERFORM public.write_gtfs_ingest_batch(version,token,gen_random_uuid(),'route',1,
   jsonb_build_array((rows->0)||'{"route_id":"extra1"}'::jsonb,(rows->0)||'{"route_id":"extra2"}'::jsonb));
  RAISE EXCEPTION 'batch exceeded declared output plan';
 EXCEPTION WHEN SQLSTATE '22023' THEN
  IF SQLERRM<>'GTFS batch exceeds declared output plan' THEN RAISE; END IF;
 END;
 IF public.write_gtfs_ingest_batch(version,token,command,'route',0,rows) IS DISTINCT FROM receipt
  OR receipt->>'rows' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'batch replay changed receipt'; END IF;
 BEGIN
  PERFORM public.write_gtfs_ingest_batch(version,token,command,'route',0,jsonb_set(rows,'{0,trips_per_day}','2'));
  RAISE EXCEPTION 'changed batch replay accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN
  IF SQLERRM<>'Batch command payload changed' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM public.write_gtfs_ingest_batch(version,token,gen_random_uuid(),'route',0,jsonb_set(rows,'{0,route_id}','"other"'));
  RAISE EXCEPTION 'batch ordinal reused';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 PERFORM public.write_gtfs_ingest_batch(version,token,gen_random_uuid(),'stop',0,stop_rows);
 IF public.prepare_gtfs_derived(version,token,plan) IS DISTINCT FROM preparation THEN RAISE EXCEPTION 'preparation replay changed receipt'; END IF;
 IF (SELECT count(*) FROM public.gtfs_route_service_levels WHERE feed_version_id=version)<>1
  OR (SELECT count(*) FROM public.gtfs_stop_service_levels WHERE feed_version_id=version)<>1 THEN
  RAISE EXCEPTION 'preparation replay removed current rows'; END IF;
 BEGIN
  PERFORM public.prepare_gtfs_derived(version,token,plan||'{"bytes":101}'::jsonb);
  RAISE EXCEPTION 'changed derived output plan accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;

 BEGIN
  PERFORM public.write_gtfs_ingest_batch(version,next_token,gen_random_uuid(),'route',1,jsonb_set(rows,'{0,route_id}','"stale"'));
  RAISE EXCEPTION 'unowned batch accepted';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 BEGIN
  INSERT INTO openplan_gtfs.batch_receipts VALUES(gen_random_uuid(),version,token,'route',9,repeat('a',64),1);
  RAISE EXCEPTION 'service role forged batch receipt';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RESET ROLE;
 -- A synthetic prior tract row tests cleanup; it is not a tract-computation claim.
 INSERT INTO openplan_gtfs.write_context VALUES(txid_current(),version,'tract','INSERT',token);
 INSERT INTO public.gtfs_tract_service(workspace_id,feed_version_id,tract_geoid,service_day,stops_in_tract,stop_events_per_day,routes_serving)
 VALUES(workspace,version,'00000000000','monday',1,1,1);
 DELETE FROM openplan_gtfs.write_context WHERE version_id=version;
 UPDATE openplan_gtfs.executions SET lease_until=clock_timestamp()-interval '1 second' WHERE version_id=version;
 SET LOCAL ROLE service_role;
 PERFORM public.claim_gtfs_ingest(version,next_token);
 BEGIN
  PERFORM public.write_gtfs_ingest_batch(version,next_token,gen_random_uuid(),'route',0,rows);
  RAISE EXCEPTION 'unprepared replacement wrote batch';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 preparation:=public.prepare_gtfs_derived(version,next_token,plan);
 IF preparation->>'removedRoutes' IS DISTINCT FROM '1' OR preparation->>'removedStops' IS DISTINCT FROM '1'
  OR preparation->>'removedTracts' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'preparation omitted prior output'; END IF;
 PERFORM public.write_gtfs_ingest_batch(version,next_token,gen_random_uuid(),'route',0,jsonb_set(rows,'{0,route_id}','"replacement"'));
 BEGIN
  PERFORM public.prepare_gtfs_derived(version,token,plan);
  RAISE EXCEPTION 'stale preparation reset replacement';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 FOR i IN 1..2 LOOP
  PERFORM set_config('role',CASE i WHEN 1 THEN 'anon' ELSE 'authenticated' END,true);
  BEGIN
   PERFORM public.prepare_gtfs_derived(version,next_token,plan);
   RAISE EXCEPTION 'client called preparation';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
   PERFORM public.write_gtfs_ingest_batch(version,next_token,gen_random_uuid(),'route',1,jsonb_set(rows,'{0,route_id}','"client"'));
   RAISE EXCEPTION 'client called batch writer';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END LOOP;
 RESET ROLE;
 IF (SELECT count(*) FROM openplan_gtfs.prepare_receipts WHERE version_id=version)<>2 OR
    (SELECT count(*) FROM openplan_gtfs.batch_receipts WHERE version_id=version)<>3 OR
    EXISTS(SELECT 1 FROM openplan_gtfs.write_context) OR
    EXISTS(SELECT 1 FROM public.gtfs_stop_service_levels WHERE feed_version_id=version) OR
    EXISTS(SELECT 1 FROM public.gtfs_tract_service WHERE feed_version_id=version) OR
    (SELECT route_id FROM public.gtfs_route_service_levels WHERE feed_version_id=version) IS DISTINCT FROM 'replacement' THEN
  RAISE EXCEPTION 'replacement mixed attempts or lost history'; END IF;
 DELETE FROM public.workspaces WHERE id=workspace;
 IF EXISTS(SELECT 1 FROM openplan_gtfs.batch_receipts WHERE version_id=version)
   OR EXISTS(SELECT 1 FROM openplan_gtfs.prepare_receipts WHERE version_id=version) THEN
  RAISE EXCEPTION 'batch custody did not cascade'; END IF;
END $proof$;
