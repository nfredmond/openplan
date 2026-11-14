-- Store the four state injury-crash layers through the existing Safety ingest.
--
-- Oregon (odot-or), Iowa (iowadot-ia), Ohio (odot-oh) and DC (ddot-dc) publish
-- observed, located crashes with their own injury severity. Their adapters were
-- read-only because two closed domains refused them:
--
--   * safety_crashes.source_id, last set by 20260904000001 to CCRS and FARS;
--   * safety_crash_ingests.coverage_state, the inline CHECK from 20260723000004,
--     which has no value for a state's own injury file.
--
-- This widens both domains and changes nothing else. severity_completeness
-- already admits 'kabco_full', killed_count and injured_count are nullable
-- (20260812000001) for Ohio's missing casualty counts, and collision_date is
-- nullable for Ohio and DC. No row is rewritten; every existing value stays
-- inside the wider domain.
--
-- safety_crash_parties stays CCRS-only. None of the four adapters supplies
-- person rows, and widening that domain would claim a capability they lack.
--
-- Each constraint is found by its expression, not a guessed generated name, and
-- the migration refuses an unexpected schema instead of dropping broader checks.
BEGIN;

DO $migration$
DECLARE
  found text[];
BEGIN
  SELECT array_agg(c.conname) INTO found
  FROM pg_catalog.pg_constraint c
  WHERE c.conrelid = 'public.safety_crashes'::regclass
    AND c.contype = 'c'
    AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%source_id%';
  IF coalesce(cardinality(found), 0) <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one safety_crashes source_id CHECK, found %', coalesce(cardinality(found), 0);
  END IF;
  EXECUTE format('ALTER TABLE public.safety_crashes DROP CONSTRAINT %I', found[1]);

  SELECT array_agg(c.conname) INTO found
  FROM pg_catalog.pg_constraint c
  WHERE c.conrelid = 'public.safety_crash_ingests'::regclass
    AND c.contype = 'c'
    AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%coverage_state%';
  IF coalesce(cardinality(found), 0) <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one safety_crash_ingests coverage_state CHECK, found %', coalesce(cardinality(found), 0);
  END IF;
  EXECUTE format('ALTER TABLE public.safety_crash_ingests DROP CONSTRAINT %I', found[1]);
END;
$migration$;

ALTER TABLE public.safety_crashes
  ADD CONSTRAINT safety_crashes_source_id_check
  CHECK (source_id IN ('ccrs-ca', 'fars-national', 'odot-or', 'iowadot-ia', 'odot-oh', 'ddot-dc'));

COMMENT ON CONSTRAINT safety_crashes_source_id_check ON public.safety_crashes IS
  'Observed crash adapters approved for persisted Safety acquisitions. Keep aligned with OBSERVED_CRASH_SOURCE_IDS; estimates are prohibited.';

ALTER TABLE public.safety_crash_ingests
  ADD CONSTRAINT safety_crash_ingests_coverage_state_check
  CHECK (coverage_state IN (
    'ccrs_ca_statewide', 'fars_fatal_only', 'state_injury_file',
    'switrs_legacy_local', 'out_of_coverage', 'source_unavailable'
  ));

COMMENT ON CONSTRAINT safety_crash_ingests_coverage_state_check ON public.safety_crash_ingests IS
  'Coverage states a crash acquisition can record. Keep aligned with SafetyCoverageState.';

COMMIT;
