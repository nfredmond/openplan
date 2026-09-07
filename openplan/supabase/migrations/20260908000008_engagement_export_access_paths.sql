-- Snapshot bodies are privileged custody data. Listing access is not permission
-- to bypass the download-time publication check through PostgREST or Storage.
REVOKE SELECT ON public.engagement_report_jobs FROM authenticated;
GRANT SELECT(id,workspace_id,campaign_id,report_id,requested_by,request_id,scope,filters_json,snapshot_sha256,status,phase,attempts,lease_token,lease_until,artifacts_json,failure_detail,created_at,updated_at) ON public.engagement_report_jobs TO authenticated;
CREATE FUNCTION public.can_read_engagement_report(p_report uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT NOT EXISTS(SELECT 1 FROM engagement_report_jobs j WHERE j.report_id=p_report AND j.scope='internal'
  AND NOT EXISTS(SELECT 1 FROM workspace_members m WHERE m.workspace_id=j.workspace_id AND m.user_id=auth.uid() AND m.role IN ('owner','admin','member')));
$$;
REVOKE ALL ON FUNCTION public.can_read_engagement_report(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_read_engagement_report(uuid) TO authenticated;
CREATE POLICY engagement_report_scope ON public.reports AS RESTRICTIVE FOR SELECT TO authenticated USING(public.can_read_engagement_report(id));
CREATE POLICY engagement_artifact_scope ON public.report_artifacts AS RESTRICTIVE FOR SELECT TO authenticated USING(public.can_read_engagement_report(report_id));
CREATE FUNCTION public.is_engagement_report_object(p_name text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM engagement_report_jobs j WHERE split_part(p_name,'/',1)=j.workspace_id::text AND split_part(p_name,'/',2)=j.report_id::text AND split_part(p_name,'/',3)=j.id::text);
$$;
REVOKE ALL ON FUNCTION public.is_engagement_report_object(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_engagement_report_object(text) TO authenticated;
CREATE POLICY engagement_export_route_only ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated USING(bucket_id<>'report-artifacts' OR NOT public.is_engagement_report_object(name));
