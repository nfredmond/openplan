-- A project can state the area it covers, so other modules stop asking.
--
-- WHY THIS EXISTS
--   20260723000005 gave `workspaces` a home geography and, in its own posture
--   note, justified keeping it to one row per tenant like this:
--
--       "Multi-area work already has a home: projects and model study areas
--        carry their own geometry."
--
--   That was not true. A project carried `latitude`/`longitude` (20260421000065)
--   and nothing else — and until eead1636 nothing wrote even those. A point is
--   not a study area: it cannot be buffered into tracts, it has no GEOID to
--   derive a county filter from, and it is not a Polygon any model run would
--   accept. So every module that needed an area asked for one again:
--
--     * county runs make a planner hand-type a FIPS code and a label;
--     * the model run manager opens its study-area picker empty, unlike
--       Analysis Studio and Safety which prefill from the workspace;
--     * engagement representativeness has no project area at all, so it infers
--       one from where respondents happen to be — which is circular for a
--       screen whose whole job is finding who did NOT respond.
--
--   This migration makes that sentence true.
--
-- POSTURE — the same four rules as 20260723000005, for the same reasons
--   * COLUMNS ON `projects`, NOT A NEW TABLE. One project covers one area; a
--     1:1 fact belongs on the row, and a `study_areas` table would be a second
--     competing answer to "where is this work?".
--   * JURISDICTION-NEUTRAL (source, kind, ref). No column says fips, state, or
--     county. Adding a resolver for another country means writing an adapter,
--     not altering this table.
--   * ISO CODES ARE THE JURISDICTION SEAM, matching the descriptor the
--     stage-gate and grants registries already speak.
--   * EVERYTHING NULLABLE. A project with no stated area is normal and honest;
--     callers fall back to the workspace home geography, or ask.
--
-- HOW THIS RELATES TO latitude/longitude, WHICH ARE KEPT
--   They answer a different question and are NOT derived from this. A marker is
--   a SITE — the intersection being rebuilt, the bridge being replaced — while
--   this is the AREA the work studies. A bridge project legitimately has both,
--   and they do not contradict each other: the pin is simply more specific than
--   the boundary. `/api/projects/[projectId]/location` keeps sole ownership of
--   the marker; nothing here writes it. What the place DOES do is let the marker
--   form default sensibly instead of opening on an empty continent.
--
--   The one honest limit, stated rather than papered over: a drawn area has no
--   resolvable identity. It is stored with source 'drawn' and a NULL ref, and
--   modules that need a jurisdiction (county onboarding, stage-gate templates,
--   grant program eligibility) must treat it as "area known, identity unknown"
--   rather than silently guessing which county contains it.
--
-- RLS IS EXTENDED, NOT WEAKENED. Columns added to a table are covered by its
-- existing policies: `projects_read` for members, `projects_update` plus the
-- RESTRICTIVE `projects_writer_only_update` from 20260728000006 for writes. This
-- migration creates, alters and drops NO policy.

ALTER TABLE projects
  -- Which resolver produced this area ('tigerweb', or 'drawn' for a hand-drawn
  -- boundary). Namespaces place_ref.
  ADD COLUMN IF NOT EXISTS place_source TEXT,
  -- The resolver's own kind vocabulary (county / city / cdp / metro / micro).
  -- Deliberately not a CHECK-constrained enum: a new source brings a new
  -- vocabulary, and this table must not need editing to admit one.
  ADD COLUMN IF NOT EXISTS place_kind TEXT,
  -- Id inside that source's namespace. Census GEOID for tigerweb; NULL when the
  -- area was drawn, because a drawn shape has no identity to reference.
  ADD COLUMN IF NOT EXISTS place_ref TEXT,
  -- What a planner reads, carried rather than derived.
  ADD COLUMN IF NOT EXISTS place_label TEXT,
  ADD COLUMN IF NOT EXISTS place_country_code TEXT,
  ADD COLUMN IF NOT EXISTS place_subdivision_code TEXT,
  ADD COLUMN IF NOT EXISTS place_min_lon DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS place_min_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS place_max_lon DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS place_max_lat DOUBLE PRECISION,
  -- The boundary itself. THIS is what makes the area inheritable — a bbox can
  -- frame a map, but only the polygon can seed a model run's study area.
  ADD COLUMN IF NOT EXISTS place_geometry_geojson JSONB,
  ADD COLUMN IF NOT EXISTS place_set_at TIMESTAMPTZ;

------------------------------------------------------------------------------
-- Integrity. Each guard stops a WRONG value being stored, never forces a value:
-- a project with no stated area satisfies all of them.
------------------------------------------------------------------------------

DO $$
BEGIN
  -- All four corners or none. Three of four renders a plausible, wrong frame.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_place_bbox_complete') THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_place_bbox_complete
      CHECK (num_nulls(place_min_lon, place_min_lat, place_max_lon, place_max_lat) IN (0, 4));
  END IF;

  -- On the globe. Longitude ORDERING is deliberately not constrained: a bbox
  -- spanning the antimeridian legitimately has min_lon > max_lon, and forbidding
  -- it would bake a hemisphere assumption into the schema.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_place_bbox_on_globe') THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_place_bbox_on_globe
      CHECK (
        (place_min_lon IS NULL OR (place_min_lon >= -180 AND place_min_lon <= 180))
        AND (place_max_lon IS NULL OR (place_max_lon >= -180 AND place_max_lon <= 180))
        AND (place_min_lat IS NULL OR (place_min_lat >= -90 AND place_min_lat <= 90))
        AND (place_max_lat IS NULL OR (place_max_lat >= -90 AND place_max_lat <= 90))
        AND (place_min_lat IS NULL OR place_max_lat IS NULL OR place_min_lat <= place_max_lat)
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_place_country_code_iso') THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_place_country_code_iso
      CHECK (place_country_code IS NULL OR place_country_code ~ '^[A-Z]{2}$');
  END IF;

  -- The subdivision part of ISO 3166-2, without the country prefix ('CA', not
  -- 'US-CA'). Meaningless without its country, so it requires one.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_place_subdivision_code_iso') THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_place_subdivision_code_iso
      CHECK (
        place_subdivision_code IS NULL
        OR (place_country_code IS NOT NULL AND place_subdivision_code ~ '^[A-Z0-9]{1,3}$')
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_place_coherent') THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_place_coherent
      CHECK (
        (place_ref IS NULL OR place_source IS NOT NULL)
        AND (place_source IS NULL OR length(trim(place_source)) > 0)
        AND (place_kind IS NULL OR length(trim(place_kind)) > 0)
        AND (place_ref IS NULL OR length(trim(place_ref)) > 0)
        AND (place_source IS NULL OR place_set_at IS NOT NULL)
      );
  END IF;

  -- A drawn area has no identity, by construction. Storing a ref against one
  -- would invite a downstream module to resolve it and get somebody else's
  -- county. The rule lives here so it cannot be forgotten in a call site.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_place_drawn_has_no_ref') THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_place_drawn_has_no_ref
      CHECK (place_source IS DISTINCT FROM 'drawn' OR place_ref IS NULL);
  END IF;
END
$$;

COMMENT ON COLUMN projects.place_source IS
  'Resolver that produced this project''s study area (''tigerweb'', or ''drawn'' for a hand-drawn boundary). Namespaces place_ref. NULL means the project has not stated an area — an honest state that makes downstream modules fall back to the workspace home geography or ask.';
COMMENT ON COLUMN projects.place_kind IS
  'Source-defined geography kind (county/city/cdp/metro/micro for TIGERweb). Intentionally unconstrained: a new source brings its own vocabulary.';
COMMENT ON COLUMN projects.place_ref IS
  'Id of the area within place_source. Census GEOID for tigerweb; always NULL when place_source is ''drawn'', because a drawn shape has no resolvable identity.';
COMMENT ON COLUMN projects.place_geometry_geojson IS
  'The boundary as GeoJSON. This is the column that makes a project area inheritable: a bbox can frame a map, but only the polygon can seed a model run study area or a representativeness screen.';
COMMENT ON COLUMN projects.latitude IS
  'Display marker for the cartographic backdrop — the project SITE, not its study area. Written only by /api/projects/[projectId]/location and deliberately independent of the place_* columns, which record the area the work covers.';
