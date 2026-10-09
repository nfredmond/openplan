-- Synthetic native relationships only. The enclosing test always rolls back.
CREATE TEMP TABLE instrument_probe(workspace uuid, member_id uuid, outsider_id uuid, run_id uuid, stage_id uuid);
INSERT INTO instrument_probe SELECT gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid();
GRANT SELECT ON instrument_probe TO authenticated;
INSERT INTO auth.users(id,email) SELECT member_id,member_id||'@example.test' FROM instrument_probe
 UNION ALL SELECT outsider_id,outsider_id||'@example.test' FROM instrument_probe;
INSERT INTO public.workspaces(id,name,slug) SELECT workspace,'Instrument probe',workspace::text FROM instrument_probe;
INSERT INTO public.workspace_members(workspace_id,user_id,role) SELECT workspace,member_id,'viewer' FROM instrument_probe;
INSERT INTO public.models(id,workspace_id,title,model_family) SELECT run_id,workspace,'Synthetic instrument','travel_demand' FROM instrument_probe;
INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title)
 SELECT run_id,workspace,run_id,'aequilibrae','queued','Synthetic instrument' FROM instrument_probe;
INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order)
 SELECT stage_id,run_id,'Artifact Extraction','queued',1 FROM instrument_probe;
DO $$ DECLARE attempt uuid; method text; item record; payload jsonb; artifact jsonb; BEGIN
 SELECT (public.claim_model_stage_attempt(gen_random_uuid(),stage_id,'RLS instrument probe')->>'attempt_id')::uuid INTO attempt FROM instrument_probe;
 IF attempt IS NULL THEN RAISE EXCEPTION 'fixture claim missing'; END IF;
 FOREACH method IN ARRAY ARRAY['aequilibrae','activitysim'] LOOP
  payload=jsonb_build_object('demand_method',method,'scientific_outcome','inconclusive');
  FOR item IN SELECT * FROM (VALUES
   ('model_output','synthetic_output','synthetic.output'),
   ('input_bundle','validation_input_bundle_v2','openplan.validation-input-bundle.v2'),
   ('match_audit','pre_volume_match_audit_v2','openplan.pre-volume-observation-match-audit.v2'),
   ('comparison_basis','model_comparison_basis_v2','openplan.model-comparison-basis.v2'),
   ('assessment','model_validation_assessment_v2','openplan.model-validation-assessment.v2'),
   ('diagnosis','model_validation_structural_diagnosis_v2','openplan.model-validation-structural-diagnosis.v2')
  ) AS roles(prefix,kind,schema) LOOP
   artifact=public.write_model_attempt_artifact(gen_random_uuid(),attempt,jsonb_build_object(
    'artifact_type',item.kind,'file_url','local://synthetic-rls/'||method||'/'||item.prefix,
    'file_size_bytes',0,'content_hash',repeat('a',64),'metadata_json',jsonb_build_object('schema',item.schema,'demand_method',method)));
   payload=payload||jsonb_build_object(item.prefix||'_artifact_id',artifact->>'id',item.prefix||'_sha256',repeat('a',64));
  END LOOP;
  PERFORM public.record_model_attempt_instrument(gen_random_uuid(),attempt,payload);
 END LOOP;
END $$;
CREATE FUNCTION pg_temp.instrument_count(expected bigint, reason text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF (SELECT count(*) FROM public.model_attempt_instrument_custody WHERE workspace_id=(SELECT workspace FROM instrument_probe))<>expected
 THEN RAISE EXCEPTION '%',reason; END IF;
END $$;
SELECT pg_temp.instrument_count(2,'fixture records missing');
-- MUTATION SEAM
SELECT set_config('request.jwt.claim.sub',(SELECT member_id::text FROM instrument_probe),true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.instrument_count(2,'member records missing');
DO $$ BEGIN
 IF (SELECT count(DISTINCT demand_method) FROM public.model_attempt_instrument_custody WHERE workspace_id=(SELECT workspace FROM instrument_probe))<>2
 THEN RAISE EXCEPTION 'method lost'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub',(SELECT outsider_id::text FROM instrument_probe),true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.instrument_count(0,'outsider rows exposed');
RESET ROLE;
DO $$ DECLARE r text; p text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  FOREACH p IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
   IF has_table_privilege(r,'public.model_attempt_instrument_custody',p) THEN RAISE EXCEPTION 'direct write exposed'; END IF;
  END LOOP;
  IF has_table_privilege(r,'public.model_attempt_instrument_receipts','SELECT') THEN RAISE EXCEPTION 'receipt exposed'; END IF;
 END LOOP;
 IF has_table_privilege('anon','public.model_attempt_instrument_custody','SELECT') OR has_table_privilege('service_role','public.model_attempt_instrument_custody','SELECT')
 THEN RAISE EXCEPTION 'nonmember grant exposed'; END IF;
END $$;
SAVEPOINT parent_visibility;
CREATE POLICY instrument_probe_hidden_parent ON public.model_runs AS RESTRICTIVE FOR SELECT TO authenticated USING(false);
SELECT set_config('request.jwt.claim.sub',(SELECT member_id::text FROM instrument_probe),true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.instrument_count(0,'hidden parent rows exposed');
RESET ROLE;
ROLLBACK TO parent_visibility;
DELETE FROM public.workspace_members WHERE workspace_id=(SELECT workspace FROM instrument_probe) AND user_id=(SELECT member_id FROM instrument_probe);
SELECT set_config('request.jwt.claim.sub',(SELECT member_id::text FROM instrument_probe),true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.instrument_count(0,'removed member rows exposed');
RESET ROLE;
