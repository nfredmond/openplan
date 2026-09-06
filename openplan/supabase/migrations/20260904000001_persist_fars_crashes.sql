-- Preserve national FARS crash evidence through the existing Safety ingest.
--
-- FARS is observed, fatal-only crash evidence. This widens only the source
-- allowlist; it does not change the severity vocabulary, invent injury counts,
-- or admit any estimate source. Existing rows and policies are untouched.

ALTER TABLE public.safety_crashes
  DROP CONSTRAINT IF EXISTS safety_crashes_source_id_check;

ALTER TABLE public.safety_crashes
  ADD CONSTRAINT safety_crashes_source_id_check
  CHECK (source_id IN ('ccrs-ca', 'fars-national'));

COMMENT ON CONSTRAINT safety_crashes_source_id_check ON public.safety_crashes IS
  'Observed crash adapters approved for persisted Safety acquisitions. Keep aligned with OBSERVED_CRASH_SOURCE_IDS; estimates are prohibited.';

-- safety_crash_parties intentionally remains CCRS-only. FARS supplies no
-- person rows, and widening that independent domain would claim a capability
-- the adapter does not have.
