-- A containing ZIP must honor the scope of every engagement review it retains.
CREATE FUNCTION public.can_read_engagement_bundle(p_manifest jsonb) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements(COALESCE(p_manifest->'entries','[]'::jsonb)) entry
  JOIN engagement_report_jobs j ON j.report_id::text=entry->'originalRecord'->>'parentRecordId'
  WHERE entry->'originalRecord'->>'sourceId'='report_artifacts' AND entry->'inclusion'->>'status'='included' AND j.scope='internal'
   AND NOT EXISTS(SELECT 1 FROM workspace_members m WHERE m.workspace_id=j.workspace_id AND m.user_id=auth.uid() AND m.role IN ('owner','admin','member'))
 );
$$;
REVOKE ALL ON FUNCTION public.can_read_engagement_bundle(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_read_engagement_bundle(jsonb) TO authenticated;
CREATE POLICY engagement_bundle_scope ON public.project_evidence_bundles AS RESTRICTIVE FOR SELECT TO authenticated USING(public.can_read_engagement_bundle(manifest_json));
-- The existing app route streams authenticated bytes and rechecks contained copies.
CREATE POLICY retained_bundle_route_only ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated USING(bucket_id<>'project-evidence-bundles');
