-- Aerial imagery — the source photos of a drone mission become rows OpenPlan
-- holds, instead of a zip on somebody's laptop.
--
-- WHY A TABLE. Until now the only imagery OpenPlan could reference was a
-- pasted, expiring URL to a zip hosted somewhere else: the processing request
-- carried it, and the photos themselves — the raw evidence every orthomosaic,
-- DSM and point cloud is computed FROM — never entered the system. The
-- artifact-custody migration (20260730000004) ended that for the OUTPUTS; this
-- one ends it for the inputs. One row per photo, bytes in OpenPlan's own
-- private bucket, so a processing manifest can be built from storage the
-- agency controls rather than a link that lapses.
--
-- EXIF COLUMNS ARE EVIDENCE, NOT ASSERTIONS. captured_at, gps_lat/gps_lon,
-- gps_altitude_m, camera_make and camera_model hold what the FILE SAID, parsed
-- server-side at upload — never typed by a user and never inferred. A photo
-- with no EXIF stores NULLs, and the UI says "no location recorded in this
-- photo" rather than presenting an empty map as fact. camera_make/camera_model
-- are free text on purpose: they are data (what the file claims), not a
-- registry, so no vendor vocabulary is frozen into SQL.

------------------------------------------------------------------------------
-- 1. PRIVATE BUCKET for the photo bytes.
------------------------------------------------------------------------------
-- Deliberately NO storage.objects policies, matching aerial-artifacts,
-- engagement-photos, run-artifacts and kb-documents: object paths carry a
-- workspace prefix but storage RLS is not where aerial authorization lives, so
-- reads are proxied by authed routes minting short-TTL signed URLs after an
-- explicit membership check.
--
-- allowed_mime_types is NULL ON PURPOSE, the aerial-artifacts precedent: a
-- mislabeled Content-Type must not lose data. Cameras and transfer tools label
-- the same JPEG bytes image/jpeg, image/jpg or application/octet-stream, and
-- an allowlist here would silently refuse a real photo because of how its
-- header was spelled — the same class of data loss custody exists to end. The
-- upload route recognises the actual bytes instead.
--
-- file_size_limit is NULL ON PURPOSE too: the per-file ceiling OpenPlan
-- enforces is OPENPLAN_AERIAL_IMAGE_MAX_BYTES (src/lib/aerial/imagery.ts) —
-- configuration an operator can raise, not a number frozen into SQL.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('aerial-imagery', 'aerial-imagery', false, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

-- An environment that provisioned the bucket out-of-band may have made it
-- public; force private so /object/public/ URLs stop serving mission photos.
UPDATE storage.buckets SET public = false WHERE id = 'aerial-imagery' AND public;

------------------------------------------------------------------------------
-- 2. IMAGERY LEDGER — one row per stored photo.
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.aerial_imagery (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  mission_id        UUID        NOT NULL REFERENCES public.aerial_missions(id) ON DELETE CASCADE,

  storage_bucket    TEXT        NOT NULL,
  -- <workspace_id>/<mission_id>/<imagery_id>/<sanitized-filename>
  storage_path      TEXT        NOT NULL,
  original_filename TEXT        NOT NULL,
  -- Bytes ACTUALLY stored, counted by the route from what it read.
  byte_size         BIGINT      NOT NULL CHECK (byte_size >= 0),
  -- Manifest integrity and per-mission dedupe both hang off this hash.
  checksum_sha256   TEXT        NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  content_type      TEXT,

  -- EXIF evidence. All nullable: what the file said, or NULL because it said
  -- nothing — never a default, never an inference.
  captured_at       TIMESTAMPTZ,
  gps_lat           DOUBLE PRECISION CHECK (gps_lat IS NULL OR (gps_lat >= -90 AND gps_lat <= 90)),
  gps_lon           DOUBLE PRECISION CHECK (gps_lon IS NULL OR (gps_lon >= -180 AND gps_lon <= 180)),
  gps_altitude_m    NUMERIC,
  camera_make       TEXT,
  camera_model      TEXT,

  uploaded_by       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Half a coordinate is not a location: a latitude with no longitude cannot
  -- be placed on any map, so the dishonest state is unstorable.
  CONSTRAINT aerial_imagery_gps_pair CHECK ((gps_lat IS NULL) = (gps_lon IS NULL)),
  -- The same bytes uploaded twice to one mission are the same photo. The
  -- upload route answers the existing row as a no-op instead of storing a copy.
  CONSTRAINT aerial_imagery_mission_checksum_key UNIQUE (mission_id, checksum_sha256)
);

COMMENT ON TABLE public.aerial_imagery IS
  'One row per source photo of an aerial mission, bytes held in the private aerial-imagery bucket. EXIF columns (captured_at, gps_*, camera_*) are evidence parsed from the file at upload — NULL means the file recorded nothing, and the UI discloses that rather than inventing a value.';
COMMENT ON COLUMN public.aerial_imagery.checksum_sha256 IS
  'sha256 of the stored bytes, computed by the upload route. UNIQUE per mission: re-uploading identical bytes is a no-op, and the processing manifest cites this hash so a worker can verify what it downloaded.';

CREATE INDEX IF NOT EXISTS aerial_imagery_mission_idx
  ON public.aerial_imagery(mission_id);
CREATE INDEX IF NOT EXISTS aerial_imagery_workspace_idx
  ON public.aerial_imagery(workspace_id);

------------------------------------------------------------------------------
-- 3. CROSS-WORKSPACE UNSTORABLE. The route verifies the mission it loads, but
-- a constraint outlives a route: a photo whose mission lives in a different
-- workspace than the row claims must be impossible to store, not merely
-- unlikely. Same shape as trg_aerial_flight_plans_scope (20260811000001).
------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.validate_aerial_imagery_scope()
RETURNS TRIGGER
SET search_path = public, pg_temp
AS $$
DECLARE
  mission_workspace_id UUID;
BEGIN
  SELECT workspace_id INTO mission_workspace_id
  FROM aerial_missions WHERE id = NEW.mission_id;

  IF mission_workspace_id IS NULL OR mission_workspace_id <> NEW.workspace_id THEN
    RAISE EXCEPTION 'aerial imagery must carry its mission''s workspace';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_aerial_imagery_scope ON public.aerial_imagery;
CREATE TRIGGER trg_aerial_imagery_scope
BEFORE INSERT OR UPDATE ON public.aerial_imagery
FOR EACH ROW
EXECUTE FUNCTION public.validate_aerial_imagery_scope();

CREATE OR REPLACE FUNCTION public.set_aerial_imagery_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_aerial_imagery_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_aerial_imagery_updated_at() TO service_role;

DROP TRIGGER IF EXISTS trg_set_aerial_imagery_updated_at ON public.aerial_imagery;
CREATE TRIGGER trg_set_aerial_imagery_updated_at
BEFORE UPDATE ON public.aerial_imagery
FOR EACH ROW
EXECUTE FUNCTION public.set_aerial_imagery_updated_at();

------------------------------------------------------------------------------
-- 4. RLS. Same posture as aerial_artifact_custody, and for the same reason:
-- workspace members may READ the ledger, and every write goes through an
-- authed route that checks membership and denies read-only roles, then writes
-- with the service role — correct here because the photo BYTES must transit a
-- route anyway, so the row write rides the same authorization the bytes did.
-- NO write policies exist on purpose: a client writing this table directly is
-- a row claiming bytes that never went through the pipeline.
------------------------------------------------------------------------------

ALTER TABLE public.aerial_imagery ENABLE ROW LEVEL SECURITY;

CREATE POLICY aerial_imagery_read ON public.aerial_imagery
  FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );

-- Grants are EXPLICIT since 20260804000001 flipped default privileges to deny.
-- authenticated gets SELECT only: with no write policies, a wider grant would
-- be decoration at best and a standing invitation at worst.
REVOKE ALL ON TABLE public.aerial_imagery FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.aerial_imagery TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aerial_imagery TO service_role;
