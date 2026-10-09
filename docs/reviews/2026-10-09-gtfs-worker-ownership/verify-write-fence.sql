DO $proof$
DECLARE v uuid; w uuid; f uuid; t uuid; command uuid:=gen_random_uuid(); legacy uuid:=gen_random_uuid();
BEGIN
 SELECT version_id,token INTO STRICT v,t FROM ownership_probe.gtfs_execution_probe;
 SELECT workspace_id,feed_id INTO w,f FROM public.gtfs_feed_versions WHERE id=v;
 INSERT INTO public.gtfs_feed_versions(id,workspace_id,feed_id,source_kind,status)
 VALUES(legacy,w,f,'upload','pending');
 SET LOCAL ROLE service_role;
 BEGIN
  INSERT INTO public.gtfs_route_service_levels(workspace_id,feed_version_id,route_id,service_day,trips_per_day,derivation_method)
  VALUES(w,v,'direct','monday',1,'scheduled');
  RAISE EXCEPTION 'Direct managed insert accepted';
 EXCEPTION WHEN SQLSTATE '55000' THEN
  IF SQLERRM<>'Managed derived rows require owned batch command' THEN RAISE; END IF;
 END;
 BEGIN
  UPDATE public.gtfs_route_service_levels SET trips_per_day=2 WHERE feed_version_id=v;
  RAISE EXCEPTION 'Direct managed update accepted';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 BEGIN
  DELETE FROM public.gtfs_stop_service_levels WHERE feed_version_id=v;
  RAISE EXCEPTION 'Direct managed delete accepted';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 BEGIN
  UPDATE public.gtfs_route_service_levels SET feed_version_id=legacy WHERE feed_version_id=v;
  RAISE EXCEPTION 'Managed row moved to legacy version';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 BEGIN
  INSERT INTO ownership_probe.write_context VALUES(txid_current(),v,t,'route');
  RAISE EXCEPTION 'Service role forged command context';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE public.gtfs_feed_versions SET status='parsing' WHERE id=v;
  RAISE EXCEPTION 'Direct managed stage accepted';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 BEGIN
  PERFORM public.close_failed_gtfs_version(v,'partial_write','stale legacy worker');
  RAISE EXCEPTION 'Legacy failure closed managed version';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 BEGIN
  PERFORM public.reap_gtfs_feed_version(v,clock_timestamp()+interval '1 day');
  RAISE EXCEPTION 'Legacy reaper closed managed version';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 BEGIN
  DELETE FROM public.gtfs_feed_versions WHERE id=v;
  RAISE EXCEPTION 'Managed version deleted directly';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 -- Legacy rows retain their existing write behavior.
 INSERT INTO public.gtfs_route_service_levels(workspace_id,feed_version_id,route_id,service_day,trips_per_day,derivation_method)
 VALUES(w,legacy,'legacy','monday',1,'scheduled');
 UPDATE public.gtfs_route_service_levels SET trips_per_day=2 WHERE feed_version_id=legacy;
 DELETE FROM public.gtfs_route_service_levels WHERE feed_version_id=legacy;
 UPDATE public.gtfs_feed_versions SET status='parsing' WHERE id=legacy;
 RESET ROLE;
 IF (SELECT count(*) FROM ownership_probe.write_context)<>0 THEN RAISE EXCEPTION 'Command context leaked'; END IF;
 IF (SELECT count(*) FROM public.gtfs_route_service_levels WHERE feed_version_id=v)<>1 OR
    (SELECT count(*) FROM public.gtfs_stop_service_levels WHERE feed_version_id=v)<>1 OR
    (SELECT status FROM public.gtfs_feed_versions WHERE id=v) IS DISTINCT FROM 'pending' THEN
  RAISE EXCEPTION 'Refused legacy command changed managed data';
 END IF;
END $proof$;
