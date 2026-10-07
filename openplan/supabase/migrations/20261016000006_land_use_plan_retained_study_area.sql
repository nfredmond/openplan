-- Keep authority edits independent of later boundary-service editions.
CREATE OR REPLACE FUNCTION public.save_land_use_plan_context(
  p_plan_id uuid, p_version_id uuid, p_actor_id uuid, p_command_id uuid,
  p_expected_context_hash text, p_command_text text, p_prepared_context jsonb,
  p_expected_descriptor_id text, p_expected_plan_kind_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  plan_row public.land_use_plans%ROWTYPE;
  previous public.land_use_plan_context_commands%ROWTYPE;
  working public.land_use_plan_versions%ROWTYPE;
  command_json jsonb;
  retained jsonb;
  retained_hash text;
BEGIN
  SELECT * INTO plan_row FROM public.land_use_plans WHERE id = p_plan_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT404', MESSAGE = 'Plan not found';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members WHERE workspace_id = plan_row.workspace_id
      AND user_id = p_actor_id AND role IN ('owner', 'admin', 'member') FOR SHARE NOWAIT
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Current plan write permission required';
  END IF;
  IF p_command_id IS NULL OR p_version_id IS NULL OR p_command_text IS NULL
     OR octet_length(p_command_text) NOT BETWEEN 2 AND 2000000 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Invalid context command';
  END IF;
  SELECT * INTO previous FROM public.land_use_plan_context_commands
    WHERE plan_id = p_plan_id AND command_id = p_command_id;
  IF FOUND THEN
    IF previous.actor_id IS DISTINCT FROM p_actor_id
       OR previous.descriptor_id IS DISTINCT FROM p_expected_descriptor_id
       OR previous.plan_kind_key IS DISTINCT FROM p_expected_plan_kind_key
       OR previous.version_id IS DISTINCT FROM p_version_id
       OR previous.expected_context_hash IS DISTINCT FROM p_expected_context_hash
       OR previous.command_text IS DISTINCT FROM p_command_text THEN
      RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'This command ID already belongs to a different context save';
    END IF;
    RETURN jsonb_build_object('replayed', true, 'context', previous.saved_context,
      'contextHash', previous.saved_context_hash, 'commandId', p_command_id, 'versionId', p_version_id);
  END IF;
  IF plan_row.descriptor_id IS DISTINCT FROM p_expected_descriptor_id
     OR plan_row.plan_kind_key IS DISTINCT FROM p_expected_plan_kind_key THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Plan checklist selection changed. Reassess this context before saving';
  END IF;
  SELECT * INTO working FROM public.land_use_plan_versions
    WHERE id = p_version_id AND plan_id = p_plan_id AND workspace_id = plan_row.workspace_id FOR UPDATE NOWAIT;
  IF NOT FOUND OR working.state <> 'working' OR plan_row.current_working_version_id IS DISTINCT FROM p_version_id THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'The selected working version is no longer current';
  END IF;
  IF plan_row.plan_context_hash IS DISTINCT FROM p_expected_context_hash THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'The plan context changed. Keep this draft and compare the current context';
  END IF;
  BEGIN
    command_json := p_command_text::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Invalid context command JSON';
  END;
  IF (jsonb_typeof(command_json) = 'object'
      AND jsonb_typeof(command_json->'place') = 'object'
      AND jsonb_typeof(command_json->'assessment') = 'object'
      AND jsonb_typeof(p_prepared_context) = 'object'
      AND p_prepared_context->'assessment' = command_json->'assessment') IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', MESSAGE = 'Prepared context does not match the assessed command';
  END IF;
  -- Authority-only edits retain the exact stored boundary and resolver identity.
  IF command_json#>>'{place,mode}' = 'retained' AND (
    plan_row.plan_context IS NULL OR p_prepared_context->'place' IS DISTINCT FROM plan_row.plan_context->'place'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'The saved study area changed. Keep the draft and review the current context';
  END IF;
  retained := (p_prepared_context - 'savedBy' - 'savedAt') || jsonb_build_object(
    'savedBy', p_actor_id, 'savedAt', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  UPDATE public.land_use_plans SET plan_context = retained,
    geography_label = retained#>>'{place,label}', geography_geojson = retained#>'{place,geometry}' WHERE id = p_plan_id
    RETURNING plan_context_hash INTO retained_hash;
  INSERT INTO public.land_use_plan_context_commands(plan_id, command_id, workspace_id, version_id,
    actor_id, descriptor_id, plan_kind_key, expected_context_hash, command_text, saved_context, saved_context_hash)
  VALUES(p_plan_id, p_command_id, plan_row.workspace_id, p_version_id, p_actor_id,
    p_expected_descriptor_id, p_expected_plan_kind_key, p_expected_context_hash, p_command_text, retained, retained_hash);
  RETURN jsonb_build_object('replayed', false, 'context', retained,
    'contextHash', retained_hash, 'commandId', p_command_id, 'versionId', p_version_id);
EXCEPTION WHEN lock_not_available THEN
  RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'This plan is being changed. Keep the same command and retry';
END;
$$;
