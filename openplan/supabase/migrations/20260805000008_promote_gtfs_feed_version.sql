-- Promoting one ingest of a feed to "the one in use", as a single statement.
--
-- WHY THIS IS A DATABASE FUNCTION AND NOT THREE SUPABASE-JS CALLS. It is not
-- tidiness and it is not performance. 20260805000006 records "which ingest of
-- this feed is in use" in three places on purpose — `gtfs_feed_versions
-- .is_current`, `gtfs_feeds.current_version_id` and the `gtfs_feeds.status`
-- mirror the Data Hub card renders — and
-- `src/test/gtfs-feed-status-mirrors-its-current-version.test.ts` fails the live
-- gate on any disagreement between them. Those three facts cannot be moved from
-- an old version to a new one by any ORDERING of separate statements:
--
--   * Clear the old version's `is_current` first, and for the duration of the
--     next round trip `gtfs_feeds.current_version_id` points at a version that
--     is no longer current — the guard's DANGLING_POINTERS case.
--   * Set the new version's `is_current` first, and the partial unique index
--     `gtfs_feed_versions_one_current_per_feed` rejects it outright, because the
--     old one is still flagged. There is no window to reason about; it simply
--     fails.
--   * Move the feed pointer first, and the old version is left `is_current`
--     with its feed pointing elsewhere — the guard's UNPOINTED_CURRENT_VERSIONS
--     case.
--
-- Every order breaks one of the three invariants, so the transition has to be
-- atomic. That is what a function gives us, and it is the whole reason this file
-- exists.
--
-- WHAT IT ALSO BUYS, AND THIS IS THE PART WORTH THE MIGRATION ON ITS OWN: the
-- refusal to promote a version that is not `ready` becomes a property of the
-- DATABASE rather than a check some route remembers to make. A version that
-- failed, that is still parsing, or that was refused can never become the feed a
-- workspace analyses with — not through this function, not through a future
-- route, and not through an assistant action. `gtfs_feed_versions_ready_is_not_
-- empty` already makes an empty feed unstorable as `ready`; together the two
-- mean "the current version of a feed has routes, stops and derived service
-- levels" is guaranteed by the schema instead of asserted by a test.
--
-- WHAT IT DELIBERATELY DOES NOT DECIDE. Whether a newly-ready version SHOULD be
-- promoted is a judgement about the DATA — a refetch that derives materially
-- fewer routes or stops than the version in use is a collapse, and promoting it
-- would silently replace good service data with a truncated feed. That decision
-- needs both versions' counts and belongs in `src/lib/gtfs/persist.ts`, which
-- can explain itself to a planner. This function is the mechanism; it is not the
-- policy, and it must not grow into it.

BEGIN;

CREATE OR REPLACE FUNCTION public.promote_gtfs_feed_version(p_version_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_feed_id uuid;
  v_status text;
BEGIN
  -- FOR UPDATE so two concurrent ingests of the same feed serialise here rather
  -- than racing to be current. The loser waits and then promotes over the
  -- winner, which is the correct outcome: the later promotion is the newer
  -- decision, and only one row can hold the flag either way.
  SELECT feed_id, status
    INTO v_feed_id, v_status
    FROM public.gtfs_feed_versions
   WHERE id = p_version_id
     FOR UPDATE;

  IF v_feed_id IS NULL THEN
    RAISE EXCEPTION 'gtfs_feed_version % does not exist', p_version_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- The refusal described in the header. A caller that wants a failed version
  -- promoted has to change its status first, which no code path does and which
  -- the `ready`-is-not-empty CHECK independently prevents from being a lie.
  IF v_status IS DISTINCT FROM 'ready' THEN
    RAISE EXCEPTION
      'refusing to promote gtfs_feed_version % because its status is %, not ready',
      p_version_id, coalesce(v_status, '<null>')
      USING ERRCODE = 'check_violation';
  END IF;

  -- Order inside the transaction still matters, because the partial unique
  -- index is checked per statement: the outgoing version must lose the flag
  -- before the incoming one takes it.
  UPDATE public.gtfs_feed_versions
     SET is_current = false
   WHERE feed_id = v_feed_id
     AND is_current
     AND id <> p_version_id;

  UPDATE public.gtfs_feed_versions
     SET is_current = true
   WHERE id = p_version_id;

  -- `status` is the mirror; `loaded_at` is what the Data Hub card renders as
  -- "when this feed was last brought in", and the moment a version becomes
  -- current is exactly that moment.
  UPDATE public.gtfs_feeds
     SET current_version_id = p_version_id,
         status = v_status,
         loaded_at = now()
   WHERE id = v_feed_id;
END;
$$;

COMMENT ON FUNCTION public.promote_gtfs_feed_version(uuid) IS
  'Atomically make one gtfs_feed_version the current one: clears the outgoing flag, sets the incoming one, and moves the gtfs_feeds pointer, status mirror and loaded_at together. Refuses any version that is not ready. No ordering of separate statements can do this without transiently violating one of the three mirror invariants.';

-- Every write in the GTFS lane is service-role; no browser session promotes a
-- feed version. Granting EXECUTE to a client role would put a function that
-- rewrites which service data a workspace analyses with behind nothing but RLS
-- on tables it does not itself read.
REVOKE ALL ON FUNCTION public.promote_gtfs_feed_version(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.promote_gtfs_feed_version(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.promote_gtfs_feed_version(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.promote_gtfs_feed_version(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Two honesty gaps the persist lane found by trying to fill these columns in
-- ---------------------------------------------------------------------------
--
-- 1. `shapes_status` HAD NO VALUE FOR WHAT ACTUALLY HAPPENS. Its vocabulary was
--    ('written', 'skipped_too_large', 'absent'), and 20260805000006's own
--    comment explains why the distinction matters: recording WHY shapes are
--    missing keeps "this agency publishes no shapes" apart from "we declined to
--    store 400 MB of them", which are different answers to a planner asking why
--    the map has no route lines. There is a THIRD answer the vocabulary did not
--    admit, and it is the one that is true today: OpenPlan's parser does not
--    read shapes.txt AT ALL. `src/lib/gtfs/parse.ts` produces no shape records,
--    by design — this lane derives service levels, and route alignments belong
--    to the map work that comes after it.
--
--    Every value already in the enum would therefore have been a false
--    statement. `absent` claims the agency published none, which is wrong for
--    every feed that ships shapes.txt — Sacramento Regional Transit's does, and
--    so do most. `skipped_too_large` invents a size refusal that never happened.
--    A planner reading "no shapes in this feed" would go back to their transit
--    agency and ask them to fix a feed that was never broken.
--
-- 2. `calendar_service_count` is NOT NULL DEFAULT 0, and the parser does not
--    expose a count of every service_id in calendar.txt. Leaving the default
--    would write a literal 0 next to a feed that plainly has services — a
--    plausible wrong number on a surface, which is the failure this schema's
--    CHECKs exist to prevent. What the parser DOES know exactly is how many
--    distinct services produced the derived rows, so the column is given that
--    precise meaning here rather than being filled with a lie or left to a
--    default that reads as a measurement.

ALTER TABLE public.gtfs_feed_versions
  DROP CONSTRAINT IF EXISTS gtfs_feed_versions_shapes_status_check;

ALTER TABLE public.gtfs_feed_versions
  ADD CONSTRAINT gtfs_feed_versions_shapes_status_check
  CHECK (shapes_status IN ('written', 'skipped_too_large', 'absent', 'not_ingested'));

ALTER TABLE public.gtfs_feed_versions
  ALTER COLUMN shapes_status SET DEFAULT 'not_ingested';

COMMENT ON COLUMN public.gtfs_feed_versions.shapes_status IS
  'Why this version has no shape geometry. ''not_ingested'' is the current and normal answer: the service-level parser does not read shapes.txt at all, which is different from the agency not publishing it (''absent'') and from a size refusal (''skipped_too_large'').';

COMMENT ON COLUMN public.gtfs_feed_versions.calendar_service_count IS
  'Distinct GTFS service_ids that produced this version''s derived service levels — the services active on the representative date chosen for each day name. NOT the number of rows in calendar.txt, which the service-level parser never counts.';

COMMIT;
