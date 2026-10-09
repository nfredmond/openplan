DO $proof$
DECLARE v uuid; w uuid; old_token uuid; new_token uuid:=gen_random_uuid(); receipt jsonb; rows jsonb;
BEGIN
 SELECT version_id,token INTO STRICT v,old_token FROM ownership_probe.gtfs_execution_probe;
 SELECT workspace_id INTO w FROM public.gtfs_feed_versions WHERE id=v;
 -- Isolate the cleanup test from a tract-computation claim: explicitly synthetic
 -- prior-attempt output, installed by the database-owner fixture under context.
 INSERT INTO ownership_probe.write_context(transaction_id,version_id,token,kind) VALUES(txid_current(),v,old_token,'tract');
 INSERT INTO public.gtfs_tract_service(workspace_id,feed_version_id,tract_geoid,service_day,stops_in_tract,stop_events_per_day,routes_serving)
 VALUES(w,v,'00000000000','monday',1,1,1);
 DELETE FROM ownership_probe.write_context WHERE version_id=v;
 UPDATE ownership_probe.gtfs_execution_probe SET lease_until=clock_timestamp()-interval '1 second' WHERE version_id=v;
 PERFORM ownership_probe.claim_gtfs_probe(v,new_token);
 rows:=jsonb_build_array(jsonb_build_object('workspace_id',w,'feed_version_id',v,
  'route_id','replacement','route_type',3,'service_day','monday','trips_per_day',1,'stops_served',1,
  'derivation_method','scheduled','scheduled_trips',1,'frequency_trips',0,
  'peak_headway_is_lower_bound',true,'median_headway_basis','not_determined_too_few_departures','departures_beyond_bin_range',0));
 SET LOCAL ROLE service_role;
 BEGIN
  PERFORM ownership_probe.write_batch_probe(v,new_token,gen_random_uuid(),'route',0,rows);
  RAISE EXCEPTION 'Unprepared replacement wrote batch';
 EXCEPTION WHEN SQLSTATE '55000' THEN
  IF SQLERRM<>'GTFS attempt not prepared' THEN RAISE; END IF;
 END;
 receipt:=ownership_probe.prepare_probe(v,new_token);
 IF receipt->>'removedRoutes' IS DISTINCT FROM '1' OR receipt->>'removedStops' IS DISTINCT FROM '1'
 OR receipt->>'removedTracts' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'Preparation omitted prior output'; END IF;
 PERFORM ownership_probe.write_batch_probe(v,new_token,gen_random_uuid(),'route',0,rows);
 IF ownership_probe.prepare_probe(v,new_token) IS DISTINCT FROM receipt THEN RAISE EXCEPTION 'Preparation replay changed receipt'; END IF;
 BEGIN
  PERFORM ownership_probe.prepare_probe(v,old_token);
  RAISE EXCEPTION 'Expired owner reset replacement';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 RESET ROLE;
 IF (SELECT count(*) FROM public.gtfs_route_service_levels WHERE feed_version_id=v)<>1 OR
    (SELECT route_id FROM public.gtfs_route_service_levels WHERE feed_version_id=v) IS DISTINCT FROM 'replacement' OR
    EXISTS(SELECT 1 FROM public.gtfs_stop_service_levels WHERE feed_version_id=v) OR
    EXISTS(SELECT 1 FROM public.gtfs_tract_service WHERE feed_version_id=v) THEN
  RAISE EXCEPTION 'Replacement output mixed or replay deleted new rows';
 END IF;
 IF (SELECT count(*) FROM ownership_probe.batch_receipt)<>3 OR
    (SELECT count(*) FROM ownership_probe.prepare_receipt)<>2 OR
    EXISTS(SELECT 1 FROM ownership_probe.write_context) THEN RAISE EXCEPTION 'Attempt history or context incorrect'; END IF;
END $proof$;
