UPDATE storage.buckets SET allowed_mime_types = ARRAY(SELECT DISTINCT unnest(allowed_mime_types || ARRAY['application/zip','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])) WHERE id='report-artifacts' AND allowed_mime_types IS NOT NULL;
CREATE FUNCTION public.finish_engagement_report(p_job uuid,p_token uuid,p_artifacts jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j engagement_report_jobs; a jsonb; aid uuid;
BEGIN
 SELECT * INTO j FROM engagement_report_jobs WHERE id=p_job FOR UPDATE;
 IF NOT FOUND OR j.status<>'running' OR j.lease_token IS DISTINCT FROM p_token OR j.lease_until<clock_timestamp() THEN RAISE EXCEPTION 'Export lease expired or cancelled'; END IF;
 IF NOT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=j.workspace_id AND user_id=j.requested_by AND role IN ('owner','admin','member')) THEN RAISE EXCEPTION 'Requester access revoked'; END IF;
 IF jsonb_array_length(p_artifacts)<>3 OR (SELECT count(DISTINCT value->>'format') FROM jsonb_array_elements(p_artifacts))<>3 THEN RAISE EXCEPTION 'All three review files are required'; END IF;
 FOR a IN SELECT value FROM jsonb_array_elements(p_artifacts) LOOP
  IF a->>'format' NOT IN ('pdf','xlsx','zip') OR a->>'checksum' !~ '^[0-9a-f]{64}$' OR (a->>'byteLength')::bigint<=0
   OR a->>'path' <> j.workspace_id::text||'/'||j.report_id::text||'/'||j.id::text||'/'||(a->>'checksum')||'.'||(a->>'format') THEN RAISE EXCEPTION 'Artifact identity is invalid'; END IF;
 END LOOP;
 SELECT value INTO a FROM jsonb_array_elements(p_artifacts) WHERE value->>'format'='pdf';
 INSERT INTO report_artifacts(report_id,artifact_kind,storage_path,generated_by,metadata_json)
 VALUES(j.report_id,'pdf',a->>'path',j.requested_by,jsonb_build_object('engagementReviewJobId',j.id,'snapshotSha256',j.snapshot_sha256,'scope',j.scope,'sha256',a->>'checksum')) RETURNING id INTO aid;
 UPDATE reports SET status='generated',generated_at=clock_timestamp(),latest_artifact_kind='pdf',latest_artifact_url='/api/reports/'||j.report_id||'/artifacts/'||aid||'/download' WHERE id=j.report_id;
 UPDATE engagement_report_jobs SET status='complete',phase='All review files are ready',artifacts_json=p_artifacts,lease_token=NULL,lease_until=NULL WHERE id=j.id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.finish_engagement_report(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_engagement_report(uuid,uuid,jsonb) TO service_role;
