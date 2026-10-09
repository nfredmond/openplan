DO $proof$
DECLARE v uuid; f uuid; w uuid; relation text; role_name text; adopted_feed uuid:=gen_random_uuid(); adopted_version uuid:=gen_random_uuid();
BEGIN
 SELECT version_id INTO STRICT v FROM ownership_probe.gtfs_execution_probe;
 SELECT feed_id,workspace_id INTO f,w FROM public.gtfs_feed_versions WHERE id=v;
 -- Synthetic already-adopted fixture, enrolled only after its pointer exists.
 INSERT INTO public.gtfs_feeds(id,workspace_id,agency_name) VALUES(adopted_feed,w,'Synthetic adopted pointer');
 INSERT INTO public.gtfs_feed_versions(id,workspace_id,feed_id,source_kind,status,route_count,stop_count,route_service_level_rows,stop_service_level_rows,is_current)
 VALUES(adopted_version,w,adopted_feed,'upload','ready',1,1,1,1,true);
 UPDATE public.gtfs_feeds SET current_version_id=adopted_version WHERE id=adopted_feed;
 INSERT INTO ownership_probe.gtfs_execution_probe(version_id) VALUES(adopted_version);
 SET LOCAL ROLE service_role;
 BEGIN
  UPDATE public.gtfs_feeds SET current_version_id=v WHERE id=f;
  RAISE EXCEPTION 'Managed pointer changed directly';
 EXCEPTION WHEN SQLSTATE '55000' THEN
  IF SQLERRM<>'Managed feed pointer requires adoption command' THEN RAISE; END IF;
 END;
 BEGIN
  INSERT INTO public.gtfs_feeds(id,workspace_id,agency_name,current_version_id)
  VALUES(gen_random_uuid(),w,'Synthetic pointer bypass',v);
  RAISE EXCEPTION 'Managed pointer inserted directly';
 EXCEPTION WHEN SQLSTATE '55000' THEN
  IF SQLERRM<>'Managed feed pointer requires adoption command' THEN RAISE; END IF;
 END;
 BEGIN
  UPDATE public.gtfs_feeds SET current_version_id=NULL WHERE id=adopted_feed;
  RAISE EXCEPTION 'Managed adopted pointer cleared directly';
 EXCEPTION WHEN SQLSTATE '55000' THEN
  IF SQLERRM<>'Managed feed pointer requires adoption command' THEN RAISE; END IF;
 END;
 RESET ROLE;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  FOREACH relation IN ARRAY ARRAY['gtfs_feeds','gtfs_feed_versions','gtfs_route_service_levels','gtfs_stop_service_levels','gtfs_tract_service'] LOOP
   IF has_table_privilege(role_name,'public.'||relation,'TRUNCATE') THEN
    RAISE EXCEPTION 'Runtime role retains TRUNCATE privilege';
   END IF;
  END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.gtfs_feeds WHERE current_version_id=v) THEN RAISE EXCEPTION 'Pointer changed after refusal'; END IF;
END $proof$;
