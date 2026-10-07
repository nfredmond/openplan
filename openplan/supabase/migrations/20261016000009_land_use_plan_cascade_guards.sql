-- A restored schema may fire equivalent foreign-key cascades in another order.
-- Parent deletion is not an authored edit; direct child writes remain guarded.
CREATE FUNCTION public.land_use_plan_version_has_live_owner(p_version_id uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.land_use_plan_versions v
    JOIN public.land_use_plans p ON p.id=v.plan_id AND p.workspace_id=v.workspace_id
    JOIN public.workspaces w ON w.id=p.workspace_id
    WHERE v.id=p_version_id
  );
$$;
REVOKE ALL ON FUNCTION public.land_use_plan_version_has_live_owner(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.land_use_plan_version_has_live_owner(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.advance_land_use_plan_child_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE target uuid; targets uuid[]; version_state text;
BEGIN
  IF TG_OP = 'DELETE' AND NOT public.land_use_plan_version_has_live_owner(OLD.version_id) THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN targets := ARRAY[NEW.version_id];
  ELSIF TG_OP = 'DELETE' THEN targets := ARRAY[OLD.version_id];
  ELSE targets := ARRAY[OLD.version_id, NEW.version_id];
  END IF;
  FOR target IN SELECT DISTINCT value FROM unnest(targets) AS value ORDER BY value LOOP
    SELECT state INTO version_state FROM public.land_use_plan_versions
      WHERE id = target FOR UPDATE NOWAIT;
    IF NOT FOUND THEN
      -- Cascading deletion after removal of the owning version is permitted.
      IF TG_OP = 'DELETE' THEN CONTINUE; END IF;
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Current plan version access required';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.version_id IS DISTINCT FROM NEW.version_id AND version_state <> 'working' THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Frozen plan records cannot move between versions';
    END IF;
    IF version_state = 'working' THEN
      UPDATE public.land_use_plan_versions SET draft_revision = draft_revision + 1 WHERE id = target;
    END IF;
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
EXCEPTION WHEN lock_not_available THEN
  RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'The plan version is being changed. Keep this edit and retry';
END;
$$;

CREATE OR REPLACE FUNCTION public.refuse_frozen_land_use_plan_content()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE target_version_id uuid;
BEGIN
  IF TG_OP = 'DELETE' AND NOT public.land_use_plan_version_has_live_owner(OLD.version_id) THEN
    RETURN OLD;
  END IF;
  target_version_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.version_id ELSE NEW.version_id END;
  IF EXISTS (
    SELECT 1 FROM public.land_use_plan_versions
    WHERE id = target_version_id AND frozen_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Frozen land-use plan content is immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.limit_frozen_land_use_plan_action_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT public.land_use_plan_version_has_live_owner(OLD.version_id) THEN
    RETURN OLD;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.land_use_plan_versions
    WHERE id = COALESCE(NEW.version_id, OLD.version_id) AND frozen_at IS NOT NULL
  ) THEN
    IF TG_OP <> 'UPDATE' OR
      NEW.version_id IS DISTINCT FROM OLD.version_id OR
      NEW.content_node_id IS DISTINCT FROM OLD.content_node_id OR
      NEW.title IS DISTINCT FROM OLD.title OR
      NEW.description IS DISTINCT FROM OLD.description OR
      NEW.responsible_party IS DISTINCT FROM OLD.responsible_party OR
      NEW.assignee_user_id IS DISTINCT FROM OLD.assignee_user_id OR
      NEW.due_on IS DISTINCT FROM OLD.due_on OR
      NEW.project_id IS DISTINCT FROM OLD.project_id OR
      NEW.program_id IS DISTINCT FROM OLD.program_id
    THEN
      RAISE EXCEPTION 'A frozen implementation action may only update status and implementation evidence';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.refuse_land_use_plan_append_only_rewrite()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' AND (NOT EXISTS (
    SELECT 1 FROM public.land_use_plans WHERE id = OLD.plan_id AND workspace_id = OLD.workspace_id
  ) OR NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id)) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Land-use plan decisions and frozen implementation reports are append-only';
END;
$$;

-- Delete the workspace-owned receipt in the same cascade level as review events.
-- Its event/version NO ACTION references still reject individual record removal.
ALTER TABLE public.land_use_plan_freeze_commands
  ADD CONSTRAINT land_use_plan_freeze_commands_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
