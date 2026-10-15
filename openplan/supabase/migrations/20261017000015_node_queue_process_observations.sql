-- Deployment-global event-loop observations, not tenant data or job completion.
-- Every process owns a fresh instance UUID. A stopped instance stays stopped,
-- even when an earlier network request reaches the database late.
BEGIN;

CREATE TABLE public.node_queue_process_observations (
  worker_kind text NOT NULL CHECK (worker_kind IN (
    'document-exports','engagement-email','provider-api','translation-generation',
    'synthesis-preparation','synthesis-execution','contract-calculations','gtfs-ingestion')),
  instance_id uuid NOT NULL,
  sequence bigint NOT NULL CHECK (sequence BETWEEN 1 AND 9007199254740991),
  state text NOT NULL CHECK (state IN ('running','stopping','stopped')),
  build_sha text CHECK (build_sha IS NULL OR build_sha ~ '^[a-f0-9]{7,40}$'),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (worker_kind,instance_id)
);
CREATE INDEX node_queue_process_observations_latest
  ON public.node_queue_process_observations(worker_kind,last_seen_at DESC,instance_id DESC);
ALTER TABLE public.node_queue_process_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.node_queue_process_observations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.node_queue_process_observations FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.node_queue_process_observations TO service_role;
COMMENT ON TABLE public.node_queue_process_observations IS
  'Private deployment-global process observations. No workspace, actor, payload or job identifier. A fresh running event loop is not evidence of queue progress, output quality or approval. Older instances remain retained; no cleanup or retention acceptance is claimed.';

CREATE FUNCTION public.record_node_queue_process_observation(
  p_worker_kind text,p_instance uuid,p_sequence bigint,p_state text,p_build_sha text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE saved public.node_queue_process_observations;
BEGIN
  IF p_worker_kind IS NULL OR p_worker_kind NOT IN (
      'document-exports','engagement-email','provider-api','translation-generation',
      'synthesis-preparation','synthesis-execution','contract-calculations','gtfs-ingestion')
      OR p_instance IS NULL OR p_sequence IS NULL OR p_sequence NOT BETWEEN 1 AND 9007199254740991
      OR p_state IS NULL OR p_state NOT IN ('running','stopping','stopped')
      OR (p_build_sha IS NOT NULL AND p_build_sha !~ '^[a-f0-9]{7,40}$') THEN
    RAISE EXCEPTION 'Node process observation fields differ' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.node_queue_process_observations AS original
    (worker_kind,instance_id,sequence,state,build_sha)
    VALUES(p_worker_kind,p_instance,p_sequence,p_state,p_build_sha)
  ON CONFLICT(worker_kind,instance_id) DO UPDATE
    SET sequence=EXCLUDED.sequence,state=EXCLUDED.state,last_seen_at=clock_timestamp()
    WHERE original.sequence<EXCLUDED.sequence AND original.state<>'stopped'
      AND (original.state<>'stopping' OR EXCLUDED.state IN ('stopping','stopped'))
      AND original.build_sha IS NOT DISTINCT FROM EXCLUDED.build_sha
    RETURNING original.* INTO saved;
  IF FOUND THEN RETURN true; END IF;
  SELECT * INTO saved FROM public.node_queue_process_observations
    WHERE worker_kind=p_worker_kind AND instance_id=p_instance;
  RETURN FOUND AND saved.sequence=p_sequence AND saved.state=p_state
    AND saved.build_sha IS NOT DISTINCT FROM p_build_sha;
END;
$$;
REVOKE ALL ON FUNCTION public.record_node_queue_process_observation(text,uuid,bigint,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_node_queue_process_observation(text,uuid,bigint,text,text)
  TO service_role;

CREATE FUNCTION public.read_node_queue_process_observations()
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$
  WITH stamp AS MATERIALIZED (SELECT clock_timestamp() AS observed_at),
  kinds(worker_kind) AS (VALUES
    ('document-exports'),('engagement-email'),('provider-api'),('translation-generation'),
    ('synthesis-preparation'),('synthesis-execution'),('contract-calculations'),('gtfs-ingestion'))
  SELECT jsonb_build_object('observedAt',stamp.observed_at,'scope','process_only',
    'jobCompletion','unassessed','queues',jsonb_agg(jsonb_build_object(
      'kind',kinds.worker_kind,'lastSeenAt',latest.last_seen_at,'lastState',latest.state,
      'runningInstances',alive.running_count,'stoppingInstances',alive.stopping_count,
      'state',CASE
        WHEN latest.last_seen_at>stamp.observed_at THEN 'unknown'
        WHEN alive.running_count>0 THEN 'observed_running'
        WHEN alive.stopping_count>0 THEN 'observed_stopping'
        WHEN latest.last_seen_at IS NULL THEN 'unobserved'
        WHEN latest.state='stopped' THEN 'last_observed_stopped'
        ELSE 'stale' END
    ) ORDER BY kinds.worker_kind))
  FROM kinds CROSS JOIN stamp
  LEFT JOIN LATERAL (
    SELECT last_seen_at,state FROM public.node_queue_process_observations
    WHERE worker_kind=kinds.worker_kind ORDER BY last_seen_at DESC,instance_id DESC LIMIT 1
  ) latest ON true
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER(WHERE state='running') AS running_count,
      count(*) FILTER(WHERE state='stopping') AS stopping_count
    FROM public.node_queue_process_observations WHERE worker_kind=kinds.worker_kind
      AND last_seen_at BETWEEN stamp.observed_at-interval '2 minutes' AND stamp.observed_at
  ) alive ON true
  GROUP BY stamp.observed_at;
$$;
REVOKE ALL ON FUNCTION public.read_node_queue_process_observations() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_node_queue_process_observations() TO service_role;
COMMIT;
