-- A workspace time zone, so "today" is the agency's day and not the server's.
--
-- WHY THIS EXISTS
--
-- Servers run in UTC, and 39 places derived a calendar day by slicing a UTC
-- timestamp. The UTC date turns over at 5 p.m. Pacific, so a measure claim
-- submitted that evening was stamped the next day and a deadline due that day
-- read as passed (KI-2026-10-12-016). The application now asks one helper
-- (src/lib/time/workspace-calendar.ts) for the workspace's day; this column is
-- the zone it uses first.
--
-- POSTURE
--
--   * NULLABLE, NO BACKFILL. NULL means "not chosen". The helper then uses the
--     zone CLDR lists for the workspace's home country when that country has
--     exactly one, and otherwise UTC, and it says which rule it used. Nothing
--     here guesses a zone for an existing workspace.
--
--   * AN IANA NAME, VALIDATED BY THE DATABASE. A CHECK cannot read a table, so
--     a BEFORE trigger compares the value with pg_timezone_names. The CHECK
--     constraint only bounds the shape (length and characters). Abbreviations
--     such as "PST" are not zone names and are refused, as are the tz database
--     helper entries (`posixrules`, `localtime`, `Factory`) and the `posix/`
--     and `right/` trees.
--
--   * WRITES THROUGH ONE FUNCTION. `workspaces` has only the member SELECT
--     policy (20260219000002), and every write goes through a route using the
--     service role. This adds no UPDATE policy. Instead
--     `set_workspace_time_zone` is SECURITY DEFINER, reads the caller from
--     auth.uid() (never from an argument), and refuses anyone who is not an
--     owner or admin of that workspace, the role matrix's `workspace.configure`
--     audience. It can change only this one column. The route
--     /api/workspaces/home-geography calls it with the planner's own session,
--     so the database, not only the route, decides who may set the zone.
--
--   * ADDITIVE. One column, one CHECK, one trigger, two functions. No policy is
--     created, altered or dropped.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS time_zone text;

COMMENT ON COLUMN public.workspaces.time_zone IS
  'IANA time zone name the workspace dates its records in (for example the zone an owner chose in Workspace setup). NULL means not chosen: the application then uses its documented fallback and labels it.';

ALTER TABLE public.workspaces
  ADD CONSTRAINT workspaces_time_zone_shape
  CHECK (
    time_zone IS NULL
    OR (char_length(time_zone) BETWEEN 1 AND 64 AND time_zone ~ '^[A-Za-z][A-Za-z0-9_+/-]*$')
  );

CREATE FUNCTION public.workspaces_require_iana_time_zone()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.time_zone IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.time_zone IN ('posixrules', 'localtime', 'Factory')
    OR NEW.time_zone LIKE 'posix/%'
    OR NEW.time_zone LIKE 'right/%'
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = NEW.time_zone) THEN
    RAISE EXCEPTION 'Not an IANA time zone name: %', NEW.time_zone USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.workspaces_require_iana_time_zone() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.workspaces_require_iana_time_zone() FROM anon;
REVOKE ALL ON FUNCTION public.workspaces_require_iana_time_zone() FROM authenticated;

CREATE TRIGGER workspaces_time_zone_is_iana
  BEFORE INSERT OR UPDATE OF time_zone ON public.workspaces
  FOR EACH ROW
  EXECUTE FUNCTION public.workspaces_require_iana_time_zone();

-- Set (or clear, with NULL or an empty string) the caller's workspace time
-- zone. Returns the stored value. A caller who is not an owner or admin of the
-- workspace, including a non-member, gets the same refusal, so the function
-- cannot be used to learn which workspace ids exist.
CREATE FUNCTION public.set_workspace_time_zone(p_workspace_id uuid, p_time_zone text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_zone text := nullif(btrim(p_time_zone), '');
BEGIN
  IF p_workspace_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.workspace_members m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id = (SELECT auth.uid())
      AND m.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Only workspace owners and admins can set the time zone' USING ERRCODE = '42501';
  END IF;

  -- The trigger above refuses a name that is not an IANA zone.
  UPDATE public.workspaces SET time_zone = v_zone WHERE id = p_workspace_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only workspace owners and admins can set the time zone' USING ERRCODE = '42501';
  END IF;

  RETURN v_zone;
END
$$;

REVOKE ALL ON FUNCTION public.set_workspace_time_zone(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_workspace_time_zone(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_workspace_time_zone(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_workspace_time_zone(uuid, text) TO service_role;
