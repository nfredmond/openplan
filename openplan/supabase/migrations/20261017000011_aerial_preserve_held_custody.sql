-- Preserve recorded held bytes when a later custody attempt loses its race.
-- This adds no table, changes no existing row and grants no member write.
-- Retry counters remain mutable; original custody facts require a new record.
CREATE OR REPLACE FUNCTION public.preserve_aerial_held_custody()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.state = 'held'
     AND (to_jsonb(NEW) - ARRAY['attempt_count', 'last_attempt_at', 'updated_at'])
       IS DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['attempt_count', 'last_attempt_at', 'updated_at']) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'aerial_held_custody_immutable',
      MESSAGE = 'Original held aerial custody cannot be replaced';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.preserve_aerial_held_custody() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preserve_aerial_held_custody() TO service_role;

CREATE TRIGGER trg_preserve_aerial_held_custody
BEFORE UPDATE ON public.aerial_artifact_custody
FOR EACH ROW EXECUTE FUNCTION public.preserve_aerial_held_custody();

COMMENT ON FUNCTION public.preserve_aerial_held_custody() IS
  'Keeps original held custody facts across later competing writes; permits retry counters without granting new access.';
