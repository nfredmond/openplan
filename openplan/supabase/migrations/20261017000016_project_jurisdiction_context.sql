-- Candidate only. Parent coordinates isolated native/RLS/upgrade/restore proof before rollout.
ALTER TABLE public.projects ADD COLUMN jurisdiction_context jsonb;
COMMENT ON COLUMN public.projects.jurisdiction_context IS
  'Independent human-declared jurisdiction context v1. Null is legacy; unresolved suppresses study-place fallback. Not geometry, adopting authority or legal applicability.';

CREATE FUNCTION public.valid_project_jurisdiction_context(value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE item jsonb;
BEGIN
  IF value IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(value) <> 'object' OR octet_length(value::text) > 20000
    OR NOT (value ?& ARRAY['version','state','entries','recordedBy','recordedAt'])
    OR value - ARRAY['version','state','entries','recordedBy','recordedAt'] <> '{}'::jsonb
    OR value->'version' <> '1'::jsonb
    OR jsonb_typeof(value->'state') <> 'string' OR value->>'state' NOT IN ('unresolved','declared')
    OR jsonb_typeof(value->'entries') <> 'array'
    OR jsonb_typeof(value->'recordedBy') <> 'string'
    OR jsonb_typeof(value->'recordedAt') <> 'string'
    OR value->>'recordedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN RETURN false; END IF;
  PERFORM (value->>'recordedBy')::uuid;
  PERFORM (value->>'recordedAt')::timestamptz;
  IF jsonb_array_length(value->'entries') > 12
    OR (value->>'state' = 'unresolved' AND jsonb_array_length(value->'entries') <> 0)
    OR (value->>'state' = 'declared' AND jsonb_array_length(value->'entries') = 0) THEN RETURN false; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(value->'entries') LOOP
    IF jsonb_typeof(item) <> 'object'
      OR NOT (item ?& ARRAY['label','countryCode','subdivisionCode','kind','reference','scope','identity'])
      OR item - ARRAY['label','countryCode','subdivisionCode','kind','reference','scope','identity'] <> '{}'::jsonb
      OR jsonb_typeof(item->'label') <> 'string' OR length(btrim(item->>'label')) NOT BETWEEN 1 AND 200
      OR jsonb_typeof(item->'kind') <> 'string' OR length(btrim(item->>'kind')) NOT BETWEEN 1 AND 80
      OR jsonb_typeof(item->'scope') <> 'string' OR item->>'scope' NOT IN ('administrative','sovereign','overlap','other')
      OR jsonb_typeof(item->'identity') <> 'string' OR item->>'identity' NOT IN ('staff_declared','server_resolved')
      OR (item->'countryCode' <> 'null'::jsonb AND (jsonb_typeof(item->'countryCode') <> 'string' OR item->>'countryCode' !~ '^[A-Z]{2}$'))
      OR (item->'subdivisionCode' <> 'null'::jsonb AND (jsonb_typeof(item->'subdivisionCode') <> 'string' OR item->>'subdivisionCode' !~ '^[A-Z0-9-]{1,16}$'))
      OR (item->'reference' <> 'null'::jsonb AND (jsonb_typeof(item->'reference') <> 'string' OR item->>'reference' !~ '^[a-z][a-z0-9._-]*:[^[:space:]]{1,180}$'))
      THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.valid_project_jurisdiction_context(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.valid_project_jurisdiction_context(jsonb) TO authenticated, service_role;
ALTER TABLE public.projects ADD CONSTRAINT projects_jurisdiction_context_valid
  CHECK (public.valid_project_jurisdiction_context(jurisdiction_context));

-- Existing table grants cannot express a denial for one column. Enforce the narrow
-- server-only write seam even when an ordinary authenticated user bypasses the UI.
CREATE FUNCTION public.guard_project_jurisdiction_context()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.jurisdiction_context IS NOT NULL)
    OR (TG_OP = 'UPDATE' AND NEW.jurisdiction_context IS DISTINCT FROM OLD.jurisdiction_context) THEN
    IF current_user NOT IN ('service_role', 'postgres') THEN
      RAISE EXCEPTION 'Project jurisdiction requires the authorized human server route' USING ERRCODE = '42501';
    END IF;
    IF NEW.jurisdiction_context IS NULL THEN
      RAISE EXCEPTION 'Clear project jurisdiction to explicit unresolved' USING ERRCODE = '23514';
    END IF;
    IF current_user = 'service_role' THEN
      -- Recheck and hold the attributed actor's current writer membership in
      -- this statement, closing the route-check to service-write race.
      PERFORM 1 FROM public.workspace_members AS member
        WHERE member.workspace_id = NEW.workspace_id
          AND member.user_id = (NEW.jurisdiction_context->>'recordedBy')::uuid
          AND public.workspace_role_rank(member.role) >= 2
        FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Current attributed workspace writer required' USING ERRCODE = '42501';
      END IF;
      NEW.jurisdiction_context := jsonb_set(NEW.jurisdiction_context, '{recordedAt}', to_jsonb(clock_timestamp()));
      NEW.updated_at := clock_timestamp();
    END IF;
    -- Trusted postgres archive restoration preserves the original provenance
    -- and revision. Ordinary authenticated writers cannot enter this branch.
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_project_jurisdiction_context() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER projects_jurisdiction_context_guard BEFORE INSERT OR UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.guard_project_jurisdiction_context();
