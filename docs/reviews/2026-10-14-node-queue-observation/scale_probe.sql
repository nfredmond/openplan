-- Synthetic query load only. This does not run business queues or measure their throughput.
INSERT INTO public.node_queue_process_observations(worker_kind,instance_id,sequence,state,last_seen_at)
SELECT 'provider-api',md5('retired-process-'||n)::uuid,1,'stopped',clock_timestamp()-interval '10 days'
FROM generate_series(1,10000) n;
INSERT INTO public.node_queue_process_observations(worker_kind,instance_id,sequence,state)
SELECT kind,md5(kind||'-current-process-'||n)::uuid,1,'running'
FROM unnest(ARRAY['document-exports','engagement-email','provider-api','translation-generation',
 'synthesis-preparation','synthesis-execution','contract-calculations','gtfs-ingestion']) kind
CROSS JOIN generate_series(1,32) n;
SET LOCAL ROLE service_role;
DO $$ DECLARE reading jsonb=public.read_node_queue_process_observations(); BEGIN
 IF jsonb_array_length(reading->'queues')<>8 OR EXISTS(
  SELECT 1 FROM jsonb_array_elements(reading->'queues') item
  WHERE item->>'state'<>'observed_running' OR (item->>'runningInstances')::bigint<>32 OR (item->>'stoppingInstances')::bigint<>0)
 THEN RAISE EXCEPTION 'Retired history cannot inflate active process counts'; END IF;
END $$;
EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT public.read_node_queue_process_observations();
RESET ROLE;
