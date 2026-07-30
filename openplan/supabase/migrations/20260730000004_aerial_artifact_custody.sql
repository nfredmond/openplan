-- Aerial artifact custody — OpenPlan takes possession of the bytes a drone
-- flight produced, instead of holding a vendor link that expires.
--
-- THE DEFECT THIS CLOSES. `aerial_processing_jobs.artifacts` stored the
-- worker's own JSON: `{kind, downloadUrl, expiresAt, sizeBytes, contentType}`.
-- OpenPlan never fetched the bytes. So the orthomosaic, the point cloud and the
-- DSM — the actual deliverables of a flight, and the evidence under every
-- analysis, exhibit and CEQA/NEPA finding built on them — became PERMANENTLY
-- unreachable the moment the vendor's signed URL lapsed, while the job row went
-- on saying `succeeded`. An agency defending a decision two years later would
-- find the evidence had expired on a schedule nobody was ever shown.
--
-- WHAT IS ADDED
--   * aerial-artifacts bucket   — PRIVATE object store for the fetched bytes.
--   * aerial_artifact_custody   — one row per artifact, saying either "these
--                                 bytes are here, at this path, this many, this
--                                 hash" or "they are NOT, and here is why".
--   * aerial_processing_jobs.artifact_custody_state — the roll-up, so a job
--                                 whose bytes are safe is never rendered
--                                 identically to one whose bytes are not.
--
-- CREDENTIAL POSTURE. A signed download URL is a bearer credential. Two things
-- follow, and both are enforced here rather than left to convention:
--   * `aerial_artifact_custody` records the source HOST and the source EXPIRY,
--     never the URL. It is member-readable precisely because it holds no secret.
--   * `aerial_processing_callbacks.payload` holds the raw vendor callback,
--     signed URLs included, and was readable by every workspace member. That
--     read is REVOKED below. The ledger keeps the payload verbatim — an audit
--     ledger that redacts itself is no longer a record of what arrived — and
--     only the service role (the callback route and the custody retry route)
--     can read it.

------------------------------------------------------------------------------
-- 1. PRIVATE BUCKET for the artifact bytes.
------------------------------------------------------------------------------
-- Deliberately NO storage.objects policies, matching engagement-photos,
-- run-artifacts and kb-documents: object paths carry a workspace prefix but
-- storage RLS is not where aerial authorization lives, so reads are proxied by
-- authed routes minting short-TTL signed URLs after an explicit membership
-- check.
--
-- allowed_mime_types is NULL ON PURPOSE, unlike engagement-photos' image
-- allowlist. ODM outputs are GeoTIFF, LAZ/LAS, OBJ/PLY and ZIP, and different
-- processing worker builds label them differently (`application/octet-stream`
-- is the common case). An allowlist here would silently refuse a real
-- deliverable because of how its Content-Type header was spelled, which is the
-- same class of data loss this migration exists to end.
--
-- file_size_limit is NULL ON PURPOSE too: the deployment's own global storage
-- limit governs, and the per-artifact ceiling OpenPlan enforces is
-- OPENPLAN_AERIAL_ARTIFACT_MAX_BYTES (src/lib/aerial/artifact-custody.ts) —
-- configuration an operator can raise, not a number frozen into SQL.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('aerial-artifacts', 'aerial-artifacts', false, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

-- An environment that provisioned the bucket out-of-band may have made it
-- public; force private so /object/public/ URLs stop serving flight imagery.
UPDATE storage.buckets SET public = false WHERE id = 'aerial-artifacts' AND public;

------------------------------------------------------------------------------
-- 2. CUSTODY LEDGER — one row per artifact in a succeeded callback.
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS aerial_artifact_custody (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  mission_id           UUID        NOT NULL REFERENCES aerial_missions(id) ON DELETE CASCADE,
  processing_job_id    UUID        NOT NULL REFERENCES aerial_processing_jobs(id) ON DELETE CASCADE,

  -- Mirrors PROCESSING_ARTIFACT_KINDS in src/lib/aerial/processing-contract.ts.
  kind                 TEXT        NOT NULL
    CHECK (kind IN ('orthomosaic', 'dsm', 'dtm', 'point_cloud', 'mesh')),
  -- Position among artifacts of the SAME kind within the callback's array. The
  -- contract permits repeats; without this a second orthomosaic would either
  -- overwrite the first or be dropped. Stable across a redelivery because the
  -- array order is part of the payload.
  ordinal              INTEGER     NOT NULL DEFAULT 0 CHECK (ordinal >= 0),

  -- held     — the bytes are in OpenPlan's storage. This is the only value that
  --            means the deliverable survives the vendor link expiring.
  -- pending  — not attempted yet, or the callback's time budget ran out before
  --            reaching it. Retryable while the source URL is still valid.
  -- failed   — attempted and failed (network, HTTP error, wrong content type,
  --            storage write). Retryable.
  -- refused  — deliberately not taken: larger than this deployment's ceiling.
  --            Retrying helps only after an operator raises the ceiling.
  state                TEXT        NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'held', 'failed', 'refused')),

  storage_bucket       TEXT,
  -- <workspace_id>/<mission_id>/<processing_job_id>/<kind>[-<ordinal>].<ext>
  storage_path         TEXT,
  -- Bytes ACTUALLY stored, which is not necessarily what the vendor declared.
  byte_size            BIGINT      CHECK (byte_size IS NULL OR byte_size >= 0),
  checksum_sha256      TEXT        CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-f]{64}$'),
  content_type         TEXT,

  -- What the vendor CLAIMED, kept alongside byte_size so a disagreement is a
  -- visible fact rather than a silent overwrite.
  declared_size_bytes  BIGINT      CHECK (declared_size_bytes IS NULL OR declared_size_bytes >= 0),
  declared_content_type TEXT,

  -- The credential-free half of the source. NEVER the signed URL.
  source_host          TEXT        NOT NULL,
  source_expires_at    TIMESTAMPTZ NOT NULL,

  -- Machine-readable reason + operator-readable sentence, both assembled from a
  -- fixed vocabulary so a raw fetch error can never smuggle the signed URL in.
  failure_code         TEXT,
  failure_detail       TEXT,

  attempt_count        INTEGER     NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_attempt_at      TIMESTAMPTZ,
  held_at              TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Idempotency: the same callback delivered twice upserts the same row, and
  -- the deterministic storage path means the same object, not a second copy.
  CONSTRAINT aerial_artifact_custody_job_kind_ordinal_key
    UNIQUE (processing_job_id, kind, ordinal),
  -- A row that claims custody must be able to prove it.
  CONSTRAINT aerial_artifact_custody_held_is_provable CHECK (
    state <> 'held'
    OR (storage_bucket IS NOT NULL AND storage_path IS NOT NULL
        AND byte_size IS NOT NULL AND checksum_sha256 IS NOT NULL)
  ),
  -- A row that did NOT take custody must say why.
  CONSTRAINT aerial_artifact_custody_not_held_has_reason CHECK (
    state NOT IN ('failed', 'refused') OR failure_code IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS aerial_artifact_custody_job_idx
  ON aerial_artifact_custody(processing_job_id);
CREATE INDEX IF NOT EXISTS aerial_artifact_custody_mission_idx
  ON aerial_artifact_custody(mission_id);
CREATE INDEX IF NOT EXISTS aerial_artifact_custody_workspace_idx
  ON aerial_artifact_custody(workspace_id);
-- The retry sweep's working set: everything not yet in custody.
CREATE INDEX IF NOT EXISTS aerial_artifact_custody_outstanding_idx
  ON aerial_artifact_custody(state, source_expires_at)
  WHERE state <> 'held';

CREATE OR REPLACE FUNCTION public.set_aerial_artifact_custody_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_aerial_artifact_custody_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_aerial_artifact_custody_updated_at() TO service_role;

DROP TRIGGER IF EXISTS trg_set_aerial_artifact_custody_updated_at ON aerial_artifact_custody;
CREATE TRIGGER trg_set_aerial_artifact_custody_updated_at
BEFORE UPDATE ON aerial_artifact_custody
FOR EACH ROW
EXECUTE FUNCTION public.set_aerial_artifact_custody_updated_at();

------------------------------------------------------------------------------
-- 3. ROLL-UP on the job row.
------------------------------------------------------------------------------
-- Denormalized so a mission or workspace listing can tell a job whose bytes are
-- safe from one whose bytes are only a soon-to-expire vendor link WITHOUT
-- joining the custody ledger. `aerial_artifact_custody` remains the detail.
--
--   not_applicable — the job produced no artifacts (not succeeded, or an empty
--                    artifact list). NOT the same as "nothing was taken".
--   none           — artifacts exist and OpenPlan holds none of them.
--   partial        — some held, some not. The normal failure mode.
--   complete       — every artifact in the callback is in OpenPlan's custody.
ALTER TABLE aerial_processing_jobs
  ADD COLUMN IF NOT EXISTS artifact_custody_state TEXT NOT NULL DEFAULT 'not_applicable'
    CHECK (artifact_custody_state IN ('not_applicable', 'none', 'partial', 'complete')),
  ADD COLUMN IF NOT EXISTS artifact_custody_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN aerial_processing_jobs.artifacts IS
  'REDACTED artifact descriptors from the succeeded callback: kind, ordinal, expiresAt, sizeBytes, contentType, sourceHost. The vendor downloadUrl is deliberately NOT stored here — this column is readable by every workspace member and a signed URL is a bearer credential. The URL survives only in aerial_processing_callbacks.payload, which is service-role-only.';

------------------------------------------------------------------------------
-- 4. RLS.
------------------------------------------------------------------------------
-- Same posture as aerial_processing_jobs: workspace members may READ custody
-- state; every write goes through the service role after an explicit
-- membership check in a route, so no write policies are granted.
ALTER TABLE aerial_artifact_custody ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_members_can_read_aerial_artifact_custody"
  ON aerial_artifact_custody FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

-- Revoke the member read on the raw callback ledger. Its `payload` column is
-- the vendor's callback verbatim, and a succeeded callback's artifacts carry
-- signed download URLs — bearer credentials for the agency's own imagery. No
-- application code reads this table with a user client; the callback route and
-- the custody retry route both use the service role, which RLS does not apply
-- to. Custody FACTS are what members need, and those live in
-- aerial_artifact_custody above, which holds no credential.
DROP POLICY IF EXISTS "workspace_members_can_read_aerial_processing_callbacks"
  ON aerial_processing_callbacks;

COMMENT ON TABLE aerial_processing_callbacks IS
  'Idempotency ledger of raw ProcessingCallback deliveries. SERVICE-ROLE ONLY: payload holds the vendor callback verbatim, including signed artifact download URLs. Workspace members read custody facts from aerial_artifact_custody instead.';
