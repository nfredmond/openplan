DO $$ BEGIN
 IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='public.node_queue_process_observations'::regclass)
 THEN RAISE EXCEPTION 'Process observations require enabled forced RLS'; END IF;
 IF has_table_privilege('anon','public.node_queue_process_observations','SELECT')
   OR has_table_privilege('authenticated','public.node_queue_process_observations','INSERT')
 THEN RAISE EXCEPTION 'Process table remains service-only'; END IF;
 IF has_function_privilege('anon','public.read_node_queue_process_observations()','EXECUTE')
   OR has_function_privilege('authenticated','public.record_node_queue_process_observation(text,uuid,bigint,text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'Process RPC remains service-only'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc WHERE oid IN (
   'public.read_node_queue_process_observations()'::regprocedure,
   'public.record_node_queue_process_observation(text,uuid,bigint,text,text)'::regprocedure) AND prosecdef)
 THEN RAISE EXCEPTION 'Process RPC preserves invoker authority'; END IF;
END $$;
SET LOCAL ROLE service_role;
DO $$ DECLARE
 identity uuid='00000000-0000-4000-8000-000000000001';seen timestamptz;started timestamptz;reading jsonb;
 BEGIN
 IF NOT public.record_node_queue_process_observation('provider-api',identity,1,'running',repeat('a',40))
 THEN RAISE EXCEPTION 'Original process observation must record'; END IF;
 SELECT last_seen_at,started_at INTO seen,started FROM public.node_queue_process_observations WHERE worker_kind='provider-api' AND instance_id=identity;
 PERFORM pg_sleep(.003);
 IF NOT public.record_node_queue_process_observation('provider-api',identity,1,'running',repeat('a',40))
 THEN RAISE EXCEPTION 'Original process replay must agree'; END IF;
 IF (SELECT last_seen_at FROM public.node_queue_process_observations WHERE worker_kind='provider-api' AND instance_id=identity) IS DISTINCT FROM seen
 THEN RAISE EXCEPTION 'Original replay cannot refresh process time'; END IF;
 IF public.record_node_queue_process_observation('provider-api',identity,2,'running',repeat('b',40))
 THEN RAISE EXCEPTION 'Changed build cannot replace process identity'; END IF;
 IF NOT public.record_node_queue_process_observation('provider-api',identity,2,'stopping',repeat('a',40))
 THEN RAISE EXCEPTION 'Original process can record stopping'; END IF;
 IF public.record_node_queue_process_observation('provider-api',identity,3,'running',repeat('a',40))
 THEN RAISE EXCEPTION 'Stopping process cannot become running'; END IF;
 IF NOT public.record_node_queue_process_observation('provider-api',identity,3,'stopped',repeat('a',40))
 THEN RAISE EXCEPTION 'Original process can record stopped'; END IF;
 IF public.record_node_queue_process_observation('provider-api',identity,4,'running',repeat('a',40))
 THEN RAISE EXCEPTION 'Stopped process cannot revive'; END IF;
 IF public.record_node_queue_process_observation('provider-api',identity,1,'running',repeat('a',40))
 THEN RAISE EXCEPTION 'Old sequence cannot replace process state'; END IF;
 IF (SELECT started_at FROM public.node_queue_process_observations WHERE worker_kind='provider-api' AND instance_id=identity) IS DISTINCT FROM started
 THEN RAISE EXCEPTION 'Original process start time remains retained'; END IF;
 reading=public.read_node_queue_process_observations();
 IF reading->>'scope'<>'process_only' OR reading->>'jobCompletion'<>'unassessed'
 THEN RAISE EXCEPTION 'Process observation cannot approve jobs'; END IF;
 IF (SELECT array_agg(item->>'kind' ORDER BY item->>'kind') FROM jsonb_array_elements(reading->'queues') item)
 IS DISTINCT FROM ARRAY['contract-calculations','document-exports','engagement-email','gtfs-ingestion','provider-api','synthesis-execution','synthesis-preparation','translation-generation']::text[]
 THEN RAISE EXCEPTION 'Process registry preserves every declared queue'; END IF;
 IF (SELECT item->>'state' FROM jsonb_array_elements(reading->'queues') item WHERE item->>'kind'='provider-api')<>'last_observed_stopped'
 THEN RAISE EXCEPTION 'Recorded stop remains a historical observation'; END IF;
 IF NOT public.record_node_queue_process_observation('provider-api','00000000-0000-4000-8000-000000000002',1,'running',NULL)
 THEN RAISE EXCEPTION 'New process identity can start'; END IF;
 reading=public.read_node_queue_process_observations();
 IF (SELECT item->>'state' FROM jsonb_array_elements(reading->'queues') item WHERE item->>'kind'='provider-api')<>'observed_running'
 THEN RAISE EXCEPTION 'Older stopped instance cannot hide a live observation'; END IF;
 PERFORM public.record_node_queue_process_observation('provider-api','00000000-0000-4000-8000-000000000006',1,'stopped',NULL);
 reading=public.read_node_queue_process_observations();
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(reading->'queues') item WHERE item->>'kind'='provider-api'
  AND item->>'state'='observed_running' AND item->>'lastState'='stopped' AND (item->>'runningInstances')::bigint=1)
 THEN RAISE EXCEPTION 'Mixed latest and active process states remain separate'; END IF;
 PERFORM public.record_node_queue_process_observation('engagement-email','00000000-0000-4000-8000-000000000007',1,'stopping',NULL);
 PERFORM public.record_node_queue_process_observation('engagement-email','00000000-0000-4000-8000-000000000008',1,'stopped',NULL);
 reading=public.read_node_queue_process_observations();
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(reading->'queues') item WHERE item->>'kind'='engagement-email'
  AND item->>'state'='observed_stopping' AND item->>'lastState'='stopped' AND (item->>'stoppingInstances')::bigint=1)
 THEN RAISE EXCEPTION 'Mixed latest and active process states remain separate'; END IF;
 IF (SELECT item->>'state' FROM jsonb_array_elements(reading->'queues') item WHERE item->>'kind'='document-exports')<>'unobserved'
 THEN RAISE EXCEPTION 'Missing process observation remains unobserved'; END IF;
 PERFORM public.record_node_queue_process_observation('translation-generation','00000000-0000-4000-8000-000000000003',1,'running',NULL);
 PERFORM public.record_node_queue_process_observation('gtfs-ingestion','00000000-0000-4000-8000-000000000004',1,'running',NULL);
END $$;
RESET ROLE;
UPDATE public.node_queue_process_observations SET last_seen_at=clock_timestamp()-interval '3 minutes' WHERE worker_kind='translation-generation';
UPDATE public.node_queue_process_observations SET last_seen_at=clock_timestamp()+interval '3 minutes' WHERE worker_kind='gtfs-ingestion';
SET LOCAL ROLE service_role;
DO $$ DECLARE reading jsonb=public.read_node_queue_process_observations(); BEGIN
 IF (SELECT item->>'state' FROM jsonb_array_elements(reading->'queues') item WHERE item->>'kind'='translation-generation')<>'stale'
 THEN RAISE EXCEPTION 'Old process observations remain stale'; END IF;
 IF (SELECT item->>'state' FROM jsonb_array_elements(reading->'queues') item WHERE item->>'kind'='gtfs-ingestion')<>'unknown'
 THEN RAISE EXCEPTION 'Future process observations remain unknown'; END IF;
END $$;
RESET ROLE;
-- Exercise RLS independently of the normal privilege denial, without persisting grants.
GRANT SELECT,INSERT,UPDATE ON public.node_queue_process_observations TO authenticated;
SET LOCAL ROLE authenticated;
DO $$ DECLARE changed integer; BEGIN
 IF (SELECT count(*) FROM public.node_queue_process_observations)<>0
 THEN RAISE EXCEPTION 'RLS keeps process observations unreadable'; END IF;
 BEGIN
   INSERT INTO public.node_queue_process_observations(worker_kind,instance_id,sequence,state)
     VALUES('provider-api','00000000-0000-4000-8000-000000000005',1,'running');
   RAISE EXCEPTION 'RLS keeps process observations unwritable';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 UPDATE public.node_queue_process_observations SET state='stopped';GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>0 THEN RAISE EXCEPTION 'RLS keeps process observations unchanged'; END IF;
END $$;
RESET ROLE;
