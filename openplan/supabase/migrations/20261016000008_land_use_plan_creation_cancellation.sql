-- An explicit stop command resolves uncertainty before staff prepares another
-- creation. It cannot delete a plan or change a completed creation receipt.
CREATE TABLE public.land_use_plan_creation_cancellations (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  command_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  command_text text NOT NULL CHECK (octet_length(command_text) BETWEEN 2 AND 2000000),
  receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id, command_id)
);
ALTER TABLE public.land_use_plan_creation_cancellations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.land_use_plan_creation_cancellations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.land_use_plan_creation_cancellations TO service_role;
CREATE FUNCTION public.refuse_land_use_plan_creation_cancellation_rewrite()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' AND NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id=OLD.workspace_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Creation stop receipts are immutable';
END;
$$;
REVOKE ALL ON FUNCTION public.refuse_land_use_plan_creation_cancellation_rewrite() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refuse_land_use_plan_creation_cancellation_rewrite() TO service_role;
CREATE TRIGGER land_use_plan_creation_cancellations_append_only
  BEFORE UPDATE OR DELETE ON public.land_use_plan_creation_cancellations
  FOR EACH ROW EXECUTE FUNCTION public.refuse_land_use_plan_creation_cancellation_rewrite();

-- Creation already holds the same transaction lock used by stop. Refusing its
-- final receipt insert rolls back every earlier plan/version/section write.
CREATE FUNCTION public.refuse_cancelled_land_use_plan_creation()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.land_use_plan_creation_cancellations
      WHERE workspace_id=NEW.workspace_id AND command_id=NEW.command_id) THEN
    RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='This creation request was stopped. Recover its stop receipt before preparing a new request';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.refuse_cancelled_land_use_plan_creation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refuse_cancelled_land_use_plan_creation() TO service_role;
CREATE TRIGGER land_use_plan_creation_respects_cancellation
  BEFORE INSERT ON public.land_use_plan_creation_commands
  FOR EACH ROW EXECUTE FUNCTION public.refuse_cancelled_land_use_plan_creation();

CREATE FUNCTION public.cancel_land_use_plan_creation(
  p_workspace_id uuid, p_actor_id uuid, p_command_id uuid, p_command_text text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  previous public.land_use_plan_creation_commands%ROWTYPE;
  stopped public.land_use_plan_creation_cancellations%ROWTYPE;
  command jsonb; response jsonb;
BEGIN
  IF p_workspace_id IS NULL OR p_actor_id IS NULL OR p_command_id IS NULL
     OR p_command_text IS NULL OR octet_length(p_command_text) NOT BETWEEN 2 AND 2000000 THEN
    RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='Invalid creation stop command';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members
      WHERE workspace_id=p_workspace_id AND user_id=p_actor_id AND role IN ('owner','admin','member') FOR SHARE NOWAIT) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Current plan write permission required';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('land-use-create:' || p_workspace_id::text || ':' || p_command_id::text, 0)) THEN
    RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='This creation request is running. Keep it and retry the stop command';
  END IF;
  SELECT * INTO previous FROM public.land_use_plan_creation_commands
    WHERE workspace_id=p_workspace_id AND command_id=p_command_id;
  IF FOUND THEN
    IF previous.actor_id IS DISTINCT FROM p_actor_id OR previous.command_text IS DISTINCT FROM p_command_text THEN
      RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='This command ID belongs to another creation request';
    END IF;
    RETURN jsonb_build_object('outcome','created','result',previous.receipt || jsonb_build_object('replayed',true));
  END IF;
  SELECT * INTO stopped FROM public.land_use_plan_creation_cancellations
    WHERE workspace_id=p_workspace_id AND command_id=p_command_id;
  IF FOUND THEN
    IF stopped.actor_id IS DISTINCT FROM p_actor_id OR stopped.command_text IS DISTINCT FROM p_command_text THEN
      RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='This command ID belongs to another stopped creation request';
    END IF;
    RETURN stopped.receipt || jsonb_build_object('replayed',true);
  END IF;
  BEGIN
    command := p_command_text::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='Invalid creation JSON';
  END;
  IF (jsonb_typeof(command)='object' AND command->>'commandId'=p_command_id::text) IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='Creation command identity changed';
  END IF;
  response := jsonb_build_object('outcome','cancelled','replayed',false,'commandId',p_command_id,
    'actorId',p_actor_id,'workspaceId',p_workspace_id,'commandText',p_command_text,
    'cancelledAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  INSERT INTO public.land_use_plan_creation_cancellations(workspace_id,command_id,actor_id,command_text,receipt)
    VALUES(p_workspace_id,p_command_id,p_actor_id,p_command_text,response);
  RETURN response;
EXCEPTION WHEN lock_not_available OR unique_violation THEN
  RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='Creation stop conflicted. Keep the same request and retry';
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_land_use_plan_creation(uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_land_use_plan_creation(uuid,uuid,uuid,text) TO service_role;
