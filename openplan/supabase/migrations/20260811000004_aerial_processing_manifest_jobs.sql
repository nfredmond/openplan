-- Aerial processing jobs learn the second imagery shape (contract v1.1).
--
-- WHAT THIS CLOSES. 20260721000001 made `imagery_url` NOT NULL because contract
-- v1 had exactly one imagery shape: a single signed ZIP link the planner pasted.
-- Contract v1.1 adds `photo_manifest` — the photos stored on the mission itself
-- (aerial_imagery, 20260811000002), dispatched as per-photo signed URLs the
-- route mints at request time. A manifest job has NO single imagery URL, and
-- storing one of its thousand signed links in that column would both lie about
-- what was dispatched and persist a bearer credential the job row deliberately
-- does not keep. So the column becomes nullable, and `imagery_type` records
-- which shape the job was dispatched with.
--
-- THE CHECKS MAKE THE HONEST STATES THE ONLY STORABLE ONES: a zip job without
-- its URL is unstorable (a zip dispatch always has exactly one URL), and the
-- type vocabulary is pinned to the contract's two imagery types. A manifest
-- job records what a reader needs — imagery_image_count and imagery_size_bytes
-- (the manifest's photo count and total bytes) — with imagery_url NULL, which
-- the jobs panel already renders as count + size and no host.

ALTER TABLE aerial_processing_jobs
  ALTER COLUMN imagery_url DROP NOT NULL;

ALTER TABLE aerial_processing_jobs
  ADD COLUMN IF NOT EXISTS imagery_type TEXT NOT NULL DEFAULT 'zip_url';

ALTER TABLE aerial_processing_jobs
  DROP CONSTRAINT IF EXISTS aerial_processing_jobs_imagery_type_check;
ALTER TABLE aerial_processing_jobs
  ADD CONSTRAINT aerial_processing_jobs_imagery_type_check CHECK (
    imagery_type IN ('zip_url', 'photo_manifest')
  );

-- A zip job must carry its URL; a manifest job must not need one.
ALTER TABLE aerial_processing_jobs
  DROP CONSTRAINT IF EXISTS aerial_processing_jobs_zip_jobs_carry_their_url;
ALTER TABLE aerial_processing_jobs
  ADD CONSTRAINT aerial_processing_jobs_zip_jobs_carry_their_url CHECK (
    imagery_type = 'photo_manifest' OR imagery_url IS NOT NULL
  );

COMMENT ON COLUMN aerial_processing_jobs.imagery_type IS
  'Which contract imagery shape this job was dispatched with: zip_url (contract v1, a single pasted signed link) or photo_manifest (contract v1.1, the mission''s stored aerial_imagery photos as per-photo signed URLs). Manifest jobs have imagery_url NULL — there is no single URL, and the per-photo links are time-limited credentials the row deliberately does not keep.';
COMMENT ON COLUMN aerial_processing_jobs.imagery_url IS
  'The signed ZIP link a zip_url job was dispatched with. NULL exactly when imagery_type = photo_manifest.';
