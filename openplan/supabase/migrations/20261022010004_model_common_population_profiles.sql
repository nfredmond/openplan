-- Technical source-profile membership only. No scientific or coverage acceptance.
-- Frozen catalog projection SHA-256 (compact sorted JSON, no newline): 5d7dfd1304f62a684d5c946ef4a43580e1313e777404048755fe7915e92c43d5
CREATE FUNCTION public.model_common_population_profile_allowed(p_profile pg_catalog.jsonb, p_purpose pg_catalog.text)
RETURNS pg_catalog.bool
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT CASE WHEN pg_catalog.jsonb_typeof(p_profile) IS DISTINCT FROM 'object'
    OR p_purpose IS NULL OR p_purpose NOT IN ('new_guided_launch','retained_validation','aequilibrae_production','activitysim_consumption')
    THEN false ELSE EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements($population_catalog$[{"profile":{"acs_summary_endpoint":"https://api.census.gov/data/2022/acs/acs5","adapter":"us_census_acs5_pums","income_dollar_year":2022,"puma_fields":{"2010":"PUMA10","2020":"PUMA20"},"pums_endpoint":"https://api.census.gov/data/2022/acs/acs5/pums","sample_years":[2018,2022]},"purposes":["retained_validation","aequilibrae_production","activitysim_consumption"]},{"profile":{"acs_summary_endpoint":"https://api.census.gov/data/2023/acs/acs5","adapter":"us_census_acs5_pums","income_dollar_year":2023,"puma_fields":{"2020":"PUMA"},"pums_endpoint":"https://api.census.gov/data/2023/acs/acs5/pums","sample_years":[2019,2023]},"purposes":["new_guided_launch","retained_validation","aequilibrae_production","activitysim_consumption"]}]$population_catalog$::pg_catalog.jsonb) AS entry(value)
      WHERE entry.value->'purposes' ? p_purpose
        AND public.model_truth_canonical_jsonb(p_profile) = public.model_truth_canonical_jsonb(entry.value->'profile')
    ) END;
$$;
REVOKE ALL ON FUNCTION public.model_common_population_profile_allowed(pg_catalog.jsonb,pg_catalog.text) FROM PUBLIC, anon, authenticated, service_role;

-- Preserve the complete latest P1 admission prefix and all other custody bytes.
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
  v_scope_ids pg_catalog.uuid[];
  v_has_links pg_catalog.bool;
  v_guided pg_catalog.bool;
  v_fixed_claim pg_catalog.bool;
BEGIN
  IF TG_NARGS <> 0 OR TG_TABLE_SCHEMA <> 'public' OR TG_OP NOT IN ('INSERT', 'UPDATE') THEN
    RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'scenario_comparison_model_run_links' AND TG_OP = 'INSERT' THEN
    SELECT snapshot.* INTO v_snapshot FROM public.scenario_comparison_snapshots snapshot
      WHERE snapshot.id = NEW.comparison_snapshot_id FOR UPDATE OF snapshot;
    IF NOT FOUND THEN RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514'; END IF;
    v_scope_ids := ARRAY[v_snapshot.scenario_set_id];
  ELSIF TG_TABLE_NAME = 'scenario_comparison_snapshots' THEN
    v_snapshot := NEW;
    v_scope_ids := ARRAY[NEW.scenario_set_id];
    IF TG_OP = 'UPDATE' THEN
      IF OLD.status = 'ready' AND NEW.status = 'archived'
        AND (pg_catalog.to_jsonb(NEW) - ARRAY['status','updated_at'])
          IS NOT DISTINCT FROM (pg_catalog.to_jsonb(OLD) - ARRAY['status','updated_at']) THEN RETURN NEW; END IF;
      v_scope_ids := ARRAY[OLD.scenario_set_id,NEW.scenario_set_id];
    END IF;
  ELSE
    RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514';
  END IF;
  -- The aa trigger serialized and authorized all actual parents before any
  -- original invoker guard. Reread classification here, never a caller claim.
  SELECT EXISTS (SELECT 1 FROM public.scenario_comparison_model_run_links link
    WHERE link.comparison_snapshot_id = v_snapshot.id) INTO v_has_links;
  SELECT TG_TABLE_NAME = 'scenario_comparison_model_run_links' OR v_has_links OR EXISTS (
    SELECT 1 FROM public.models model WHERE model.scenario_set_id = ANY(v_scope_ids)
      AND public.model_common_population_guided_intent(model.config_json)) INTO v_guided;
  v_claim := v_snapshot.metadata_json->'commonPopulation';
  v_fixed_claim := COALESCE(v_claim->>'schema' = 'openplan.common-population-comparison.v1',false)
    OR COALESCE(v_claim->>'comparisonPolicy' = 'fixed_population_auto_trip_change',false);
  IF NOT (v_guided OR v_fixed_claim) THEN RETURN NEW; END IF;
  -- An unbound, unfinished draft is not accepted evidence. An explicit fixed
  -- claim still opts into the complete validator, as before this correction.
  IF TG_TABLE_NAME = 'scenario_comparison_snapshots' AND v_snapshot.status = 'draft'
    AND NOT v_has_links AND NOT v_fixed_claim THEN RETURN NEW; END IF;
  IF v_claim->>'schema' IS DISTINCT FROM 'openplan.common-population-comparison.v1'
    OR v_claim->>'comparisonPolicy' IS DISTINCT FROM 'fixed_population_auto_trip_change' THEN
    RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514';
  END IF;
  -- Detect damaged/unsupported models without filtering away foreign scopes.
  IF EXISTS (SELECT 1 FROM public.models model JOIN public.scenario_sets scenario_set
    ON scenario_set.id = model.scenario_set_id WHERE model.scenario_set_id = ANY(v_scope_ids)
      AND public.model_common_population_guided_intent(model.config_json) AND (
        model.workspace_id IS DISTINCT FROM scenario_set.workspace_id
        OR model.project_id IS DISTINCT FROM scenario_set.project_id
        OR model.config_json->>'guidedProjectComparison' IS DISTINCT FROM 'openplan.project_comparison.v1'
        OR COALESCE(model.config_json->>'method','') NOT IN ('aequilibrae','activitysim')
        OR model.config_json->'networkBasis' IS DISTINCT FROM
          '{"kind":"worker_osm_snapshot","source":"OpenStreetMap","identity":"network_state_digest","comparisonRule":"exact_digest_match"}'::pg_catalog.jsonb)) THEN
    RAISE EXCEPTION 'Common population comparison custody is invalid' USING ERRCODE = '23514';
  END IF;
  -- Lock scenario assumptions before source run/model/artifact custody reads.
  PERFORM entry.id FROM public.scenario_entries entry
    WHERE entry.id IN (v_snapshot.baseline_entry_id,v_snapshot.candidate_entry_id) ORDER BY entry.id FOR SHARE OF entry;

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

  -- Retained technical validation uses the frozen catalog without rewriting the basis.
  v_profile := v_basis->'source_profile';
  IF public.model_common_population_profile_allowed(v_profile,'retained_validation') IS DISTINCT FROM true THEN
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

-- This is the renamed ordinary function. The restoration wrapper stays untouched.
CREATE OR REPLACE FUNCTION public.read_common_population_stage_custody_before_replacement(
  p_workspace pg_catalog.uuid, p_run pg_catalog.uuid, p_stage pg_catalog.uuid,
  p_artifact pg_catalog.uuid DEFAULT NULL)
RETURNS pg_catalog.jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_run public.model_runs%ROWTYPE;
  v_stage public.model_run_stages%ROWTYPE;
  v_artifact public.model_run_artifacts%ROWTYPE;
  v_request pg_catalog.jsonb;
  v_source pg_catalog.jsonb;
  v_key pg_catalog.text;
  v_year pg_catalog.int4;
  v_profile pg_catalog.jsonb;
BEGIN
  SELECT run.* INTO v_run FROM public.model_runs run
    WHERE run.id = p_run AND run.workspace_id = p_workspace FOR SHARE OF run;
  IF NOT FOUND OR v_run.attempt_managed IS DISTINCT FROM false OR v_run.engine_key NOT IN ('aequilibrae','behavioral_demand')
    OR NOT EXISTS (SELECT 1 FROM public.model_execution_custody_enrollment enrollment
      WHERE enrollment.run_id = v_run.id AND enrollment.provenance = 'new_run') THEN
    RAISE EXCEPTION 'Common population stage custody is invalid' USING ERRCODE = '23514';
  END IF;
  SELECT stage.* INTO v_stage FROM public.model_run_stages stage
    JOIN public.model_stage_execution_starts execution_start ON execution_start.stage_id = stage.id AND execution_start.run_id = stage.run_id
    WHERE stage.id = p_stage AND stage.run_id = v_run.id FOR SHARE OF stage;
  IF NOT FOUND OR v_stage.attempt_managed IS DISTINCT FROM false OR v_stage.active_attempt_id IS NOT NULL THEN
    RAISE EXCEPTION 'Common population stage custody is invalid' USING ERRCODE = '23514';
  END IF;
  v_request := v_run.input_snapshot_json->'commonPopulation';
  IF pg_catalog.jsonb_typeof(v_request) IS DISTINCT FROM 'object'
    OR v_request->>'schema' IS DISTINCT FROM 'openplan.common-population-request.v1'
    OR v_request->>'custody' IS DISTINCT FROM 'legacy_stage_snapshot'
    OR v_request->>'comparisonPolicy' IS DISTINCT FROM 'fixed_population_auto_trip_change' THEN
    RAISE EXCEPTION 'Common population stage custody is invalid' USING ERRCODE = '23514';
  END IF;
  IF v_request->>'mode' = 'generate' THEN
    IF NOT v_request ?& ARRAY['schema','custody','mode','comparisonPolicy','sourceProfile']
      OR v_request - ARRAY['schema','custody','mode','comparisonPolicy','sourceProfile'] <> '{}'::pg_catalog.jsonb
      OR pg_catalog.jsonb_typeof(v_request->'sourceProfile') IS DISTINCT FROM 'object'
      OR v_run.engine_key <> 'aequilibrae'
      OR NOT EXISTS (SELECT 1 FROM public.scenario_sets scenario_set
        JOIN public.scenario_entries entry ON entry.id = scenario_set.baseline_entry_id AND entry.scenario_set_id = scenario_set.id AND entry.entry_type = 'baseline'
        WHERE scenario_set.id = v_run.scenario_set_id AND scenario_set.workspace_id = v_run.workspace_id
          AND scenario_set.project_id = v_run.project_id AND entry.id = v_run.scenario_entry_id) THEN
      RAISE EXCEPTION 'Common population stage custody is invalid' USING ERRCODE = '23514';
    END IF;
    v_profile := v_request->'sourceProfile';
    IF public.model_common_population_profile_allowed(v_profile,'retained_validation') IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Common population stage custody is invalid' USING ERRCODE = '23514';
    END IF;
  ELSIF v_request->>'mode' = 'reuse' THEN
    v_source := v_request->'source';
    IF NOT v_request ?& ARRAY['schema','custody','mode','comparisonPolicy','source']
      OR v_request - ARRAY['schema','custody','mode','comparisonPolicy','source'] <> '{}'::pg_catalog.jsonb
      OR pg_catalog.jsonb_typeof(v_source) IS DISTINCT FROM 'object'
      OR NOT v_source ?& ARRAY['modelRunId','artifactId','stageId','attemptId','sha256','sizeBytes']
      OR v_source - ARRAY['modelRunId','artifactId','stageId','attemptId','sha256','sizeBytes'] <> '{}'::pg_catalog.jsonb
      OR v_source->'attemptId' IS DISTINCT FROM 'null'::pg_catalog.jsonb
      OR pg_catalog.jsonb_typeof(v_source->'sha256') IS DISTINCT FROM 'string' OR COALESCE(v_source->>'sha256','') !~ '^[a-f0-9]{64}$'
      OR pg_catalog.jsonb_typeof(v_source->'sizeBytes') IS DISTINCT FROM 'number' OR COALESCE(v_source->>'sizeBytes','') !~ '^[1-9][0-9]*$' THEN
      RAISE EXCEPTION 'Common population stage custody is invalid' USING ERRCODE = '23514';
    END IF;
    FOREACH v_key IN ARRAY ARRAY['modelRunId','artifactId','stageId'] LOOP
      IF pg_catalog.jsonb_typeof(v_source->v_key) IS DISTINCT FROM 'string'
        OR COALESCE(v_source->>v_key,'') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN
        RAISE EXCEPTION 'Common population stage custody is invalid' USING ERRCODE = '23514';
      END IF;
    END LOOP;
    IF (v_source->>'sizeBytes')::pg_catalog.numeric > 9007199254740991 THEN
      RAISE EXCEPTION 'Common population stage custody is invalid' USING ERRCODE = '23514';
    END IF;
  ELSE
    RAISE EXCEPTION 'Common population stage custody is invalid' USING ERRCODE = '23514';
  END IF;
  IF p_artifact IS NULL THEN
    IF v_run.status <> 'running' OR v_stage.status <> 'running'
      OR v_stage.stage_name NOT IN ('AequilibraE Setup','ActivitySim Bundle & Preflight')
      OR (v_stage.stage_name = 'ActivitySim Bundle & Preflight' AND (v_request->>'mode' <> 'reuse' OR v_run.engine_key <> 'behavioral_demand')) THEN
      RAISE EXCEPTION 'Common population stage custody is invalid' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT artifact.* INTO v_artifact FROM public.model_run_artifacts artifact
      WHERE artifact.id = p_artifact AND artifact.run_id = v_run.id AND artifact.stage_id = v_stage.id FOR SHARE OF artifact;
    IF NOT FOUND OR v_run.status NOT IN ('running','succeeded') OR v_stage.status <> 'succeeded'
      OR v_artifact.attempt_id IS NOT NULL OR v_artifact.content_hash IS NULL OR v_artifact.content_hash !~ '^[a-f0-9]{64}$'
      OR v_artifact.file_size_bytes IS NULL OR v_artifact.file_size_bytes <= 0
      OR v_artifact.file_url IS NULL OR pg_catalog.btrim(v_artifact.file_url) = ''
      OR NOT ((v_artifact.artifact_type IN ('common_population','common_population_households','common_population_persons',
        'common_population_selected_zones','common_population_diagnostics','common_population_source_manifest','common_population_source_zone_attributes')
        AND v_stage.stage_name = 'AequilibraE Setup')
        OR (v_artifact.artifact_type = 'link_volumes' AND v_stage.stage_name = 'Artifact Extraction')
        OR (v_artifact.artifact_type = 'activitysim_link_volumes' AND v_stage.stage_name = 'ActivitySim Network Assignment'))
      OR NOT EXISTS (SELECT 1 FROM public.model_legacy_artifact_receipts receipt
        WHERE receipt.artifact_id = v_artifact.id AND receipt.run_id = v_run.id
          AND receipt.request_payload = pg_catalog.jsonb_build_object('workspace_id',v_run.workspace_id,'payload',pg_catalog.jsonb_build_object(
            'id',v_artifact.id,'run_id',v_artifact.run_id,'stage_id',v_artifact.stage_id,'artifact_type',v_artifact.artifact_type,
            'file_url',v_artifact.file_url,'file_size_bytes',v_artifact.file_size_bytes,'content_hash',v_artifact.content_hash,'metadata_json',v_artifact.metadata_json))
          AND receipt.response_payload = pg_catalog.to_jsonb(v_artifact)) THEN
      RAISE EXCEPTION 'Common population stage custody is invalid' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN pg_catalog.jsonb_build_object('schema','openplan.common-population-stage-custody.v1','custody','legacy_stage_snapshot',
    'workspace_id',v_run.workspace_id,'run_id',v_run.id,'stage_id',v_stage.id,'artifact_id',p_artifact,'eligible',true);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN
  RAISE EXCEPTION 'Common population stage custody is invalid' USING ERRCODE = '23514';
END;
$$;
REVOKE ALL ON FUNCTION public.read_common_population_stage_custody_before_replacement(pg_catalog.uuid,pg_catalog.uuid,pg_catalog.uuid,pg_catalog.uuid) FROM PUBLIC, anon, authenticated, service_role;
