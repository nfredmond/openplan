-- Insert at the common-population fixture's SOURCE PUBLICATION SEAM. The first
-- attempt fails before publishing any population package. This preserves exact-
-- one population-source admission on the fresh attempt. All records are synthetic.
DO $$
DECLARE g cp_groups%ROWTYPE; j cp_jobs%ROWTYPE; p cp_probe%ROWTYPE;
 setup_attempt uuid; output_attempt uuid; result jsonb; old_output uuid := '00000000-0000-0000-0000-000000000030';
BEGIN
 SELECT * INTO g FROM cp_groups WHERE name='main';
 SELECT * INTO j FROM cp_jobs WHERE position=0;
 SELECT * INTO p FROM cp_probe;
 SET LOCAL ROLE service_role;
 result:=public.claim_model_stage_attempt(gen_random_uuid(),g.setup_id,'readiness-old-setup');
 IF result->>'outcome'<>'claimed' THEN RAISE EXCEPTION 'Old Setup claim missing'; END IF;
 setup_attempt:=(result->>'attempt_id')::uuid;
 PERFORM public.write_model_stage_attempt(gen_random_uuid(),setup_attempt,'succeeded','No population publication',NULL);
 result:=public.claim_model_stage_attempt(gen_random_uuid(),j.stage_id,'readiness-old-output');
 IF result->>'outcome'<>'claimed' THEN RAISE EXCEPTION 'Old output claim missing'; END IF;
 output_attempt:=(result->>'attempt_id')::uuid;
 PERFORM public.write_model_attempt_artifact(gen_random_uuid(),output_attempt,jsonb_build_object(
  'id',old_output,'artifact_type','link_volumes','file_url','local://synthetic-old/output.csv',
  'file_size_bytes',1,'content_hash',repeat('9',64),'metadata_json',jsonb_build_object('demand_method','aequilibrae')));
 PERFORM pg_temp.cp_instrument(output_attempt,'aequilibrae',old_output,repeat('9',64));
 PERFORM public.write_model_stage_attempt(gen_random_uuid(),output_attempt,'failed','Synthetic first failure','Synthetic first failure');
 result:=public.relaunch_model_run_attempts(gen_random_uuid(),g.workspace_id,g.run_id,p.owner_id,
  (public.inspect_model_run_recovery(g.workspace_id,g.run_id,p.owner_id)->'expected_state'),'Synthetic readiness retry without claim promotion');
 IF result->>'outcome'<>'fresh_attempt_queued' THEN RAISE EXCEPTION 'Readiness retry was not admitted'; END IF;
 RESET ROLE;
END $$;
CREATE TEMP TABLE bridge_retained AS
 SELECT to_jsonb(artifact) AS artifact FROM public.model_run_artifacts artifact WHERE run_id=(SELECT run_id FROM cp_jobs WHERE position=0);
