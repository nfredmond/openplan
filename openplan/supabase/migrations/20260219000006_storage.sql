INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'gtfs-uploads', 'gtfs-uploads', false, 52428800,
  ARRAY['application/zip', 'application/x-zip-compressed', 'application/octet-stream']
) ON CONFLICT (id) DO NOTHING;

CREATE POLICY "authenticated_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'gtfs-uploads' AND auth.uid() IS NOT NULL
  );

CREATE POLICY "authenticated_read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'gtfs-uploads' AND auth.uid() IS NOT NULL
  );
