-- The neutral crash vocabulary reaches storage, and a missing casualty count
-- stops being reported as "nobody was hurt".
--
-- ============================================================================
-- 1. THE DEFECT THIS FIXES FIRST, BECAUSE EVERYTHING ELSE DEPENDS ON IT
-- ============================================================================
--
-- `safety_crashes.severity` admitted four values: fatal, severe_injury, injury,
-- pdo. The California adapter derived the band from two count columns, and the
-- parser it used returned 0 for a value it could not read. So a collision the
-- source reported WITHOUT any casualty count arrived as "0 killed, 0 injured"
-- and was stored, filtered, painted and counted as PROPERTY DAMAGE ONLY.
--
-- Measured against the live source on 2026-08-11 (`IsDeleted = 'False'`):
--
--     statewide 2025            401,301 crashes
--       NumberKilled NULL        19,637
--       NumberInjured NULL       18,970
--       BOTH NULL                18,967   (4.7%)
--     one rural county 2025        1,180 crashes
--       BOTH NULL                   112   (9.5%)
--
-- These are not secretly fatal collisions: the person-level table returns zero
-- rows for them, so the outcome is genuinely UNRECORDED. `NumberKilled` also
-- carries '-1' in the wild, which a `max(0, …)` clamp turned into 0 as well.
--
-- The module's own rule is that a count which could not be read is not zero.
-- This migration makes that true in the schema: `severity` gains 'unknown',
-- and `killed_count` / `injured_count` drop NOT NULL so an unsupplied count can
-- stay unsupplied all the way to the screen.
--
-- ORDERING MATTERS AND IS LOAD-BEARING. This migration must land BEFORE any
-- change that defaults the property-damage-only filter off. Flip that default
-- first and roughly 5–10% of every California workspace's crashes vanish from
-- the map with no explanation, because they are sitting in the PDO bucket by
-- mistake.
--
-- ============================================================================
-- 2. THE NEUTRAL DIMENSIONS
-- ============================================================================
--
-- Three new dimension columns, each a closed neutral vocabulary declared once in
-- `src/lib/safety/vocabulary.ts`. The values name the PHYSICAL FACT and never a
-- jurisdiction's spelling: 'angle', not one state's "BROADSIDE"; 'dark_unlighted',
-- not a code letter. A source translates into them through a descriptor
-- (`sources/ccrs-vocabulary.ts` is the first); another state's feed is another
-- descriptor, not a schema change and not an edit to a filter enum an Ohio
-- planner would see.
--
-- WIDE TABLE, NOT A COMPANION TABLE. These are five low-cardinality texts that
-- the filter panel ANDs against a bounding box over 10^4–10^5 rows. A join per
-- map query buys nothing; a JSONB blob would be untyped to filter on and could
-- not generate a Postgres predicate and a TypeScript predicate from one column
-- name. `source_attributes` exists for the values the mapping does NOT cover, so
-- nothing is silently dropped.
--
-- EVERY DIMENSION COLUMN IS NULLABLE, AND NULL MEANS SOMETHING SPECIFIC:
-- the SOURCE does not record this dimension at all. That is different from
-- 'unknown', which means the source records it and had nothing for this crash.
-- The difference is disclosed per acquisition in `dimension_coverage` below, and
-- the filter panel renders a not-supplied facet as disabled with a reason rather
-- than as an empty list — because an empty list reads as "no crash here happened
-- after dark", which is a finding the source cannot support.
--
-- NO NEW INDEXES, DELIBERATELY. `(workspace_id, …)` and the lat/lng and GiST
-- indexes are the selective predicates; six low-cardinality btrees would cost
-- every write and buy nothing at this row count. The measurement that would
-- change the decision: EXPLAIN (ANALYZE) on a county-decade extract with three
-- facets selected.
--
-- ============================================================================
-- 3. GRANTS — read this before editing
-- ============================================================================
--
-- `safety_crashes` and `safety_crash_ingests` were created 2026-07-23, BEFORE
-- `20260804000001` flipped default privileges to deny, and no migration in the
-- corpus has ever named either table in a GRANT or a REVOKE. They therefore
-- carry Supabase's bootstrap privilege residue for `anon` and `authenticated`.
-- RLS keeps that harmless today only because neither table has a permissive
-- write policy.
--
-- Relying on "the policies happen to be read-only" is relying on a convention.
-- The explicit block at the bottom narrows the residue to exactly what the
-- policies promise (member SELECT), records the INSERT/UPDATE/DELETE denial in
-- the corpus so the grant-composition guard can police it forever, and revokes
-- BEFORE granting — Postgres drops column privileges along with table-level
-- ones, so a revoke placed after a grant destroys it.
--
-- Idempotent: every statement re-runs as a no-op.

------------------------------------------------------------------------------
-- 1. Severity gains 'unknown', and the casualty counts become nullable.
------------------------------------------------------------------------------
ALTER TABLE public.safety_crashes DROP CONSTRAINT IF EXISTS safety_crashes_severity_check;

ALTER TABLE public.safety_crashes
  ADD CONSTRAINT safety_crashes_severity_check
  CHECK (severity IN ('fatal','severe_injury','injury','pdo','unknown'));

ALTER TABLE public.safety_crashes ALTER COLUMN killed_count DROP NOT NULL;
ALTER TABLE public.safety_crashes ALTER COLUMN injured_count DROP NOT NULL;

-- The DEFAULT 0 is dropped with the NOT NULL. Leaving it would mean an INSERT
-- that omits the column still writes a fabricated zero, which is the whole
-- defect wearing a different hat.
ALTER TABLE public.safety_crashes ALTER COLUMN killed_count DROP DEFAULT;
ALTER TABLE public.safety_crashes ALTER COLUMN injured_count DROP DEFAULT;

COMMENT ON COLUMN public.safety_crashes.killed_count IS
  'People killed, or NULL when the source supplied no count. NULL is not zero: a source that recorded no casualty count has not reported that nobody died, and such rows carry severity = ''unknown''.';
COMMENT ON COLUMN public.safety_crashes.injured_count IS
  'People injured, or NULL when the source supplied no count. A fatality census supplies none at all.';

------------------------------------------------------------------------------
-- 2. Neutral dimension columns.
------------------------------------------------------------------------------
ALTER TABLE public.safety_crashes
  ADD COLUMN IF NOT EXISTS collision_type text,
  ADD COLUMN IF NOT EXISTS lighting text,
  ADD COLUMN IF NOT EXISTS weather text,
  -- The third vulnerable-road-user flag. Motorcyclists were invisible at every
  -- layer of this product: probed 2025, 12,513 collisions in one state involve a
  -- motorcycle and no crash-level column names them. NOT NULL DEFAULT false
  -- matches its two siblings; a source that cannot express it declares
  -- `party_role` below 'supplied' in `dimension_coverage`, which is what keeps a
  -- false from reading as "no motorcyclist was involved".
  ADD COLUMN IF NOT EXISTS motorcyclist_involved boolean NOT NULL DEFAULT false,
  -- Values the source supplied that its descriptor does not declare, kept
  -- verbatim under their own source column name. A value we could not classify
  -- is preserved rather than dropped, so an operator can audit what the mapping
  -- is missing. NOTHING outside src/lib/safety/sources/** may read a key out of
  -- this blob — the moment a screen does, a source's private spelling has become
  -- part of the product's vocabulary.
  ADD COLUMN IF NOT EXISTS source_attributes jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.safety_crashes DROP CONSTRAINT IF EXISTS safety_crashes_collision_type_check;
ALTER TABLE public.safety_crashes
  ADD CONSTRAINT safety_crashes_collision_type_check CHECK (
    collision_type IS NULL OR collision_type IN (
      'rear_end','sideswipe','head_on','angle','hit_object','overturn',
      'vehicle_pedestrian','other','unknown'
    )
  );

ALTER TABLE public.safety_crashes DROP CONSTRAINT IF EXISTS safety_crashes_lighting_check;
ALTER TABLE public.safety_crashes
  ADD CONSTRAINT safety_crashes_lighting_check CHECK (
    lighting IS NULL OR lighting IN (
      'daylight','dawn_dusk','dark_lighted','dark_unlighted',
      'dark_lighting_inoperative','unknown'
    )
  );

ALTER TABLE public.safety_crashes DROP CONSTRAINT IF EXISTS safety_crashes_weather_check;
ALTER TABLE public.safety_crashes
  ADD CONSTRAINT safety_crashes_weather_check CHECK (
    weather IS NULL OR weather IN ('clear','cloudy','rain','snow','fog','wind','other','unknown')
  );

COMMENT ON COLUMN public.safety_crashes.collision_type IS
  'Neutral manner of collision, or NULL when the source does not record one. NULL differs from ''unknown'': see safety_crash_ingests.dimension_coverage.';
COMMENT ON COLUMN public.safety_crashes.lighting IS
  'Neutral lighting condition, or NULL when the source does not record one.';
COMMENT ON COLUMN public.safety_crashes.weather IS
  'Neutral weather condition, or NULL when the source does not record one. Only exact declared source spellings map; everything else is ''other'' with the raw string kept in source_attributes.';

------------------------------------------------------------------------------
-- 3. Per-acquisition disclosure on the ingest row.
------------------------------------------------------------------------------
ALTER TABLE public.safety_crash_ingests
  -- {dimension: {support: supplied|partial|not_supplied, unmapped?: n}} — written
  -- from the adapter's own capability declaration. This is the mechanism that
  -- keeps "this source has no lighting field" from rendering as "no crash here
  -- happened after dark".
  ADD COLUMN IF NOT EXISTS dimension_coverage jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS party_completeness text NOT NULL DEFAULT 'not_supported',
  -- NULLABLE ON PURPOSE. A run that failed to retrieve person rows has no count,
  -- and 0 would say the collisions involved nobody.
  ADD COLUMN IF NOT EXISTS party_count integer,
  -- Which basis the pedestrian / bicyclist / motorcyclist flags rest on. The two
  -- disagree by up to 17% (crash-level flags undercount), so a figure whose basis
  -- is unrecorded cannot be compared against the same figure from another run.
  ADD COLUMN IF NOT EXISTS involvement_basis text;

ALTER TABLE public.safety_crash_ingests DROP CONSTRAINT IF EXISTS safety_crash_ingests_party_completeness_check;
ALTER TABLE public.safety_crash_ingests
  ADD CONSTRAINT safety_crash_ingests_party_completeness_check CHECK (
    party_completeness IN ('retrieved','not_retrieved','not_supported')
  );

ALTER TABLE public.safety_crash_ingests DROP CONSTRAINT IF EXISTS safety_crash_ingests_involvement_basis_check;
ALTER TABLE public.safety_crash_ingests
  ADD CONSTRAINT safety_crash_ingests_involvement_basis_check CHECK (
    involvement_basis IS NULL OR involvement_basis IN ('party_rows','crash_flags')
  );

COMMENT ON COLUMN public.safety_crash_ingests.dimension_coverage IS
  'Per-dimension source capability (supplied/partial/not_supplied) plus how many values fell outside the mapping. Rendered as a disabled facet with a reason, never as an empty filter result.';
COMMENT ON COLUMN public.safety_crash_ingests.party_count IS
  'People stored for this acquisition, or NULL when person rows were not retrieved. Never 0-for-unknown.';

------------------------------------------------------------------------------
-- 4. Grants. Revoke first — see the header.
------------------------------------------------------------------------------
REVOKE ALL ON TABLE public.safety_crashes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.safety_crash_ingests FROM PUBLIC, anon, authenticated;

-- Exactly what the two permissive policies promise: member SELECT, nothing else.
-- No client INSERT/UPDATE/DELETE, because every write is an authed API route
-- using the service role after an explicit membership check. `anon` gets
-- nothing: a crash point is a precise coordinate and date for a real injury.
GRANT SELECT ON TABLE public.safety_crashes TO authenticated;
GRANT SELECT ON TABLE public.safety_crash_ingests TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.safety_crashes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.safety_crash_ingests TO service_role;
