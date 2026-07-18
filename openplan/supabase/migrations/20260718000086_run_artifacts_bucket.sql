-- Modeling 1.1: provision the private run-artifacts bucket the AequilibraE
-- worker uploads to (storage://run-artifacts/model-runs/<run-id>/...).
-- Service-role-only by design: object paths carry no workspace prefix, so
-- workspace scoping is enforced by the authed API routes that proxy reads
-- (volumes route + artifact download route), matching engagement-photos.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'run-artifacts',
  'run-artifacts',
  false,
  104857600,
  ARRAY['application/geo+json', 'application/json', 'text/csv', 'application/octet-stream']
) ON CONFLICT (id) DO NOTHING;

-- Environments that provisioned the bucket out-of-band may have created it
-- public; force private so /object/public/ URLs stop serving.
UPDATE storage.buckets SET public = false WHERE id = 'run-artifacts' AND public;

-- Repair legacy artifact rows that stored a public URL: convert them to the
-- storage:// reference the artifact-source resolver expects.
UPDATE model_run_artifacts
SET file_url = 'storage://run-artifacts/' || split_part(file_url, '/object/public/run-artifacts/', 2)
WHERE file_url LIKE '%/object/public/run-artifacts/%';
