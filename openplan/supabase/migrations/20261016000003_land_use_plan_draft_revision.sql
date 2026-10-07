-- Detect every mutable input read while assembling a public-review snapshot.
-- Historical snapshots and content hashes remain unchanged.
ALTER TABLE public.land_use_plan_versions
  ADD COLUMN draft_revision integer NOT NULL DEFAULT 0 CHECK (draft_revision >= 0);
COMMENT ON COLUMN public.land_use_plan_versions.draft_revision IS
  'Database-maintained edit counter for exact working-version freeze preconditions. Historical frozen content is not backfilled.';

CREATE FUNCTION public.guard_land_use_plan_draft_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.draft_revision <> 0 THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'A new plan version starts at draft revision zero';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Plan version ownership cannot change';
  END IF;
  IF NEW.draft_revision IS DISTINCT FROM OLD.draft_revision AND pg_trigger_depth() = 1 THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Draft revision is maintained by plan writes';
  END IF;
  IF OLD.state <> 'working' AND NEW.draft_revision IS DISTINCT FROM OLD.draft_revision THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Frozen draft revision cannot change';
  END IF;
  IF OLD.state = 'working' AND (
    NEW.version_number IS DISTINCT FROM OLD.version_number OR NEW.version_kind IS DISTINCT FROM OLD.version_kind
    OR NEW.based_on_version_id IS DISTINCT FROM OLD.based_on_version_id
    OR NEW.applicable_requirement_keys IS DISTINCT FROM OLD.applicable_requirement_keys
  ) THEN
    NEW.draft_revision := OLD.draft_revision + 1;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER land_use_plan_versions_guard_draft_revision
  BEFORE INSERT OR UPDATE ON public.land_use_plan_versions
  FOR EACH ROW EXECUTE FUNCTION public.guard_land_use_plan_draft_revision();

-- Run before existing immutability checks. Holding the version lock makes those
-- checks and the subsequent child write indivisible with respect to freezing.
CREATE FUNCTION public.advance_land_use_plan_child_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE target uuid; targets uuid[]; version_state text;
BEGIN
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
DO $$
DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY[
    'land_use_plan_content_nodes', 'land_use_plan_relationships',
    'land_use_plan_designations', 'land_use_plan_designation_policy_links',
    'land_use_plan_implementation_actions', 'land_use_plan_process_records',
    'land_use_plan_consultation_records'
  ] LOOP
    EXECUTE format('CREATE TRIGGER aa_land_use_plan_write_revision BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.advance_land_use_plan_child_revision()', relation);
  END LOOP;
END;
$$;

CREATE FUNCTION public.advance_land_use_plan_identity_revision()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE working_id uuid;
BEGIN
  IF NEW.title IS NOT DISTINCT FROM OLD.title
     AND NEW.descriptor_id IS NOT DISTINCT FROM OLD.descriptor_id
     AND NEW.plan_kind_key IS NOT DISTINCT FROM OLD.plan_kind_key
     AND NEW.authority_label IS NOT DISTINCT FROM OLD.authority_label
     AND NEW.geography_label IS NOT DISTINCT FROM OLD.geography_label
     AND NEW.geography_geojson IS NOT DISTINCT FROM OLD.geography_geojson
     AND NEW.plan_context IS NOT DISTINCT FROM OLD.plan_context THEN RETURN NEW;
  END IF;
  SELECT id INTO working_id FROM public.land_use_plan_versions
    WHERE id = OLD.current_working_version_id AND plan_id = OLD.id AND workspace_id = OLD.workspace_id
      AND state = 'working' FOR UPDATE NOWAIT;
  IF FOUND THEN
    UPDATE public.land_use_plan_versions SET draft_revision = draft_revision + 1 WHERE id = working_id;
  END IF;
  RETURN NEW;
EXCEPTION WHEN lock_not_available THEN
  RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'The plan version is being changed. Keep this edit and retry';
END;
$$;
CREATE TRIGGER land_use_plan_identity_revision
  BEFORE UPDATE ON public.land_use_plans
  FOR EACH ROW EXECUTE FUNCTION public.advance_land_use_plan_identity_revision();
