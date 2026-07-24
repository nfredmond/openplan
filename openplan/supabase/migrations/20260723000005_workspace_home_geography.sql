-- Wave 8.2 — Workspace home geography: where the agency actually is.
--
-- WHY THIS EXISTS
--   `workspaces` carried no geography at all (id, name, slug, plan, created_at).
--   With nowhere to record "we are Franklin County, Ohio", every geography-aware
--   surface invented its own constant: a map camera parked on one California
--   town, a hardcoded study-area bbox, and a stage-gate binding that defaults
--   every workspace in the country to the California template
--   (20260305000009_op003_workspace_stage_gate_binding.sql). Those are three
--   symptoms of one missing column set, not three bugs. This migration adds the
--   place of record so those surfaces can ask instead of assume.
--
-- POSTURE
--   * COLUMNS ON `workspaces`, NOT A NEW TABLE. A workspace has exactly one home
--     geography — a 1:1 fact belongs on the row. Multi-area work already has a
--     home: projects and model study areas carry their own geometry. A
--     `study_areas` table here would be a second, competing answer to "where is
--     this work?".
--
--   * JURISDICTION-NEUTRAL NAMES. No column says "fips", "state", or "county".
--     Worldwide is the eventual target, so the schema records only
--     (source, kind, ref) — which resolver produced the geography, what that
--     resolver calls the kind, and the id within that resolver's namespace.
--     TIGERweb is one such source; adding an ordnance-survey or Statistics
--     Canada resolver means writing an adapter, not altering this table.
--
--   * ISO CODES ARE THE JURISDICTION SEAM. home_country_code (ISO 3166-1
--     alpha-2) and home_subdivision_code (the ISO 3166-2 subdivision part,
--     without the country prefix) are exactly the descriptor the stage-gate
--     registry already speaks (src/lib/stage-gates/template-registry.ts:
--     `{ country: "US", subdivision: "CA" }`). They are derived by the resolver
--     adapter, never typed by a planner, and they are what lets a template be
--     matched instead of defaulted.
--
--   * EVERYTHING IS NULLABLE. An unset workspace is a normal, honest state —
--     not an error and not an excuse for a default place. Callers that find NULL
--     fall back to the neutral continental view (CONTINENTAL_US_CENTER) or say
--     "not set", never to a town.
--
--   * NUMERIC BBOX + jsonb GEOMETRY, NO POSTGIS COLUMN. supabase-js cannot send
--     PostGIS values, so the repo convention (projects_location.sql:7) is plain
--     numerics plus jsonb; a PostGIS column here would have to be
--     GENERATED ALWAYS AS ... STORED, and nothing yet needs a spatial index on a
--     single row per tenant.
--
--   * RLS IS EXTENDED, NOT WEAKENED. `workspaces` already has RLS enabled with
--     the member-scoped `workspace_read` SELECT policy from
--     20260219000002_workspace_schema.sql. Columns added to a table are covered
--     by its existing policies, so members read the home geography and no one
--     writes it through RLS. All writes go through
--     /api/workspaces/home-geography, which checks membership and role and then
--     uses the service-role client. This migration deliberately creates,
--     alters, and drops NO policy.

ALTER TABLE workspaces
  -- Which resolver produced this geography (e.g. 'tigerweb'). Namespaces the ref.
  ADD COLUMN IF NOT EXISTS home_geography_source TEXT,
  -- The resolver's own kind vocabulary (county / city / cdp / metro / micro /
  -- custom). Deliberately not a CHECK-constrained enum: a new source brings a
  -- new vocabulary, and this table must not need editing to admit one.
  ADD COLUMN IF NOT EXISTS home_geography_kind TEXT,
  -- The id inside that source's namespace. For TIGERweb this is the GEOID.
  ADD COLUMN IF NOT EXISTS home_geography_ref TEXT,
  -- What a planner reads, carried rather than derived (deriving a name from a
  -- code would mean shipping a code-to-name table for the world).
  ADD COLUMN IF NOT EXISTS home_geography_label TEXT,
  ADD COLUMN IF NOT EXISTS home_country_code TEXT,
  ADD COLUMN IF NOT EXISTS home_subdivision_code TEXT,
  ADD COLUMN IF NOT EXISTS home_min_lon DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS home_min_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS home_max_lon DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS home_max_lat DOUBLE PRECISION,
  -- Boundary geometry as GeoJSON. Optional: a bbox is enough to frame a map,
  -- and some sources return an extent without a usable polygon.
  ADD COLUMN IF NOT EXISTS home_geometry_geojson JSONB,
  ADD COLUMN IF NOT EXISTS home_geography_set_at TIMESTAMPTZ;

------------------------------------------------------------------------------
-- Integrity. Each guard exists to stop a *wrong* value being stored, never to
-- force a value: an entirely unset workspace satisfies all of them.
------------------------------------------------------------------------------

DO $$
BEGIN
  -- A bbox is all four corners or none. Three of four would render a map frame
  -- that looks plausible and is wrong, which is the failure mode this codebase
  -- refuses.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_home_bbox_complete'
  ) THEN
    ALTER TABLE workspaces
      ADD CONSTRAINT workspaces_home_bbox_complete
      CHECK (
        num_nulls(home_min_lon, home_min_lat, home_max_lon, home_max_lat) IN (0, 4)
      );
  END IF;

  -- Coordinates stay on the globe. Note what is NOT constrained: longitude
  -- ordering. A bbox spanning the antimeridian (Fiji, Chukotka, parts of the
  -- Aleutians) legitimately has min_lon > max_lon, and forbidding that would
  -- bake a hemisphere assumption into the schema. Latitude has no such wrap, so
  -- min_lat <= max_lat is safe to require.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_home_bbox_on_globe'
  ) THEN
    ALTER TABLE workspaces
      ADD CONSTRAINT workspaces_home_bbox_on_globe
      CHECK (
        (home_min_lon IS NULL OR (home_min_lon >= -180 AND home_min_lon <= 180))
        AND (home_max_lon IS NULL OR (home_max_lon >= -180 AND home_max_lon <= 180))
        AND (home_min_lat IS NULL OR (home_min_lat >= -90 AND home_min_lat <= 90))
        AND (home_max_lat IS NULL OR (home_max_lat >= -90 AND home_max_lat <= 90))
        AND (
          home_min_lat IS NULL OR home_max_lat IS NULL OR home_min_lat <= home_max_lat
        )
      );
  END IF;

  -- ISO 3166-1 alpha-2, stored uppercase so a lookup never depends on casing.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_home_country_code_iso'
  ) THEN
    ALTER TABLE workspaces
      ADD CONSTRAINT workspaces_home_country_code_iso
      CHECK (home_country_code IS NULL OR home_country_code ~ '^[A-Z]{2}$');
  END IF;

  -- The subdivision part of an ISO 3166-2 code, WITHOUT the country prefix
  -- ('CA', not 'US-CA') — 1-3 alphanumerics covers every published subdivision.
  -- A subdivision is meaningless without its country, so it requires one.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_home_subdivision_code_iso'
  ) THEN
    ALTER TABLE workspaces
      ADD CONSTRAINT workspaces_home_subdivision_code_iso
      CHECK (
        home_subdivision_code IS NULL
        OR (home_country_code IS NOT NULL AND home_subdivision_code ~ '^[A-Z0-9]{1,3}$')
      );
  END IF;

  -- A ref is an id inside a namespace; without its source it cannot be
  -- resolved back to anything. Same for a set-at timestamp with no geography.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_home_geography_coherent'
  ) THEN
    ALTER TABLE workspaces
      ADD CONSTRAINT workspaces_home_geography_coherent
      CHECK (
        (home_geography_ref IS NULL OR home_geography_source IS NOT NULL)
        AND (home_geography_source IS NULL OR length(trim(home_geography_source)) > 0)
        AND (home_geography_kind IS NULL OR length(trim(home_geography_kind)) > 0)
        AND (home_geography_ref IS NULL OR length(trim(home_geography_ref)) > 0)
        AND (home_geography_source IS NULL OR home_geography_set_at IS NOT NULL)
      );
  END IF;
END
$$;

COMMENT ON COLUMN workspaces.home_geography_source IS
  'Resolver that produced the home geography (e.g. ''tigerweb''). Namespaces home_geography_ref. NULL means the workspace has not stated where it works — an honest state, never a reason to substitute a default place.';
COMMENT ON COLUMN workspaces.home_geography_kind IS
  'Source-defined geography kind (county/city/cdp/metro/micro/custom for TIGERweb). Intentionally unconstrained: a new source brings its own vocabulary.';
COMMENT ON COLUMN workspaces.home_geography_ref IS
  'Id of the geography within home_geography_source. Census GEOID for the tigerweb source. Opaque to core code.';
COMMENT ON COLUMN workspaces.home_geography_label IS
  'Human-readable name of the home geography, as the resolver returned it.';
COMMENT ON COLUMN workspaces.home_country_code IS
  'ISO 3166-1 alpha-2 country of the home geography. Derived by the resolver adapter; the jurisdiction seam the stage-gate registry matches against.';
COMMENT ON COLUMN workspaces.home_subdivision_code IS
  'ISO 3166-2 subdivision part without the country prefix (''CA'', not ''US-CA''). NULL when the geography spans subdivisions (a multi-state metro) or the source cannot say — never guessed.';
COMMENT ON COLUMN workspaces.home_geometry_geojson IS
  'Optional boundary geometry as GeoJSON. Stored as jsonb per repo convention because supabase-js cannot write PostGIS values.';
COMMENT ON COLUMN workspaces.home_geography_set_at IS
  'When the home geography was last set, so a stale binding is visible rather than silent.';
