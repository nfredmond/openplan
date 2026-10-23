-- Proposed additive SQL only. ROOT assigns the migration identity with its CLI.
-- No historical migration is edited. Local legacy replacement, no lifecycle exception.
BEGIN;
CREATE TABLE public.model_population_checkpoint_receipts (
 request_id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 run_id uuid NOT NULL REFERENCES public.model_runs(id) ON DELETE RESTRICT,
 stage_id uuid NOT NULL REFERENCES public.model_run_stages(id) ON DELETE RESTRICT,
 deployment_id text NOT NULL, facts jsonb NOT NULL, checkpoint_sha256 text NOT NULL,
 context_json jsonb NOT NULL, origin_run jsonb NOT NULL,
 request_payload jsonb NOT NULL, response_payload jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(run_id,stage_id)
);
CREATE TABLE public.model_population_checkpoint_revocations (
 checkpoint_id uuid PRIMARY KEY REFERENCES public.model_population_checkpoint_receipts(request_id),
 actor_id uuid NOT NULL REFERENCES auth.users(id), reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.model_population_replacement_receipts (
 request_id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 source_run_id uuid NOT NULL REFERENCES public.model_runs(id) ON DELETE RESTRICT,
 checkpoint_id uuid NOT NULL REFERENCES public.model_population_checkpoint_receipts(request_id),
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 replacement_run_id uuid NOT NULL UNIQUE REFERENCES public.model_runs(id) ON DELETE RESTRICT,
 request_payload jsonb NOT NULL, response_payload jsonb NOT NULL,
 source_state jsonb NOT NULL, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(source_run_id,checkpoint_id,source_state)
);
ALTER TABLE public.model_population_checkpoint_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_population_checkpoint_revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_population_replacement_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.model_population_checkpoint_receipts,public.model_population_checkpoint_revocations,
 public.model_population_replacement_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_population_checkpoint BEFORE UPDATE OR DELETE ON public.model_population_checkpoint_receipts
 FOR EACH ROW EXECUTE FUNCTION public.refuse_model_recovery_receipt_mutation();
CREATE TRIGGER immutable_population_checkpoint_revocation BEFORE UPDATE OR DELETE ON public.model_population_checkpoint_revocations
 FOR EACH ROW EXECUTE FUNCTION public.refuse_model_recovery_receipt_mutation();
CREATE TRIGGER immutable_population_replacement BEFORE UPDATE OR DELETE ON public.model_population_replacement_receipts
 FOR EACH ROW EXECUTE FUNCTION public.refuse_model_recovery_receipt_mutation();
CREATE INDEX model_population_replacements_source_idx ON public.model_population_replacement_receipts(source_run_id);

-- Existing command/run/stage/checkpoint/member fences stay in their callers.
-- Context locks always use this order: models by UUID, scenario sets by UUID,
-- then entries by UUID. FOR SHARE conflicts with ordinary non-key UPDATEs.
-- Lock both producer and consumer contexts together before publication; retain
-- all locks until the enclosing insert/success transaction commits or aborts.
CREATE FUNCTION public.lock_model_population_context(p_runs uuid[]) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM m.id FROM public.models m WHERE m.id IN
  (SELECT r.model_id FROM public.model_runs r WHERE r.id=ANY(p_runs)) ORDER BY m.id FOR SHARE;
 PERFORM s.id FROM public.scenario_sets s WHERE s.id IN
  (SELECT r.scenario_set_id FROM public.model_runs r WHERE r.id=ANY(p_runs)) ORDER BY s.id FOR SHARE;
 PERFORM e.id FROM public.scenario_entries e WHERE e.id IN
  (SELECT r.scenario_entry_id FROM public.model_runs r WHERE r.id=ANY(p_runs)
   UNION SELECT s.baseline_entry_id FROM public.scenario_sets s JOIN public.model_runs r ON r.scenario_set_id=s.id
    WHERE r.id=ANY(p_runs)) ORDER BY e.id FOR SHARE;
END;
$$;
REVOKE ALL ON FUNCTION public.lock_model_population_context(uuid[]) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.model_population_input_context(p_run uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.lock_model_population_context(ARRAY[p_run]);
 RETURN (SELECT jsonb_build_object('workspace_id',r.workspace_id,'model_id',r.model_id,'project_id',r.project_id,
  'scenario_set_id',r.scenario_set_id,'scenario_entry_id',r.scenario_entry_id,'engine_key',r.engine_key,
  'corridor_geojson',r.corridor_geojson,'query_text',r.query_text,'assumptions',r.assumption_snapshot_json,
  'inputs',r.input_snapshot_json-ARRAY['commonPopulation','populationReplacement','launchedAt'],
  'model_config',m.config_json,'model_config_version',m.config_version,
  'entry_assumptions',e.assumptions_json,'baseline_entry_id',s.baseline_entry_id)
 FROM public.model_runs r JOIN public.models m ON m.id=r.model_id AND m.workspace_id=r.workspace_id
 JOIN public.scenario_sets s ON s.id=r.scenario_set_id AND s.workspace_id=r.workspace_id AND s.project_id=r.project_id
 JOIN public.scenario_entries e ON e.id=r.scenario_entry_id AND e.scenario_set_id=s.id
 WHERE r.id=p_run AND m.project_id=r.project_id AND m.scenario_set_id=s.id);
END;
$$;
REVOKE ALL ON FUNCTION public.model_population_input_context(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.model_population_checkpoint_lineage(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('schema','openplan.population-replacement.v1','checkpoint_id',c.request_id,
  'checkpoint_sha256',c.checkpoint_sha256,'source_run_id',c.run_id,'source_stage_id',c.stage_id,
  'source_attempt_id',NULL,'population_digest',c.facts->>'population_digest',
  'package_sha256',c.facts#>>'{inventory,manifest.json,sha256}') FROM public.model_population_checkpoint_receipts c WHERE c.request_id=p_id;
$$;
REVOKE ALL ON FUNCTION public.model_population_checkpoint_lineage(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.register_model_population_checkpoint(p_request_id uuid,p_workspace_id uuid,p_run_id uuid,
 p_stage_id uuid,p_deployment_id text,p_facts jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.model_runs%ROWTYPE; s public.model_run_stages%ROWTYPE; saved public.model_population_checkpoint_receipts%ROWTYPE;
 request jsonb; response jsonb; ctx jsonb; original public.model_runs%ROWTYPE; source_id uuid; profile jsonb; inherited jsonb; entry record;
BEGIN
 IF p_request_id IS NULL OR p_deployment_id IS NULL OR length(p_deployment_id) NOT BETWEEN 1 AND 200
  OR jsonb_typeof(p_facts)<>'object' OR octet_length(p_facts::text)>16777216
  OR p_facts-ARRAY['inputs','inputs_sha256','result_sha256','inventory','snapshot','population_digest','settings','publication_sha256']<>'{}'::jsonb
  OR NOT p_facts ?& ARRAY['inputs','inputs_sha256','result_sha256','inventory','snapshot','population_digest','settings','publication_sha256']
  OR coalesce(p_facts->>'inputs_sha256','') !~ '^[a-f0-9]{64}$'
  OR coalesce(p_facts->>'result_sha256','') !~ '^[a-f0-9]{64}$'
  OR coalesce(p_facts->>'population_digest','') !~ '^[a-f0-9]{64}$'
  OR coalesce(p_facts->>'publication_sha256','') !~ '^[a-f0-9]{64}$'
  OR coalesce(p_facts#>>'{snapshot,manifest_sha256}','') !~ '^[a-f0-9]{64}$'
  OR coalesce(p_facts#>>'{snapshot,manifest_size_bytes}','') !~ '^[1-9][0-9]*$'
  OR jsonb_typeof(p_facts->'snapshot') IS DISTINCT FROM 'object'
  OR (p_facts->'snapshot')-ARRAY['manifest_sha256','manifest_size_bytes']<>'{}'::jsonb
  OR p_facts#>>'{settings,schema}' IS DISTINCT FROM 'openplan.population-replacement-settings.v1' THEN
  RAISE EXCEPTION 'Invalid prospective population checkpoint' USING ERRCODE='23514';
 END IF;
 request:=jsonb_build_object('workspace_id',p_workspace_id,'run_id',p_run_id,'stage_id',p_stage_id,'deployment_id',p_deployment_id,'facts',p_facts);
 PERFORM pg_advisory_xact_lock(hashtextextended('population-register:'||p_request_id::text,0));
 SELECT * INTO r FROM public.model_runs WHERE id=p_run_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Population scope mismatch' USING ERRCODE='23514'; END IF;
 SELECT * INTO saved FROM public.model_population_checkpoint_receipts WHERE request_id=p_request_id;
 IF FOUND THEN
  IF saved.request_payload IS DISTINCT FROM request THEN RAISE EXCEPTION 'Population registration identity conflict' USING ERRCODE='23514'; END IF;
  RETURN saved.response_payload;
 END IF;
 SELECT * INTO s FROM public.model_run_stages WHERE id=p_stage_id AND run_id=r.id FOR UPDATE;
 IF NOT FOUND OR s.stage_name<>'AequilibraE Setup' OR s.status<>'running' OR r.status<>'running'
  OR s.attempt_managed OR r.attempt_managed OR s.active_attempt_id IS NOT NULL
  OR p_facts#>>'{inputs,run_id}' IS DISTINCT FROM r.id::text OR p_facts#>>'{inputs,stage_id}' IS DISTINCT FROM s.id::text
  OR p_facts#>>'{inputs,workspace_id}' IS DISTINCT FROM r.workspace_id::text
  OR r.input_snapshot_json#>>'{commonPopulation,custody}' IS DISTINCT FROM 'legacy_stage_snapshot'
  OR p_facts#>'{inputs,authority,request}' IS DISTINCT FROM r.input_snapshot_json->'commonPopulation'
  OR r.input_snapshot_json#>>'{commonPopulation,mode}' NOT IN('generate','reuse') THEN
  RAISE EXCEPTION 'Population checkpoint requires original local legacy authority' USING ERRCODE='23514';
 END IF;
 PERFORM public.read_common_population_stage_custody(r.workspace_id,r.id,s.id,NULL);
 ctx:=public.model_population_input_context(r.id);
 IF ctx IS NULL THEN RAISE EXCEPTION 'Population scientific scope unavailable' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(p_facts->'inventory') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_facts->'inventory'))<>10 THEN
  RAISE EXCEPTION 'Fixed complete package inventory required' USING ERRCODE='23514'; END IF;
 FOR entry IN SELECT * FROM jsonb_each(p_facts->'inventory') LOOP
  IF entry.key NOT IN('manifest.json','zone_attributes.csv','od_trip_matrix.csv','common_population/common_population.json',
    'common_population/households.csv','common_population/persons.csv','common_population/selected_zones.json',
    'common_population/diagnostics.json','common_population/source_manifest.json','common_population/source_zone_attributes.csv')
   OR entry.value->>'path' IS DISTINCT FROM entry.key OR coalesce(entry.value->>'sha256','') !~ '^[a-f0-9]{64}$'
   OR coalesce(entry.value->>'bytes','') !~ '^(0|[1-9][0-9]*)$' THEN
   RAISE EXCEPTION 'Population inventory descriptor differs' USING ERRCODE='23514'; END IF;
 END LOOP;
 source_id:=CASE WHEN r.input_snapshot_json#>>'{commonPopulation,mode}'='generate' THEN r.id
  ELSE (r.input_snapshot_json#>>'{commonPopulation,source,modelRunId}')::uuid END;
 SELECT * INTO original FROM public.model_runs WHERE id=source_id AND workspace_id=r.workspace_id;
 IF FOUND AND original.input_snapshot_json#>>'{commonPopulation,mode}'='restore_checkpoint' THEN
  IF original.status<>'succeeded' THEN RAISE EXCEPTION 'Completed replacement source required' USING ERRCODE='23514'; END IF;
  inherited:=public.read_model_population_origin(r.workspace_id,original.id);
  SELECT * INTO original FROM jsonb_populate_record(NULL::public.model_runs,inherited->'origin_run');
  source_id:=original.id;
 END IF;
 IF NOT FOUND OR original.project_id IS DISTINCT FROM r.project_id OR original.scenario_set_id IS DISTINCT FROM r.scenario_set_id
  OR original.engine_key<>'aequilibrae' OR original.input_snapshot_json#>>'{commonPopulation,mode}'<>'generate'
  OR original.input_snapshot_json#>>'{commonPopulation,custody}'<>'legacy_stage_snapshot'
  OR (source_id<>r.id AND original.status<>'succeeded' AND inherited IS NULL)
  OR p_facts#>>'{inputs,source_record,run_id}' IS DISTINCT FROM source_id::text
  OR p_facts#>>'{inputs,source_record,workspace_id}' IS DISTINCT FROM r.workspace_id::text THEN
  RAISE EXCEPTION 'Population original source differs' USING ERRCODE='23514';
 END IF;
 profile:=original.input_snapshot_json#>'{commonPopulation,sourceProfile}';
 IF profile IS NULL OR p_facts#>'{inputs,source_record,source_profile}' IS DISTINCT FROM profile THEN
  RAISE EXCEPTION 'Population original profile differs' USING ERRCODE='23514'; END IF;
 response:=jsonb_build_object('schema','openplan.population-replacement.v1','request_id',p_request_id,
  'outcome','checkpoint_registered','checkpoint_sha256',p_facts->>'result_sha256')||request;
 INSERT INTO public.model_population_checkpoint_receipts(request_id,workspace_id,run_id,stage_id,deployment_id,facts,checkpoint_sha256,
  context_json,origin_run,request_payload,response_payload) VALUES(p_request_id,p_workspace_id,p_run_id,p_stage_id,p_deployment_id,
  p_facts,p_facts->>'result_sha256',ctx,to_jsonb(original),request,response);
 RETURN response;
END;
$$;
REVOKE ALL ON FUNCTION public.register_model_population_checkpoint(uuid,uuid,uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_model_population_checkpoint(uuid,uuid,uuid,uuid,text,jsonb) TO service_role;

CREATE FUNCTION public.read_model_population_replacement_receipt(p_request_id uuid,p_workspace_id uuid,p_run_id uuid,p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE saved public.model_population_replacement_receipts%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id AND role IN('owner','admin') FOR SHARE NOWAIT)
  THEN RAISE EXCEPTION 'Population source access revoked' USING ERRCODE='42501'; END IF;
 SELECT * INTO saved FROM public.model_population_replacement_receipts WHERE request_id=p_request_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF saved.workspace_id<>p_workspace_id OR saved.source_run_id<>p_run_id OR saved.actor_id<>p_actor_id THEN
  RAISE EXCEPTION 'Population replacement identity conflict' USING ERRCODE='23514'; END IF;
 RETURN saved.response_payload;
END;
$$;
REVOKE ALL ON FUNCTION public.read_model_population_replacement_receipt(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_model_population_replacement_receipt(uuid,uuid,uuid,uuid) TO service_role;

CREATE FUNCTION public.inspect_model_population_replacement(p_workspace_id uuid,p_run_id uuid,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.model_runs%ROWTYPE; c public.model_population_checkpoint_receipts%ROWTYPE; abandoned_legacy boolean;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id AND role IN('owner','admin') FOR SHARE NOWAIT)
  THEN RAISE EXCEPTION 'Population source access revoked' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.model_runs WHERE id=p_run_id AND workspace_id=p_workspace_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Population scope mismatch' USING ERRCODE='23514'; END IF;
 abandoned_legacy:=r.status='cancelled' AND EXISTS(SELECT 1 FROM public.model_population_replacement_receipts rr
  JOIN public.model_run_recovery_receipts a ON a.run_id=rr.replacement_run_id
  WHERE rr.replacement_run_id=r.id AND a.response_payload->>'outcome'='execution_abandoned'
   AND a.prior_run->>'attempt_managed'='false'
   AND NOT EXISTS(SELECT 1 FROM public.model_stage_attempts x WHERE x.run_id=r.id));
 IF (r.attempt_managed AND NOT abandoned_legacy) OR r.input_snapshot_json#>>'{commonPopulation,custody}' IS DISTINCT FROM 'legacy_stage_snapshot' THEN
  RETURN jsonb_build_object('state','unavailable','reason','Managed replacement is unsupported on this installation; full-v1 support remains required.'); END IF;
 IF r.status<>'failed' AND NOT abandoned_legacy THEN RETURN jsonb_build_object('state','unavailable','reason','Replacement requires a reviewed failure or confirmed abandonment of a registered legacy replacement.'); END IF;
 SELECT cp.* INTO c FROM public.model_population_checkpoint_receipts cp WHERE cp.workspace_id=p_workspace_id AND
  (cp.run_id=p_run_id OR EXISTS(SELECT 1 FROM public.model_population_replacement_receipts rr
   WHERE rr.replacement_run_id=p_run_id AND rr.checkpoint_id=cp.request_id)) FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','unavailable','reason','No prospectively registered local population snapshot exists. Historical packages cannot be adopted. Managed and hosted snapshot transport remain full-v1 obligations.'); END IF;
 IF EXISTS(SELECT 1 FROM public.model_population_checkpoint_revocations WHERE checkpoint_id=c.request_id)
  OR c.context_json IS DISTINCT FROM public.model_population_input_context(r.id) THEN
  RETURN jsonb_build_object('state','unavailable','reason','Saved population access or scientific settings changed. No replacement is authorized.'); END IF;
 RETURN jsonb_build_object('state','available','checkpointId',c.request_id,'checkpointSha256',c.checkpoint_sha256,'engineKey',r.engine_key);
END;
$$;
REVOKE ALL ON FUNCTION public.inspect_model_population_replacement(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.inspect_model_population_replacement(uuid,uuid,uuid) TO service_role;

CREATE FUNCTION public.create_model_population_replacement(p_request_id uuid,p_workspace_id uuid,p_run_id uuid,p_actor_id uuid,
 p_expected_state jsonb,p_checkpoint_id uuid,p_checkpoint_sha256 text,p_reason text,p_acknowledged_new_run boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.model_runs%ROWTYPE; c public.model_population_checkpoint_receipts%ROWTYPE;
 request jsonb; response jsonb; saved public.model_population_replacement_receipts%ROWTYPE;
 new_id uuid:=gen_random_uuid(); names text[]; idx integer; snapshot jsonb; inspection jsonb;
BEGIN
 IF p_request_id IS NULL OR p_acknowledged_new_run IS DISTINCT FROM true OR p_reason IS NULL
  OR length(btrim(p_reason)) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Explicit replacement intent required' USING ERRCODE='23514'; END IF;
 request:=jsonb_build_object('workspace_id',p_workspace_id,'run_id',p_run_id,'actor_id',p_actor_id,'expected_state',p_expected_state,
  'checkpoint_id',p_checkpoint_id,'checkpoint_sha256',p_checkpoint_sha256,'reason',p_reason,'acknowledged_new_run',true);
 PERFORM pg_advisory_xact_lock(hashtextextended('population-replacement:'||p_request_id::text,0));
 SELECT * INTO r FROM public.model_runs WHERE id=p_run_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Population scope mismatch' USING ERRCODE='23514'; END IF;
 PERFORM public.read_model_population_replacement_receipt(p_request_id,p_workspace_id,p_run_id,p_actor_id);
 SELECT * INTO saved FROM public.model_population_replacement_receipts WHERE request_id=p_request_id;
 IF FOUND THEN
  IF saved.request_payload IS DISTINCT FROM request THEN RAISE EXCEPTION 'Population replacement identity conflict' USING ERRCODE='23514'; END IF;
  RETURN saved.response_payload;
 END IF;
 PERFORM id FROM public.model_run_stages WHERE run_id=p_run_id ORDER BY id FOR UPDATE;
 IF p_expected_state IS DISTINCT FROM public.model_recovery_expected_state(p_run_id) THEN
  RAISE EXCEPTION 'Population reviewed state changed' USING ERRCODE='40001'; END IF;
 inspection:=public.inspect_model_population_replacement(p_workspace_id,p_run_id,p_actor_id);
 IF inspection->>'state'<>'available' AND inspection->>'reason' LIKE 'Managed replacement is unsupported%' THEN
  RAISE EXCEPTION 'Managed population replacement unsupported' USING ERRCODE='0A000'; END IF;
 IF inspection->>'state'<>'available' OR inspection->>'checkpointId' IS DISTINCT FROM p_checkpoint_id::text
  OR inspection->>'checkpointSha256' IS DISTINCT FROM p_checkpoint_sha256 THEN
  RAISE EXCEPTION 'Population checkpoint unavailable or changed' USING ERRCODE='23514'; END IF;
 SELECT * INTO c FROM public.model_population_checkpoint_receipts WHERE request_id=p_checkpoint_id FOR SHARE;
 snapshot:=r.input_snapshot_json||jsonb_build_object('launchedAt',clock_timestamp(),
  'commonPopulation',jsonb_build_object('schema','openplan.common-population-request.v1','custody','legacy_stage_snapshot',
   'mode','restore_checkpoint','comparisonPolicy','fixed_population_auto_trip_change',
   'sourceProfile',c.origin_run#>'{input_snapshot_json,commonPopulation,sourceProfile}',
   'checkpoint',jsonb_build_object('id',c.request_id,'sha256',c.checkpoint_sha256),
   'source',coalesce(c.facts#>'{inputs,authority,request,source}','null'::jsonb)),
  'populationReplacement',jsonb_build_object('schema','openplan.population-replacement.v1','requestId',p_request_id,
   'checkpointId',c.request_id,'sourceRunId',p_run_id));
 -- Replacement fault anchor: run, complete stage set and receipt commit together.
 INSERT INTO public.model_runs(id,workspace_id,model_id,project_id,scenario_set_id,scenario_entry_id,engine_key,launch_source,
  status,run_title,query_text,corridor_geojson,input_snapshot_json,assumption_snapshot_json,created_by)
 VALUES(new_id,r.workspace_id,r.model_id,r.project_id,r.scenario_set_id,r.scenario_entry_id,r.engine_key,r.launch_source,
  'queued',left('Replacement using saved population: '||r.run_title,160),r.query_text,r.corridor_geojson,snapshot,r.assumption_snapshot_json,p_actor_id);
 names:=CASE r.engine_key WHEN 'aequilibrae' THEN ARRAY['AequilibraE Setup','Network Assignment','Artifact Extraction']
  WHEN 'behavioral_demand' THEN ARRAY['AequilibraE Setup','Network Assignment','Artifact Extraction','ActivitySim Bundle & Preflight','ActivitySim Network Assignment','Demand Model Agreement'] ELSE NULL END;
 IF names IS NULL THEN RAISE EXCEPTION 'Unsupported replacement engine' USING ERRCODE='23514'; END IF;
 FOR idx IN 1..cardinality(names) LOOP
  INSERT INTO public.model_run_stages(run_id,stage_name,sort_order,status) VALUES(new_id,names[idx],idx,'queued');
 END LOOP;
 response:=jsonb_build_object('schema','openplan.population-replacement.v1','request_id',p_request_id,'request_payload',request,
  'outcome','replacement_created','replacement_run_id',new_id,'engine_key',r.engine_key,'old_run_changed',false,'model_resumed',false);
 INSERT INTO public.model_population_replacement_receipts VALUES(p_request_id,p_workspace_id,p_run_id,p_checkpoint_id,p_actor_id,new_id,request,response,p_expected_state,clock_timestamp());
 RETURN response;
END;
$$;
REVOKE ALL ON FUNCTION public.create_model_population_replacement(uuid,uuid,uuid,uuid,jsonb,uuid,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_model_population_replacement(uuid,uuid,uuid,uuid,jsonb,uuid,text,text,boolean) TO service_role;

CREATE FUNCTION public.read_model_population_origin(p_workspace_id uuid,p_run_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.model_runs%ROWTYPE; c public.model_population_checkpoint_receipts%ROWTYPE; rr public.model_population_replacement_receipts%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.model_runs WHERE id=p_run_id AND workspace_id=p_workspace_id FOR SHARE;
 IF NOT FOUND OR r.status NOT IN('running','succeeded') OR r.attempt_managed
  OR r.input_snapshot_json#>>'{commonPopulation,mode}' IS DISTINCT FROM 'restore_checkpoint' THEN
  RAISE EXCEPTION 'Population replacement consumer incomplete' USING ERRCODE='23514'; END IF;
 SELECT * INTO rr FROM public.model_population_replacement_receipts WHERE replacement_run_id=r.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Population replacement receipt missing' USING ERRCODE='23514'; END IF;
 SELECT * INTO c FROM public.model_population_checkpoint_receipts WHERE request_id=rr.checkpoint_id FOR SHARE;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM public.model_population_checkpoint_revocations WHERE checkpoint_id=c.request_id)
  OR c.context_json IS DISTINCT FROM public.model_population_input_context(r.id)
  OR r.input_snapshot_json#>>'{commonPopulation,checkpoint,id}' IS DISTINCT FROM c.request_id::text
  OR r.input_snapshot_json#>>'{commonPopulation,checkpoint,sha256}' IS DISTINCT FROM c.checkpoint_sha256
  OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=r.workspace_id AND user_id=rr.actor_id AND role IN('owner','admin') FOR SHARE NOWAIT)
  OR NOT EXISTS(SELECT 1 FROM public.model_run_stages s JOIN public.model_stage_execution_starts x ON x.stage_id=s.id AND x.run_id=s.run_id
   WHERE s.run_id=r.id AND s.stage_name='AequilibraE Setup' AND s.status IN('running','succeeded') AND NOT s.attempt_managed AND s.active_attempt_id IS NULL) THEN
  RAISE EXCEPTION 'Population source access or settings revoked' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('schema','openplan.population-replacement.v1','registration',c.response_payload,
  'origin_run',c.origin_run,'lineage',public.model_population_checkpoint_lineage(c.request_id));
END;
$$;
REVOKE ALL ON FUNCTION public.read_model_population_origin(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_model_population_origin(uuid,uuid) TO service_role;

CREATE FUNCTION public.revoke_model_population_checkpoint(p_workspace_id uuid,p_checkpoint_id uuid,p_actor_id uuid,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.model_population_checkpoint_receipts%ROWTYPE;
BEGIN
 IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Revocation reason required'; END IF;
 SELECT * INTO c FROM public.model_population_checkpoint_receipts WHERE request_id=p_checkpoint_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id AND role IN('owner','admin') FOR SHARE NOWAIT)
  THEN RAISE EXCEPTION 'Population checkpoint access denied' USING ERRCODE='42501'; END IF;
 INSERT INTO public.model_population_checkpoint_revocations(checkpoint_id,actor_id,reason) VALUES(c.request_id,p_actor_id,p_reason);
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_model_population_checkpoint(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_model_population_checkpoint(uuid,uuid,uuid,text) TO service_role;

-- The source request remains immutable even before the new run starts.
CREATE FUNCTION public.guard_model_population_replacement_inputs() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.input_snapshot_json ? 'populationReplacement' AND (
  NEW.input_snapshot_json IS DISTINCT FROM OLD.input_snapshot_json OR NEW.model_id IS DISTINCT FROM OLD.model_id
  OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.project_id IS DISTINCT FROM OLD.project_id
  OR NEW.scenario_set_id IS DISTINCT FROM OLD.scenario_set_id OR NEW.scenario_entry_id IS DISTINCT FROM OLD.scenario_entry_id
  OR NEW.corridor_geojson IS DISTINCT FROM OLD.corridor_geojson OR NEW.query_text IS DISTINCT FROM OLD.query_text
  OR NEW.assumption_snapshot_json IS DISTINCT FROM OLD.assumption_snapshot_json OR NEW.engine_key IS DISTINCT FROM OLD.engine_key) THEN
  RAISE EXCEPTION 'Registered replacement inputs are immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_model_population_replacement_inputs() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_model_population_replacement_inputs BEFORE UPDATE ON public.model_runs
 FOR EACH ROW EXECUTE FUNCTION public.guard_model_population_replacement_inputs();

-- Fresh source access is enforced within the actual insert/success transaction.
CREATE FUNCTION public.guard_model_population_replacement_publication() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE scoped_run uuid; r public.model_runs%ROWTYPE; source uuid; origin jsonb; row_json jsonb:=to_jsonb(NEW);
 filename text; descriptor jsonb; kind text; metadata jsonb; kinds text[]:=ARRAY['common_population','common_population_households','common_population_persons',
 'common_population_selected_zones','common_population_diagnostics','common_population_source_manifest','common_population_source_zone_attributes'];
BEGIN
 scoped_run:=NEW.run_id;
 SELECT * INTO r FROM public.model_runs WHERE id=scoped_run FOR SHARE;
 IF r.input_snapshot_json#>>'{commonPopulation,mode}'='restore_checkpoint' THEN source:=r.id;
 ELSIF r.input_snapshot_json#>>'{commonPopulation,mode}'='reuse' THEN
  SELECT id INTO source FROM public.model_runs WHERE id=(r.input_snapshot_json#>>'{commonPopulation,source,modelRunId}')::uuid
   AND input_snapshot_json#>>'{commonPopulation,mode}'='restore_checkpoint';
 END IF;
 IF source IS NOT NULL AND ((TG_TABLE_NAME='model_run_artifacts' AND row_json->>'artifact_type' LIKE 'common_population%')
  OR (TG_TABLE_NAME='model_run_stages' AND row_json->>'status'='succeeded')) THEN
  PERFORM public.lock_model_population_context(ARRAY[r.id,source]);
  origin:=public.read_model_population_origin(r.workspace_id,source);
  IF TG_TABLE_NAME='model_run_artifacts' AND row_json#>'{metadata_json,replacement}' IS DISTINCT FROM origin->'lineage' THEN
   RAISE EXCEPTION 'Population publication lineage differs' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='model_run_artifacts' THEN
   kind:=row_json->>'artifact_type'; metadata:=row_json->'metadata_json';
   filename:=CASE kind WHEN 'common_population' THEN 'common_population.json' WHEN 'common_population_households' THEN 'households.csv'
    WHEN 'common_population_persons' THEN 'persons.csv' WHEN 'common_population_selected_zones' THEN 'selected_zones.json'
    WHEN 'common_population_diagnostics' THEN 'diagnostics.json' WHEN 'common_population_source_manifest' THEN 'source_manifest.json'
    WHEN 'common_population_source_zone_attributes' THEN 'source_zone_attributes.csv' ELSE NULL END;
   descriptor:=(origin#>'{registration,facts,inventory}')->('common_population/'||filename);
   IF filename IS NULL OR descriptor IS NULL OR row_json->>'content_hash' IS DISTINCT FROM descriptor->>'sha256'
    OR row_json->'file_size_bytes' IS DISTINCT FROM descriptor->'bytes'
    OR metadata->>'population_basis_digest' IS DISTINCT FROM origin#>>'{lineage,population_digest}'
    OR metadata->>'scientific_acceptance' IS DISTINCT FROM 'unassessed'
    OR NOT EXISTS(SELECT 1 FROM public.model_run_stages WHERE id=NEW.stage_id AND run_id=r.id AND stage_name='AequilibraE Setup' AND status='running')
    OR EXISTS(SELECT 1 FROM public.model_run_artifacts WHERE run_id=r.id AND stage_id=NEW.stage_id AND artifact_type=kind) THEN
    RAISE EXCEPTION 'Population publication differs from registered member' USING ERRCODE='23514'; END IF;
  ELSIF row_json->>'stage_name'='AequilibraE Setup' THEN
   IF (SELECT count(*) FROM public.model_run_artifacts a WHERE a.run_id=r.id AND a.stage_id=NEW.id AND a.artifact_type=ANY(kinds))<>7
    OR EXISTS(SELECT 1 FROM unnest(kinds) expected WHERE (SELECT count(*) FROM public.model_run_artifacts a
       WHERE a.run_id=r.id AND a.stage_id=NEW.id AND a.artifact_type=expected AND a.metadata_json->'replacement'=origin->'lineage')<>1) THEN
    RAISE EXCEPTION 'Setup success requires seven registered population members' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_model_population_replacement_publication() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_model_population_replacement_publication BEFORE INSERT ON public.model_run_artifacts
 FOR EACH ROW EXECUTE FUNCTION public.guard_model_population_replacement_publication();
CREATE TRIGGER guard_model_population_replacement_success BEFORE UPDATE ON public.model_run_stages
 FOR EACH ROW WHEN(NEW.status='succeeded') EXECUTE FUNCTION public.guard_model_population_replacement_publication();

-- Add the new data-origin mode without changing old live-stage or lifecycle rules.
ALTER FUNCTION public.read_common_population_stage_custody(uuid,uuid,uuid,uuid) RENAME TO read_common_population_stage_custody_before_replacement;
REVOKE ALL ON FUNCTION public.read_common_population_stage_custody_before_replacement(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.read_common_population_stage_custody(p_workspace uuid,p_run uuid,p_stage uuid,p_artifact uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.model_runs%ROWTYPE; s public.model_run_stages%ROWTYPE; a public.model_run_artifacts%ROWTYPE; data jsonb;
BEGIN
 SELECT * INTO r FROM public.model_runs WHERE id=p_run AND workspace_id=p_workspace FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Population scope mismatch' USING ERRCODE='23514'; END IF;
 IF r.input_snapshot_json#>>'{commonPopulation,mode}' IS DISTINCT FROM 'restore_checkpoint' THEN
  RETURN public.read_common_population_stage_custody_before_replacement(p_workspace,p_run,p_stage,p_artifact); END IF;
 data:=public.read_model_population_origin(p_workspace,p_run);
 SELECT * INTO s FROM public.model_run_stages WHERE id=p_stage AND run_id=p_run FOR SHARE;
 IF NOT FOUND OR s.attempt_managed OR s.active_attempt_id IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM public.model_stage_execution_starts WHERE stage_id=s.id AND run_id=r.id)
  OR (p_artifact IS NULL AND (r.status<>'running' OR s.status<>'running' OR s.stage_name NOT IN('AequilibraE Setup','ActivitySim Bundle & Preflight')))
  OR (p_artifact IS NOT NULL AND s.status<>'succeeded') THEN RAISE EXCEPTION 'Population stage custody differs' USING ERRCODE='23514'; END IF;
 IF p_artifact IS NOT NULL THEN
  SELECT * INTO a FROM public.model_run_artifacts WHERE id=p_artifact AND run_id=p_run AND stage_id=p_stage FOR SHARE;
  IF NOT FOUND OR a.attempt_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.model_legacy_artifact_receipts x
    WHERE x.artifact_id=a.id AND x.run_id=p_run AND x.response_payload=to_jsonb(a)
    AND x.request_payload=jsonb_build_object('workspace_id',r.workspace_id,'payload',jsonb_build_object(
     'id',a.id,'run_id',a.run_id,'stage_id',a.stage_id,'artifact_type',a.artifact_type,'file_url',a.file_url,
     'file_size_bytes',a.file_size_bytes,'content_hash',a.content_hash,'metadata_json',a.metadata_json)))
    OR coalesce(a.content_hash,'') !~ '^[a-f0-9]{64}$' OR a.file_size_bytes IS NULL OR a.file_size_bytes<=0
    OR a.file_url IS NULL OR length(btrim(a.file_url))=0
    OR NOT ((s.stage_name='AequilibraE Setup' AND a.artifact_type IN('common_population','common_population_households','common_population_persons',
     'common_population_selected_zones','common_population_diagnostics','common_population_source_manifest','common_population_source_zone_attributes'))
     OR (s.stage_name='Artifact Extraction' AND a.artifact_type='link_volumes')
     OR (s.stage_name='ActivitySim Network Assignment' AND a.artifact_type='activitysim_link_volumes')) THEN
   RAISE EXCEPTION 'Population exact output receipt differs' USING ERRCODE='23514'; END IF;
  IF a.artifact_type LIKE 'common_population%' AND a.metadata_json->'replacement' IS DISTINCT FROM data->'lineage' THEN
   RAISE EXCEPTION 'Population output lineage differs' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN jsonb_build_object('schema','openplan.common-population-stage-custody.v1','custody','legacy_stage_snapshot',
  'workspace_id',p_workspace,'run_id',p_run,'stage_id',p_stage,'artifact_id',p_artifact,'eligible',true);
END;
$$;
REVOKE ALL ON FUNCTION public.read_common_population_stage_custody(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_common_population_stage_custody(uuid,uuid,uuid,uuid) TO service_role;
-- Preserve all existing comparison checks and admit the explicit completed origin.
CREATE OR REPLACE FUNCTION public.validate_common_population_comparison()
RETURNS pg_catalog.trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_snapshot public.scenario_comparison_snapshots%ROWTYPE;
  v_set public.scenario_sets%ROWTYPE;
  v_source_run public.model_runs%ROWTYPE;
  v_source_artifact public.model_run_artifacts%ROWTYPE;
  v_companion public.model_run_artifacts%ROWTYPE;
  v_source_stage public.model_run_stages%ROWTYPE;
  v_run public.model_runs%ROWTYPE;
  v_artifact public.model_run_artifacts%ROWTYPE;
  v_stage public.model_run_stages%ROWTYPE;
  v_invoker pg_catalog.text := COALESCE(NULLIF(pg_catalog.current_setting('role', true), 'none'), SESSION_USER);
  v_claim pg_catalog.jsonb;
  v_source pg_catalog.jsonb;
  v_basis pg_catalog.jsonb;
  v_profile pg_catalog.jsonb;
  v_expected_profile pg_catalog.jsonb;
  v_descriptor pg_catalog.jsonb;
  v_counts pg_catalog.jsonb;
  v_links pg_catalog.jsonb;
  v_link pg_catalog.jsonb;
  v_request pg_catalog.jsonb;
  v_payload pg_catalog.text;
  v_digest pg_catalog.text;
  v_key pg_catalog.text;
  v_custody pg_catalog.text;
  v_source_directory pg_catalog.text;
  v_filename pg_catalog.text;
  v_path pg_catalog.text;
  v_previous_zone pg_catalog.numeric := 0;
  v_year pg_catalog.int4;
  v_replacement pg_catalog.jsonb;
  v_link_replacement pg_catalog.jsonb;
BEGIN
  IF TG_NARGS <> 0 OR TG_TABLE_SCHEMA <> 'public' OR TG_OP NOT IN ('INSERT', 'UPDATE') THEN
    RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'scenario_comparison_model_run_links' THEN
    SELECT snapshot.* INTO v_snapshot FROM public.scenario_comparison_snapshots snapshot
      WHERE snapshot.id = NEW.comparison_snapshot_id;
  ELSIF TG_TABLE_NAME = 'scenario_comparison_snapshots' THEN
    v_snapshot := NEW;
    IF TG_OP = 'UPDATE' AND NEW.metadata_json->'commonPopulation' IS NOT DISTINCT FROM OLD.metadata_json->'commonPopulation'
      AND NOT (OLD.status = 'draft' AND NEW.status = 'ready') THEN RETURN NEW; END IF;
  ELSE
    RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514';
  END IF;
  v_claim := v_snapshot.metadata_json->'commonPopulation';
  IF v_claim->>'schema' IS DISTINCT FROM 'openplan.common-population-comparison.v1'
    OR v_claim->>'comparisonPolicy' IS DISTINCT FROM 'fixed_population_auto_trip_change' THEN RETURN NEW; END IF;

  -- Resolve the actual parent and authorize before reading protected source rows.
  -- The service/migration owner retains its existing trigger path; ordinary roles
  -- need current writer membership. Original table RLS still checks the write.
  SELECT scenario_set.* INTO v_set FROM public.scenario_sets scenario_set
    JOIN public.projects project ON project.id = scenario_set.project_id AND project.workspace_id = scenario_set.workspace_id
    WHERE scenario_set.id = v_snapshot.scenario_set_id AND scenario_set.project_id IS NOT NULL
      AND (v_invoker IN ('postgres', 'service_role') OR EXISTS (
        SELECT 1 FROM public.workspace_members member WHERE member.workspace_id = scenario_set.workspace_id
          AND member.user_id = auth.uid() AND member.role IN ('owner', 'admin', 'member')));
  IF NOT FOUND OR v_set.baseline_entry_id IS DISTINCT FROM v_snapshot.baseline_entry_id
    OR NOT EXISTS (SELECT 1 FROM public.scenario_entries entry WHERE entry.id = v_snapshot.baseline_entry_id
      AND entry.scenario_set_id = v_set.id AND entry.entry_type = 'baseline')
    OR NOT EXISTS (SELECT 1 FROM public.scenario_entries entry WHERE entry.id = v_snapshot.candidate_entry_id
      AND entry.scenario_set_id = v_set.id AND entry.entry_type = 'alternative'
      AND entry.assumptions_json->'guidedProjectChange'->>'kind' = 'assigned_auto_trip_change_pct') THEN
    RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514';
  END IF;
  IF pg_catalog.jsonb_typeof(v_claim) IS DISTINCT FROM 'object'
    OR NOT v_claim ?& ARRAY['schema','custody','comparisonPolicy','sourceRunId','source','manifest','populationBasis','populationBasisDigest']
    OR v_claim - ARRAY['schema','custody','comparisonPolicy','sourceRunId','source','manifest','populationBasis','populationBasisDigest'] <> '{}'::pg_catalog.jsonb
    OR v_claim->>'custody' IS NULL OR v_claim->>'custody' NOT IN ('managed_attempt','legacy_stage_snapshot') THEN
    RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514';
  END IF;
  v_source := v_claim->'source';
  v_custody := v_claim->>'custody';
  v_basis := v_claim->'populationBasis';
  v_digest := v_claim->>'populationBasisDigest';
  IF pg_catalog.jsonb_typeof(v_source) IS DISTINCT FROM 'object'
    OR NOT v_source ?& ARRAY['modelRunId','artifactId','stageId','attemptId','sha256','sizeBytes']
    OR v_source - ARRAY['modelRunId','artifactId','stageId','attemptId','sha256','sizeBytes'] <> '{}'::pg_catalog.jsonb
    OR v_claim->>'sourceRunId' IS DISTINCT FROM v_source->>'modelRunId'
    OR pg_catalog.jsonb_typeof(v_claim->'populationBasisDigest') IS DISTINCT FROM 'string'
    OR COALESCE(v_digest, '') !~ '^[a-f0-9]{64}$'
    OR pg_catalog.jsonb_typeof(v_basis) IS DISTINCT FROM 'object'
    OR NOT v_basis ?& ARRAY['schema','manifest','source_profile','universe','exclusions','selected_zone_map','realized_zone_counts','source_manifest']
    OR v_basis - ARRAY['schema','manifest','source_profile','universe','exclusions','selected_zone_map','realized_zone_counts','source_manifest'] <> '{}'::pg_catalog.jsonb
    OR v_basis->>'schema' IS DISTINCT FROM 'openplan.common-population-identity.v1'
    OR v_basis->>'universe' IS DISTINCT FROM 'household_residents'
    OR v_basis->'exclusions' IS DISTINCT FROM '{"group_quarters":"excluded_unassessed","full_population_coverage":"unassessed"}'::pg_catalog.jsonb
    OR v_claim->'manifest' IS DISTINCT FROM v_basis->'manifest' THEN
    RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514';
  END IF;
  FOREACH v_key IN ARRAY ARRAY['modelRunId','artifactId','stageId'] LOOP
    IF pg_catalog.jsonb_typeof(v_source->v_key) IS DISTINCT FROM 'string'
      OR COALESCE(v_source->>v_key, '') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN
      RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF (v_custody = 'legacy_stage_snapshot' AND v_source->'attemptId' IS DISTINCT FROM 'null'::pg_catalog.jsonb)
    OR (v_custody = 'managed_attempt' AND (pg_catalog.jsonb_typeof(v_source->'attemptId') IS DISTINCT FROM 'string'
      OR COALESCE(v_source->>'attemptId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')) THEN
    RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514';
  END IF;
  FOREACH v_key IN ARRAY ARRAY['manifest','selected_zone_map','source_manifest'] LOOP
    v_descriptor := v_basis->v_key;
    v_path := CASE v_key WHEN 'manifest' THEN 'common_population.json' WHEN 'selected_zone_map' THEN 'selected_zones.json' ELSE 'source_manifest.json' END;
    IF pg_catalog.jsonb_typeof(v_descriptor) IS DISTINCT FROM 'object'
      OR NOT v_descriptor ?& ARRAY['path','sha256','bytes'] OR v_descriptor - ARRAY['path','sha256','bytes'] <> '{}'::pg_catalog.jsonb
      OR v_descriptor->>'path' IS DISTINCT FROM v_path OR pg_catalog.jsonb_typeof(v_descriptor->'sha256') IS DISTINCT FROM 'string'
      OR COALESCE(v_descriptor->>'sha256', '') !~ '^[a-f0-9]{64}$'
      OR pg_catalog.jsonb_typeof(v_descriptor->'bytes') IS DISTINCT FROM 'number'
      OR COALESCE(v_descriptor->>'bytes', '') !~ '^[1-9][0-9]*$' THEN
      RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514';
    END IF;
    IF (v_descriptor->>'bytes')::pg_catalog.numeric > 9007199254740991 THEN
      RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF pg_catalog.jsonb_typeof(v_source->'sha256') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(v_source->'sizeBytes') IS DISTINCT FROM 'number'
    OR v_source->'sha256' IS DISTINCT FROM v_basis->'manifest'->'sha256'
    OR v_source->'sizeBytes' IS DISTINCT FROM v_basis->'manifest'->'bytes' THEN
    RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514';
  END IF;

  -- This adapter profile mirrors the retained library's explicit 2022/2023 contracts.
  v_profile := v_basis->'source_profile';
  IF v_profile->>'income_dollar_year' NOT IN ('2022','2023') OR v_profile->>'income_dollar_year' IS NULL THEN
    RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514';
  END IF;
  v_year := (v_profile->>'income_dollar_year')::pg_catalog.int4;
  v_expected_profile := pg_catalog.jsonb_build_object('adapter','us_census_acs5_pums',
    'acs_summary_endpoint','https://api.census.gov/data/'||v_year||'/acs/acs5',
    'pums_endpoint','https://api.census.gov/data/'||v_year||'/acs/acs5/pums',
    'sample_years',pg_catalog.jsonb_build_array(v_year-4,v_year),'income_dollar_year',v_year,
    'puma_fields',CASE v_year WHEN 2023 THEN '{"2020":"PUMA"}'::pg_catalog.jsonb ELSE '{"2020":"PUMA20","2010":"PUMA10"}'::pg_catalog.jsonb END);
  IF public.model_truth_canonical_jsonb(v_profile) IS DISTINCT FROM public.model_truth_canonical_jsonb(v_expected_profile) THEN
    RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514';
  END IF;
  IF pg_catalog.jsonb_typeof(v_basis->'realized_zone_counts') IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_array_length(v_basis->'realized_zone_counts') = 0 THEN
    RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514';
  END IF;
  FOR v_counts IN SELECT item FROM pg_catalog.jsonb_array_elements(v_basis->'realized_zone_counts') AS elements(item) LOOP
    IF pg_catalog.jsonb_typeof(v_counts) IS DISTINCT FROM 'object' OR NOT v_counts ?& ARRAY['zone_id','households','persons','workers']
      OR v_counts - ARRAY['zone_id','households','persons','workers'] <> '{}'::pg_catalog.jsonb THEN
      RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514';
    END IF;
    FOREACH v_key IN ARRAY ARRAY['zone_id','households','persons','workers'] LOOP
      IF pg_catalog.jsonb_typeof(v_counts->v_key) IS DISTINCT FROM 'number' OR COALESCE(v_counts->>v_key, '') !~ '^(0|[1-9][0-9]*)$' THEN
        RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514';
      END IF;
      IF (v_counts->>v_key)::pg_catalog.numeric > 9007199254740991 THEN
        RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514';
      END IF;
    END LOOP;
    IF (v_counts->>'zone_id')::pg_catalog.numeric <= v_previous_zone
      OR (v_counts->>'workers')::pg_catalog.numeric > (v_counts->>'persons')::pg_catalog.numeric
      OR (v_counts->>'households')::pg_catalog.numeric > (v_counts->>'persons')::pg_catalog.numeric THEN
      RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514';
    END IF;
    v_previous_zone := (v_counts->>'zone_id')::pg_catalog.numeric;
  END LOOP;
  v_payload := public.model_truth_canonical_jsonb(v_basis);
  IF pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_payload,'UTF8'),'sha256'),'hex') IS DISTINCT FROM v_digest THEN
    RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514';
  END IF;

  SELECT run.* INTO v_source_run FROM public.model_runs run JOIN public.models model ON model.id = run.model_id
    WHERE run.id = (v_source->>'modelRunId')::pg_catalog.uuid AND run.workspace_id = v_set.workspace_id
      AND run.project_id = v_set.project_id AND run.scenario_set_id = v_set.id AND run.scenario_entry_id = v_snapshot.baseline_entry_id
      AND run.engine_key = 'aequilibrae' AND run.status = 'succeeded'
      AND run.attempt_managed IS NOT DISTINCT FROM (v_custody = 'managed_attempt')
      AND model.workspace_id = v_set.workspace_id AND model.project_id = v_set.project_id AND model.scenario_set_id = v_set.id
      AND model.config_json->>'guidedProjectComparison' = 'openplan.project_comparison.v1' AND model.config_json->>'method' = 'aequilibrae'
    FOR SHARE OF run, model;
  IF NOT FOUND OR v_source_run.corridor_geojson IS NULL OR COALESCE(v_source_run.input_snapshot_json->>'zoneGeography','') NOT IN ('tract','block_group') THEN
    RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514';
  END IF;
  v_request := v_source_run.input_snapshot_json->'commonPopulation';
  IF v_request IS DISTINCT FROM pg_catalog.jsonb_build_object('schema','openplan.common-population-request.v1','mode','generate',
    'custody',v_custody,'comparisonPolicy','fixed_population_auto_trip_change','sourceProfile',v_profile) THEN
    IF v_custody<>'legacy_stage_snapshot' OR v_request->>'mode' IS DISTINCT FROM 'restore_checkpoint'
      OR v_request->'sourceProfile' IS DISTINCT FROM v_profile OR v_request->'source' IS DISTINCT FROM 'null'::jsonb THEN
      RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514'; END IF;
    v_replacement:=public.read_model_population_origin(v_set.workspace_id,v_source_run.id)->'lineage';
  END IF;
  SELECT artifact.* INTO v_source_artifact FROM public.model_run_artifacts artifact
    WHERE artifact.id = (v_source->>'artifactId')::pg_catalog.uuid AND artifact.run_id = v_source_run.id
      AND artifact.artifact_type = 'common_population' AND artifact.stage_id = (v_source->>'stageId')::pg_catalog.uuid
      AND artifact.attempt_id IS NOT DISTINCT FROM (v_source->>'attemptId')::pg_catalog.uuid AND artifact.content_hash = v_source->>'sha256'
      AND artifact.file_size_bytes = (v_source->>'sizeBytes')::pg_catalog.int8
      AND artifact.file_url IS NOT NULL AND pg_catalog.btrim(artifact.file_url) <> ''
    FOR SHARE OF artifact;
  IF NOT FOUND OR (SELECT pg_catalog.count(*) FROM public.model_run_artifacts artifact
      WHERE artifact.run_id = v_source_run.id AND artifact.artifact_type = 'common_population') <> 1
    OR pg_catalog.jsonb_typeof(v_source_artifact.metadata_json) IS DISTINCT FROM 'object'
    OR NOT v_source_artifact.metadata_json ?& ARRAY['schema','custody','population_basis','population_basis_payload_json','population_basis_digest','origin','scientific_acceptance']
    OR v_source_artifact.metadata_json - ARRAY['schema','custody','population_basis','population_basis_payload_json','population_basis_digest','origin','scientific_acceptance','replacement'] <> '{}'::pg_catalog.jsonb
    OR v_source_artifact.metadata_json->'replacement' IS DISTINCT FROM v_replacement
    OR v_source_artifact.metadata_json->>'schema' IS DISTINCT FROM 'openplan.common-population.v1'
    OR v_source_artifact.metadata_json->>'custody' IS DISTINCT FROM v_custody
    OR v_source_artifact.metadata_json->'origin' IS DISTINCT FROM 'null'::pg_catalog.jsonb
    OR v_source_artifact.metadata_json->>'scientific_acceptance' IS DISTINCT FROM 'unassessed'
    OR v_source_artifact.metadata_json->'population_basis' IS DISTINCT FROM v_basis
    OR v_source_artifact.metadata_json->>'population_basis_payload_json' IS DISTINCT FROM v_payload
    OR v_source_artifact.metadata_json->>'population_basis_digest' IS DISTINCT FROM v_digest THEN
    RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514';
  END IF;
  IF v_custody = 'managed_attempt' THEN
    SELECT stage.* INTO v_source_stage FROM public.model_run_stages stage
    JOIN public.model_stage_attempts attempt ON attempt.id = stage.active_attempt_id AND attempt.stage_id = stage.id AND attempt.run_id = stage.run_id
    WHERE stage.id = v_source_artifact.stage_id AND stage.run_id = v_source_run.id AND stage.stage_name = 'AequilibraE Setup'
      AND stage.status = 'succeeded' AND stage.attempt_managed AND stage.active_attempt_id = v_source_artifact.attempt_id
      AND attempt.revoked_at IS NULL FOR SHARE OF stage, attempt;
    IF NOT FOUND THEN RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514'; END IF;
  ELSE
    PERFORM public.read_common_population_stage_custody(v_set.workspace_id,v_source_run.id,v_source_artifact.stage_id,v_source_artifact.id);
  END IF;

  -- Native rows can bind sibling descriptors and custody, not inspect manifest
  -- bytes. Workers separately verify all six descriptors against the raw file.
  v_source_directory := pg_catalog.left(v_source_artifact.file_url,pg_catalog.length(v_source_artifact.file_url)-pg_catalog.length('common_population.json'));
  IF v_source_directory = '' OR pg_catalog.right(v_source_directory,1) <> '/'
    OR v_source_directory ~ '(^|/)[.]{1,2}(/|$)' OR pg_catalog.strpos(v_source_directory,pg_catalog.chr(92)) > 0
    OR v_source_artifact.file_url IS DISTINCT FROM v_source_directory||'common_population.json' THEN
    RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514';
  END IF;
  FOREACH v_key IN ARRAY ARRAY['households','persons','selected_zones','diagnostics','source_manifest','source_zone_attributes'] LOOP
    v_filename := CASE v_key WHEN 'households' THEN 'households.csv' WHEN 'persons' THEN 'persons.csv'
      WHEN 'selected_zones' THEN 'selected_zones.json' WHEN 'diagnostics' THEN 'diagnostics.json'
      WHEN 'source_manifest' THEN 'source_manifest.json' ELSE 'source_zone_attributes.csv' END;
    SELECT companion.* INTO v_companion FROM public.model_run_artifacts companion
      WHERE companion.run_id = v_source_run.id AND companion.artifact_type = 'common_population_'||v_key
        AND companion.stage_id = v_source_artifact.stage_id
        AND companion.attempt_id IS NOT DISTINCT FROM v_source_artifact.attempt_id FOR SHARE OF companion;
    IF NOT FOUND OR (SELECT pg_catalog.count(*) FROM public.model_run_artifacts companion
        WHERE companion.run_id = v_source_run.id AND companion.artifact_type = 'common_population_'||v_key) <> 1
      OR v_companion.metadata_json IS DISTINCT FROM v_source_artifact.metadata_json
      OR v_companion.file_url IS DISTINCT FROM v_source_directory||v_filename
      OR v_companion.content_hash IS NULL OR v_companion.content_hash !~ '^[a-f0-9]{64}$'
      OR v_companion.file_size_bytes IS NULL OR v_companion.file_size_bytes <= 0 OR v_companion.file_size_bytes > 9007199254740991 THEN
      RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514';
    END IF;
    IF v_key IN ('selected_zones','source_manifest') THEN
      v_descriptor := v_basis->(CASE v_key WHEN 'selected_zones' THEN 'selected_zone_map' ELSE 'source_manifest' END);
      IF v_companion.content_hash IS DISTINCT FROM v_descriptor->>'sha256'
        OR v_companion.file_size_bytes IS DISTINCT FROM (v_descriptor->>'bytes')::pg_catalog.int8 THEN
        RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF v_custody = 'legacy_stage_snapshot' THEN
      PERFORM public.read_common_population_stage_custody(v_set.workspace_id,v_source_run.id,v_companion.stage_id,v_companion.id);
    END IF;
    -- Managed companions share the exact locked Setup/active unrevoked attempt
    -- validated above. Legacy companions each require their own full receipt.
  END LOOP;

  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(link) ORDER BY link.method,link.scenario_role),'[]'::pg_catalog.jsonb)
    INTO v_links FROM public.scenario_comparison_model_run_links link WHERE link.comparison_snapshot_id = v_snapshot.id;
  IF TG_TABLE_NAME = 'scenario_comparison_model_run_links' THEN
    IF v_snapshot.status <> 'draft' THEN RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514'; END IF;
    v_links := v_links || pg_catalog.jsonb_build_array(pg_catalog.to_jsonb(NEW));
  END IF;
  IF v_snapshot.status = 'ready' AND (pg_catalog.jsonb_array_length(v_links) <> 4 OR
    (SELECT pg_catalog.count(DISTINCT (item->>'method',item->>'scenario_role'))
      FROM pg_catalog.jsonb_array_elements(v_links) AS elements(item)) <> 4) THEN
    RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514';
  END IF;
  FOR v_link IN SELECT item FROM pg_catalog.jsonb_array_elements(v_links) AS elements(item) LOOP
    SELECT run.* INTO v_run FROM public.model_runs run JOIN public.models model ON model.id = run.model_id
      WHERE run.id = (v_link->>'model_run_id')::pg_catalog.uuid AND run.workspace_id = v_set.workspace_id
        AND run.project_id = v_set.project_id AND run.scenario_set_id = v_set.id AND run.status = 'succeeded'
        AND run.attempt_managed IS NOT DISTINCT FROM (v_custody = 'managed_attempt')
        AND model.workspace_id = v_set.workspace_id AND model.project_id = v_set.project_id AND model.scenario_set_id = v_set.id
        AND model.config_json->>'guidedProjectComparison' = 'openplan.project_comparison.v1' AND model.config_json->>'method' = v_link->>'method'
        AND run.engine_key = CASE v_link->>'method' WHEN 'aequilibrae' THEN 'aequilibrae' ELSE 'behavioral_demand' END
        AND run.scenario_entry_id = CASE v_link->>'scenario_role' WHEN 'baseline' THEN v_snapshot.baseline_entry_id ELSE v_snapshot.candidate_entry_id END
        AND (v_link->>'method' <> 'aequilibrae' OR model.id = v_source_run.model_id)
      FOR SHARE OF run, model;
    IF NOT FOUND OR v_link->>'workspace_id' IS DISTINCT FROM v_set.workspace_id::pg_catalog.text
      OR v_run.corridor_geojson IS DISTINCT FROM v_source_run.corridor_geojson
      OR v_run.input_snapshot_json->'zoneGeography' IS DISTINCT FROM v_source_run.input_snapshot_json->'zoneGeography' THEN
      RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514';
    END IF;
    IF v_link->>'method' = 'aequilibrae' AND v_link->>'scenario_role' = 'baseline' THEN
      IF v_run.id IS DISTINCT FROM v_source_run.id THEN RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514'; END IF;
    ELSIF v_run.input_snapshot_json->'commonPopulation' IS DISTINCT FROM pg_catalog.jsonb_build_object(
      'schema','openplan.common-population-request.v1','custody',v_custody,'mode','reuse','comparisonPolicy','fixed_population_auto_trip_change','source',v_source) THEN
      IF v_custody<>'legacy_stage_snapshot' OR v_run.input_snapshot_json#>>'{commonPopulation,mode}' IS DISTINCT FROM 'restore_checkpoint'
        OR v_run.input_snapshot_json#>'{commonPopulation,source}' IS DISTINCT FROM v_source
        OR v_run.input_snapshot_json#>'{commonPopulation,sourceProfile}' IS DISTINCT FROM v_profile THEN
        RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514'; END IF;
      v_link_replacement:=public.read_model_population_origin(v_set.workspace_id,v_run.id);
    END IF;
    SELECT artifact.* INTO v_artifact FROM public.model_run_artifacts artifact
      WHERE artifact.id = (v_link->>'model_run_artifact_id')::pg_catalog.uuid AND artifact.run_id = v_run.id
        AND artifact.artifact_type = CASE v_link->>'method' WHEN 'aequilibrae' THEN 'link_volumes' ELSE 'activitysim_link_volumes' END
        AND artifact.content_hash = v_link->>'artifact_sha256' AND artifact.file_size_bytes > 0
        AND artifact.content_hash ~ '^[a-f0-9]{64}$' AND artifact.file_url IS NOT NULL AND pg_catalog.btrim(artifact.file_url) <> ''
      FOR SHARE OF artifact;
    IF NOT FOUND OR v_artifact.metadata_json->>'population_custody' IS DISTINCT FROM v_custody
      OR v_artifact.metadata_json->'population_basis' IS DISTINCT FROM v_basis
      OR v_artifact.metadata_json->>'population_basis_payload_json' IS DISTINCT FROM v_payload
      OR v_artifact.metadata_json->>'population_basis_digest' IS DISTINCT FROM v_digest THEN
      RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514';
    END IF;
    IF v_custody = 'managed_attempt' THEN
      SELECT stage.* INTO v_stage FROM public.model_run_stages stage
      JOIN public.model_stage_attempts attempt ON attempt.id = stage.active_attempt_id AND attempt.stage_id = stage.id AND attempt.run_id = stage.run_id
      WHERE stage.id = v_artifact.stage_id AND stage.run_id = v_run.id
        AND stage.stage_name = CASE v_link->>'method' WHEN 'aequilibrae' THEN 'Artifact Extraction' ELSE 'ActivitySim Network Assignment' END
        AND stage.status = 'succeeded' AND stage.attempt_managed AND stage.active_attempt_id = v_artifact.attempt_id
        AND attempt.revoked_at IS NULL FOR SHARE OF stage, attempt;
      IF NOT FOUND THEN RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514'; END IF;
    ELSE
      PERFORM public.read_common_population_stage_custody(v_set.workspace_id,v_run.id,v_artifact.stage_id,v_artifact.id);
    END IF;
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN check_violation OR invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN
  RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514';
END;
$$;
REVOKE ALL ON FUNCTION public.validate_common_population_comparison() FROM PUBLIC, anon, authenticated, service_role;


CREATE FUNCTION public.read_model_population_lineage(p_workspace_id uuid,p_run_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.model_runs%ROWTYPE; source uuid;
BEGIN
 SELECT * INTO r FROM public.model_runs WHERE id=p_run_id AND workspace_id=p_workspace_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Population scope mismatch' USING ERRCODE='23514'; END IF;
 IF r.input_snapshot_json#>>'{commonPopulation,mode}'='restore_checkpoint' THEN
  RETURN public.read_model_population_origin(p_workspace_id,p_run_id)->'lineage'; END IF;
 IF r.input_snapshot_json#>>'{commonPopulation,mode}'='reuse' THEN
  SELECT id INTO source FROM public.model_runs WHERE id=(r.input_snapshot_json#>>'{commonPopulation,source,modelRunId}')::uuid
   AND workspace_id=p_workspace_id AND status='succeeded' AND input_snapshot_json#>>'{commonPopulation,mode}'='restore_checkpoint';
  IF FOUND THEN RETURN public.read_model_population_origin(p_workspace_id,source)->'lineage'; END IF;
 END IF;
 RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.read_model_population_lineage(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_model_population_lineage(uuid,uuid) TO service_role;

CREATE FUNCTION public.inspect_model_population_redispatch(p_workspace_id uuid,p_run_id uuid,p_actor_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.model_runs%ROWTYPE; c public.model_population_checkpoint_receipts%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.model_runs WHERE id=p_run_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND OR r.status<>'queued' OR r.attempt_managed THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_actor_id AND role IN('owner','admin') FOR SHARE NOWAIT)
  THEN RAISE EXCEPTION 'Population redispatch access denied' USING ERRCODE='42501'; END IF;
 PERFORM id FROM public.model_run_stages WHERE run_id=p_run_id ORDER BY id FOR UPDATE;
 SELECT cp.* INTO c FROM public.model_population_checkpoint_receipts cp JOIN public.model_population_replacement_receipts rr
  ON rr.checkpoint_id=cp.request_id AND rr.replacement_run_id=r.id FOR SHARE OF cp;
 IF NOT FOUND OR c.context_json IS DISTINCT FROM public.model_population_input_context(r.id)
  OR EXISTS(SELECT 1 FROM public.model_population_checkpoint_revocations WHERE checkpoint_id=c.request_id)
  OR EXISTS(SELECT 1 FROM public.model_stage_execution_starts WHERE run_id=r.id)
  OR EXISTS(SELECT 1 FROM public.model_run_stages WHERE run_id=r.id AND status<>'queued')
  OR (SELECT count(*) FROM public.model_run_stages WHERE run_id=r.id)<>(CASE r.engine_key WHEN 'aequilibrae' THEN 3 WHEN 'behavioral_demand' THEN 6 ELSE 0 END) THEN RETURN false; END IF;
 RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.inspect_model_population_redispatch(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.inspect_model_population_redispatch(uuid,uuid,uuid) TO service_role;

CREATE FUNCTION public.guard_model_population_replacement_stage_set() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE row_json jsonb; prior_json jsonb; scoped_run uuid;
BEGIN
 IF TG_OP<>'DELETE' THEN row_json:=to_jsonb(NEW); END IF;
 IF TG_OP<>'INSERT' THEN prior_json:=to_jsonb(OLD); END IF;
 FOR scoped_run IN SELECT id FROM public.model_runs WHERE id IN((row_json->>'run_id')::uuid,(prior_json->>'run_id')::uuid) ORDER BY id FOR UPDATE LOOP
  IF EXISTS(SELECT 1 FROM public.model_population_replacement_receipts WHERE replacement_run_id=scoped_run) THEN
   IF TG_OP<>'UPDATE' OR row_json->'run_id' IS DISTINCT FROM prior_json->'run_id'
    OR row_json->'id' IS DISTINCT FROM prior_json->'id' OR row_json->'stage_name' IS DISTINCT FROM prior_json->'stage_name'
    OR row_json->'sort_order' IS DISTINCT FROM prior_json->'sort_order' THEN
    RAISE EXCEPTION 'Registered replacement stage set is immutable' USING ERRCODE='23514'; END IF;
  END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_model_population_replacement_stage_set() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_model_population_replacement_stage_set BEFORE INSERT OR UPDATE OR DELETE ON public.model_run_stages
 FOR EACH ROW EXECUTE FUNCTION public.guard_model_population_replacement_stage_set();
COMMIT;
