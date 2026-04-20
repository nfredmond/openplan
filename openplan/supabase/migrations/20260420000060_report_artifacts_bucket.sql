-- Phase Q.4: private storage bucket for generated report artifacts (HTML + PDF).
-- Path convention: <workspace_id>/<report_id>/<artifact_id>.<ext>
-- RLS gates read + insert on the workspace_id prefix via workspace_members membership.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'report-artifacts',
  'report-artifacts',
  false,
  52428800,
  ARRAY['application/pdf', 'text/html', 'application/octet-stream']
) ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'report_artifacts_workspace_read'
  ) THEN
    CREATE POLICY "report_artifacts_workspace_read" ON storage.objects
      FOR SELECT USING (
        bucket_id = 'report-artifacts'
        AND split_part(name, '/', 1) IN (
          SELECT workspace_id::text FROM workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'report_artifacts_workspace_insert'
  ) THEN
    CREATE POLICY "report_artifacts_workspace_insert" ON storage.objects
      FOR INSERT WITH CHECK (
        bucket_id = 'report-artifacts'
        AND split_part(name, '/', 1) IN (
          SELECT workspace_id::text FROM workspace_members WHERE user_id = auth.uid()
        )
      );
  END IF;
END
$$;
