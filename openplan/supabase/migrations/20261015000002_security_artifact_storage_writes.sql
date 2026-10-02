-- Storage writes need the same writer role as their application records.
-- Existing permissive policies still enforce the workspace path prefix. This
-- additional gate preserves member uploads, viewer reads and service workers.
CREATE POLICY artifact_storage_writer_insert
ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (
  bucket_id NOT IN ('report-artifacts', 'grant-application-exports')
  OR EXISTS (
    SELECT 1 FROM public.workspace_members member
    WHERE member.workspace_id::text = split_part(name, '/', 1)
      AND member.user_id = auth.uid()
      AND member.role IN ('owner', 'admin', 'member')
  )
);
