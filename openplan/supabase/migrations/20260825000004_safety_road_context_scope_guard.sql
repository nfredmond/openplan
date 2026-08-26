-- A service-authored cache still needs a database-enforced tenant seam. The
-- service role bypasses RLS, so the project/workspace pairing is guarded by a
-- trigger that runs for every cache insert or scope change.

CREATE OR REPLACE FUNCTION public.validate_safety_road_context_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = NEW.project_id AND p.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'Safety road context project must belong to its workspace';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS safety_road_context_scope_guard ON public.safety_road_context_features;
CREATE TRIGGER safety_road_context_scope_guard
  BEFORE INSERT OR UPDATE OF workspace_id, project_id
  ON public.safety_road_context_features
  FOR EACH ROW EXECUTE FUNCTION public.validate_safety_road_context_scope();

REVOKE ALL ON FUNCTION public.validate_safety_road_context_scope() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_safety_road_context_scope() TO service_role;
