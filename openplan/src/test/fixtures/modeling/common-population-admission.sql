-- SOURCE ONLY / UNEXECUTED. Append after common-population-comparisons.sql in
-- one isolated transaction. This set has no models, runs or guided declarations.
CREATE TEMP TABLE cp_generic_scope(set_id uuid DEFAULT gen_random_uuid(), baseline_id uuid DEFAULT gen_random_uuid(),
 build_id uuid DEFAULT gen_random_uuid(), model_id uuid DEFAULT gen_random_uuid());
INSERT INTO cp_generic_scope DEFAULT VALUES;
GRANT SELECT ON cp_generic_scope TO authenticated;
INSERT INTO public.scenario_sets(id,workspace_id,project_id,title)
 SELECT s.set_id,g.workspace_id,g.project_id,'Synthetic genuinely generic set' FROM cp_generic_scope s,cp_groups g WHERE g.name='main';
INSERT INTO public.scenario_entries(id,scenario_set_id,entry_type,label,slug,assumptions_json)
 SELECT baseline_id,set_id,'baseline','Generic baseline',baseline_id::text,'{}'::jsonb FROM cp_generic_scope UNION ALL
 SELECT build_id,set_id,'alternative','Generic alternative',build_id::text,'{}'::jsonb FROM cp_generic_scope;
UPDATE public.scenario_sets SET baseline_entry_id=s.baseline_id FROM cp_generic_scope s WHERE id=s.set_id;
CREATE FUNCTION pg_temp.cp_generic_snapshot(metadata jsonb DEFAULT '{}', desired_status text DEFAULT 'ready')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE result uuid; BEGIN
 INSERT INTO public.scenario_comparison_snapshots(scenario_set_id,baseline_entry_id,candidate_entry_id,label,metadata_json,status,created_by)
  SELECT s.set_id,s.baseline_id,s.build_id,'Synthetic generic comparison',metadata,desired_status,p.owner_id
  FROM cp_generic_scope s,cp_probe p RETURNING id INTO result;
 RETURN result;
END $$;
CREATE FUNCTION pg_temp.cp_generic_model(config jsonb DEFAULT '{}') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE result uuid; BEGIN
 INSERT INTO public.models(id,workspace_id,project_id,scenario_set_id,title,model_family,config_json)
  SELECT s.model_id,g.workspace_id,g.project_id,s.set_id,'Synthetic admission model','other',config
  FROM cp_generic_scope s,cp_groups g WHERE g.name='main' RETURNING id INTO result;
 RETURN result;
END $$;
