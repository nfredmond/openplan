-- Optional DB-persisted disadvantaged-community designations.
--
-- The bundled CEJST v1.0 asset remains the zero-setup DEFAULT for the federal
-- Justice40 determination (read-only, adapter `persistable:false`). This table is
-- the OPTIONAL, additive path that makes the equity-designation layer:
--   * persistable — a source can be ingested and served from Postgres, and
--   * extensible — a NEW source (e.g. California SB 535 / CalEnviroScreen) is
--     added by widening the CHECK below + registering a DB-backed adapter, never
--     by editing call sites.
--
-- Like census_tracts, this is a PUBLIC reference layer: any reader may SELECT;
-- writes go only through the service-role batch RPC. `source_id` is a closed
-- CHECK domain kept in lockstep with EQUITY_DESIGNATION_DB_SOURCE_IDS in
-- src/lib/data-sources/equity-designation/db.ts (a parity test asserts they
-- match) — widening one requires a migration that widens the other in the same
-- change.

CREATE TABLE IF NOT EXISTS equity_tract_designations (
  geoid TEXT NOT NULL,
  source_id TEXT NOT NULL CHECK (source_id IN ('cejst-national', 'calenviroscreen-ca')),
  version TEXT NOT NULL,
  is_disadvantaged BOOLEAN NOT NULL,
  attribution TEXT NOT NULL DEFAULT '',
  retrieved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (geoid, source_id, version)
);

CREATE INDEX IF NOT EXISTS equity_tract_designations_source_idx
  ON equity_tract_designations (source_id, version);

ALTER TABLE equity_tract_designations ENABLE ROW LEVEL SECURITY;

-- Public reference data — readable by everyone, same posture as census_tracts.
DROP POLICY IF EXISTS equity_tract_designations_select ON equity_tract_designations;
CREATE POLICY equity_tract_designations_select
  ON equity_tract_designations
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Batch upsert. Takes a JSONB array of { geoid, is_disadvantaged } so a national
-- source (~74k rows) ingests in a few calls rather than one round-trip per tract.
-- Rows with a null geoid or flag are skipped rather than failing the batch.
CREATE OR REPLACE FUNCTION upsert_equity_designations(
  p_source_id TEXT,
  p_version TEXT,
  p_attribution TEXT,
  p_retrieved_at TIMESTAMPTZ,
  p_rows JSONB
) RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  affected INTEGER;
BEGIN
  INSERT INTO equity_tract_designations (
    geoid, source_id, version, is_disadvantaged, attribution, retrieved_at
  )
  SELECT
    r.geoid, p_source_id, p_version, r.is_disadvantaged, COALESCE(p_attribution, ''), p_retrieved_at
  FROM jsonb_to_recordset(p_rows) AS r(geoid TEXT, is_disadvantaged BOOLEAN)
  WHERE r.geoid IS NOT NULL AND r.is_disadvantaged IS NOT NULL
  ON CONFLICT (geoid, source_id, version) DO UPDATE SET
    is_disadvantaged = EXCLUDED.is_disadvantaged,
    attribution = EXCLUDED.attribution,
    retrieved_at = EXCLUDED.retrieved_at,
    updated_at = now();

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE EXECUTE ON FUNCTION upsert_equity_designations(TEXT, TEXT, TEXT, TIMESTAMPTZ, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION upsert_equity_designations(TEXT, TEXT, TEXT, TIMESTAMPTZ, JSONB)
  TO service_role;
