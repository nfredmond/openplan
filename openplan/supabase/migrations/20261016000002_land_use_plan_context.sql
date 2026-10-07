-- Preserve plan-owned study geography, authorities and attributed applicability.
-- Historical absence is intentional. Existing frozen snapshots are not changed.
ALTER TABLE public.land_use_plans
  ADD COLUMN plan_context jsonb,
  ADD COLUMN plan_context_hash text GENERATED ALWAYS AS (
    CASE WHEN plan_context IS NULL THEN NULL
    ELSE encode(extensions.digest(plan_context::text, 'sha256'), 'hex') END
  ) STORED;

ALTER TABLE public.land_use_plans ADD CONSTRAINT land_use_plan_context_shape CHECK (
  plan_context IS NULL OR (
    jsonb_typeof(plan_context) = 'object'
    AND plan_context->>'schemaVersion' = '1'
    AND jsonb_typeof(plan_context->'place') = 'object'
    AND jsonb_typeof(plan_context->'assessment') = 'object'
    AND jsonb_typeof(plan_context->'assessment'->'authorities') = 'array'
    AND jsonb_array_length(plan_context->'assessment'->'authorities') > 0
    AND plan_context->>'savedBy' IS NOT NULL
    AND plan_context->>'savedAt' IS NOT NULL
  ) IS TRUE
);
COMMENT ON COLUMN public.land_use_plans.plan_context IS
  'Staff-stated plan authority and applicability, separate from office home and study-place identity. Frozen versions retain their own copy.';

-- Resolved boundary provenance comes from the server. A browser must not write
-- a purported resolver result directly through the table API.
CREATE FUNCTION public.guard_land_use_plan_context_write()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.plan_context IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.plan_context IS DISTINCT FROM OLD.plan_context)
     OR (TG_OP = 'UPDATE' AND OLD.plan_context IS NOT NULL AND (
       NEW.descriptor_id IS DISTINCT FROM OLD.descriptor_id OR NEW.plan_kind_key IS DISTINCT FROM OLD.plan_kind_key)) THEN
    IF current_user NOT IN ('service_role', 'postgres') THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Plan context requires the verified server write path';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER land_use_plan_context_server_write
  BEFORE INSERT OR UPDATE ON public.land_use_plans
  FOR EACH ROW EXECUTE FUNCTION public.guard_land_use_plan_context_write();

CREATE TABLE public.land_use_plan_context_commands (
  plan_id uuid NOT NULL,
  command_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  version_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  descriptor_id text NOT NULL,
  plan_kind_key text NOT NULL,
  expected_context_hash text,
  command_text text NOT NULL CHECK (octet_length(command_text) BETWEEN 2 AND 2000000),
  command_sha256 text GENERATED ALWAYS AS (encode(extensions.digest(command_text, 'sha256'), 'hex')) STORED,
  saved_context jsonb NOT NULL,
  saved_context_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (plan_id, command_id),
  FOREIGN KEY (plan_id, workspace_id) REFERENCES public.land_use_plans(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (version_id, workspace_id) REFERENCES public.land_use_plan_versions(id, workspace_id),
  CHECK (expected_context_hash IS NULL OR expected_context_hash ~ '^[0-9a-f]{64}$'),
  CHECK (saved_context_hash = encode(extensions.digest(saved_context::text, 'sha256'), 'hex'))
);
ALTER TABLE public.land_use_plan_context_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.land_use_plan_context_commands FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.land_use_plan_context_commands TO service_role;
CREATE TRIGGER land_use_plan_context_commands_append_only
  BEFORE UPDATE OR DELETE ON public.land_use_plan_context_commands
  FOR EACH ROW EXECUTE FUNCTION public.refuse_land_use_plan_append_only_rewrite();

-- The service caller authenticates the actor and validates/resolves the command.
-- Membership, working state, attribution, replay and stale writes are checked
-- again here in the same transaction as the save. No SECURITY DEFINER escalation.
CREATE FUNCTION public.save_land_use_plan_context(
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
  retained := (p_prepared_context - 'savedBy' - 'savedAt') || jsonb_build_object(
    'savedBy', p_actor_id, 'savedAt', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  UPDATE public.land_use_plans SET plan_context = retained WHERE id = p_plan_id
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
REVOKE ALL ON FUNCTION public.save_land_use_plan_context(uuid,uuid,uuid,uuid,text,text,jsonb,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_land_use_plan_context(uuid,uuid,uuid,uuid,text,text,jsonb,text,text) TO service_role;

-- A freeze assembled before a context save must not publish the older context.
-- NOWAIT avoids opposite lock-order deadlocks with historical freeze callers.
CREATE FUNCTION public.check_land_use_plan_context_at_freeze()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE current_context jsonb;
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.state <> 'working')
     OR (TG_OP = 'UPDATE' AND OLD.state = 'working' AND NEW.state <> 'working') THEN
    SELECT plan_context INTO current_context FROM public.land_use_plans
      WHERE id = NEW.plan_id AND workspace_id = NEW.workspace_id FOR SHARE NOWAIT;
    IF NOT FOUND OR coalesce(NEW.frozen_snapshot->'planContext', 'null'::jsonb)
       IS DISTINCT FROM coalesce(current_context, 'null'::jsonb) THEN
      RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Plan context changed before freeze. Rebuild the draft snapshot';
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN lock_not_available THEN
  RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'Plan context is being changed. Retry the freeze from current content';
END;
$$;
CREATE TRIGGER land_use_plan_context_freeze_consistency
  BEFORE INSERT OR UPDATE ON public.land_use_plan_versions
  FOR EACH ROW EXECUTE FUNCTION public.check_land_use_plan_context_at_freeze();
