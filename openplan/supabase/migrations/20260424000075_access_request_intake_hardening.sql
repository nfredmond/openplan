-- Metadata indexes for public request-access intake abuse checks.
--
-- These indexes support service-role-only recent activity lookups without
-- changing the RLS posture or exposing prospect contact data to anon/auth users.

CREATE INDEX IF NOT EXISTS access_requests_source_fingerprint_created_idx
  ON public.access_requests ((metadata_json->>'source_fingerprint'), created_at DESC)
  WHERE metadata_json ? 'source_fingerprint';

CREATE INDEX IF NOT EXISTS access_requests_body_fingerprint_created_idx
  ON public.access_requests ((metadata_json->>'body_fingerprint'), created_at DESC)
  WHERE metadata_json ? 'body_fingerprint';
