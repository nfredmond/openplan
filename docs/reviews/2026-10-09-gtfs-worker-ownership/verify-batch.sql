DO $proof$
DECLARE workspace uuid:=gen_random_uuid(); feed uuid:=gen_random_uuid(); version uuid:=gen_random_uuid();
 token uuid:=gen_random_uuid(); command uuid:=gen_random_uuid(); receipt jsonb; replay jsonb; rows jsonb; stop_rows jsonb;
BEGIN
 INSERT INTO public.workspaces(id,name,slug) VALUES(workspace,'Synthetic owned batch','proof-'||workspace);
 INSERT INTO public.gtfs_feeds(id,workspace_id,agency_name) VALUES(feed,workspace,'Synthetic owned batch');
 INSERT INTO public.gtfs_feed_versions(id,workspace_id,feed_id,source_kind,status) VALUES(version,workspace,feed,'upload','pending');
 INSERT INTO ownership_probe.gtfs_execution_probe(version_id) VALUES(version);
 PERFORM ownership_probe.claim_gtfs_probe(version,token);
 rows:=jsonb_build_array(jsonb_build_object('workspace_id',workspace,'feed_version_id',version,
  'route_id','R','route_type',3,'service_day','monday','trips_per_day',1,'stops_served',1,
  'derivation_method','scheduled','scheduled_trips',1,'frequency_trips',0,
  'peak_headway_is_lower_bound',true,'median_headway_basis','not_determined_too_few_departures','departures_beyond_bin_range',0));
 stop_rows:=(rows->0)-'route_id'-'route_type'-'stops_served'||jsonb_build_object(
  'stop_id','S','stop_name','Synthetic stop','latitude',44,'longitude',-104,'routes_serving',1,'route_ids',jsonb_build_array('R'));
 stop_rows:=jsonb_build_array(stop_rows);
 SET LOCAL ROLE service_role;
 receipt:=ownership_probe.write_batch_probe(version,token,command,'route',0,rows);
 replay:=ownership_probe.write_batch_probe(version,token,command,'route',0,rows);
 IF replay IS DISTINCT FROM receipt OR receipt->>'rows' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Batch retry did not recover exact receipt'; END IF;
 PERFORM ownership_probe.write_batch_probe(version,token,gen_random_uuid(),'stop',0,stop_rows);
 BEGIN
  PERFORM ownership_probe.write_batch_probe(version,token,command,'route',0,jsonb_set(rows,'{0,trips_per_day}','2'));
  RAISE EXCEPTION 'Changed batch payload accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN
  IF SQLERRM<>'Batch command payload changed' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM ownership_probe.write_batch_probe(version,token,gen_random_uuid(),'route',1,jsonb_set(rows,'{0,workspace_id}','null'));
  RAISE EXCEPTION 'Batch scope change accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN
  IF SQLERRM<>'Batch row scope differs' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM ownership_probe.write_batch_probe(version,gen_random_uuid(),gen_random_uuid(),'route',1,jsonb_set(rows,'{0,route_id}','"wrong-owner"'));
  RAISE EXCEPTION 'Wrong owner batch accepted';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 BEGIN
  PERFORM ownership_probe.write_batch_probe(version,token,gen_random_uuid(),'route',0,
    jsonb_set(rows,'{0,route_id}','"receipt-conflict"'));
  RAISE EXCEPTION 'Duplicate batch ordinal accepted';
 EXCEPTION WHEN unique_violation THEN
  IF SQLERRM NOT LIKE '%batch_receipt%' THEN RAISE; END IF;
 END;
 BEGIN
  INSERT INTO ownership_probe.batch_receipt VALUES(gen_random_uuid(),version,token,'route',90,'forged',1);
  RAISE EXCEPTION 'Service role forged receipt';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 SET LOCAL ROLE authenticated;
 BEGIN
  PERFORM ownership_probe.write_batch_probe(version,token,gen_random_uuid(),'route',1,jsonb_set(rows,'{0,route_id}','"authenticated"'));
  RAISE EXCEPTION 'Authenticated caller wrote batch';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 SET LOCAL ROLE anon;
 BEGIN
  PERFORM ownership_probe.write_batch_probe(version,token,gen_random_uuid(),'route',1,jsonb_set(rows,'{0,route_id}','"anonymous"'));
  RAISE EXCEPTION 'Anonymous caller wrote batch';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RESET ROLE;
 IF (SELECT count(*) FROM public.gtfs_route_service_levels WHERE feed_version_id=version)<>1 OR
    (SELECT count(*) FROM public.gtfs_stop_service_levels WHERE feed_version_id=version)<>1 OR
    (SELECT count(*) FROM ownership_probe.batch_receipt)<>2 THEN RAISE EXCEPTION 'Actual batch counts differ'; END IF;
 -- The public table remains directly writable by the service role. Do not enroll
 -- managed versions until a guarded command context also closes that bypass.
END $proof$;
