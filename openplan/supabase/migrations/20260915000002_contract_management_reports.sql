-- Finance history remains private; PM reports retain assignment costs without raw finance records.
ALTER TABLE public.contract_snapshots ADD COLUMN audience text NOT NULL DEFAULT 'finance' CHECK(audience IN ('finance','management'));
CREATE FUNCTION public.contract_snapshot_can_read(p_snapshot_id uuid,p_actor_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce((SELECT public.contract_actor_role(s.engagement_id,p_actor_id) IN ('owner','admin','finance') OR (s.audience='management' AND public.contract_actor_role(s.engagement_id,p_actor_id)='pm') FROM public.contract_snapshots s WHERE s.id=p_snapshot_id),false)
$$;
REVOKE ALL ON FUNCTION public.contract_snapshot_can_read(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.contract_snapshot_can_read(uuid,uuid) TO authenticated,service_role;
ALTER POLICY management_read ON public.contract_snapshots USING(public.contract_snapshot_can_read(id,auth.uid()));
ALTER POLICY private_contract_documents ON public.kb_documents USING(contract_snapshot_id IS NULL OR public.contract_snapshot_can_read(contract_snapshot_id,auth.uid()));

ALTER FUNCTION public.record_contract_command(uuid,uuid,jsonb) RENAME TO record_contract_command_closeout;
REVOKE ALL ON FUNCTION public.record_contract_command_closeout(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.record_contract_command(p_engagement_id uuid,p_actor_id uuid,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.invoicing_engagements; b public.contract_baselines; cached public.contract_commands; report jsonb; result jsonb; report_id uuid; cutoff timestamptz; asof date; req uuid:=(p_command->>'requestId')::uuid;
BEGIN
 IF p_command->>'kind' IS DISTINCT FROM 'snapshot' OR public.contract_actor_role(p_engagement_id,p_actor_id) IS DISTINCT FROM 'pm' THEN RETURN public.record_contract_command_closeout(p_engagement_id,p_actor_id,p_command); END IF;
 SELECT * INTO e FROM public.invoicing_engagements WHERE id=p_engagement_id;
 PERFORM pg_advisory_xact_lock(hashtextextended(e.workspace_id::text,451));
 SELECT * INTO cached FROM public.contract_commands WHERE engagement_id=e.id AND request_id=req;
 IF cached.request_id IS NOT NULL THEN IF cached.actor_id<>p_actor_id OR cached.command<>p_command THEN RAISE EXCEPTION 'Snapshot retry changed' USING ERRCODE='PT409'; END IF; RETURN cached.result; END IF;
 cutoff:=(p_command->>'sourceCutoff')::timestamptz;asof:=(p_command->>'asOf')::date;
 IF req IS NULL OR cutoff IS NULL OR cutoff>now() OR asof IS NULL OR coalesce(length(trim(p_command->>'coverageEvidence')),0)=0 OR coalesce(length(trim(p_command->>'title')),0)=0 THEN RAISE EXCEPTION 'Document snapshot cutoff, date, title and source coverage' USING ERRCODE='22023'; END IF;
 SELECT * INTO b FROM public.contract_baselines WHERE engagement_id=e.id AND state='approved' AND approved_at<=cutoff ORDER BY version DESC LIMIT 1;
 IF b.id IS NULL THEN RAISE EXCEPTION 'Approve an evidenced baseline before issuing a management snapshot' USING ERRCODE='22023'; END IF;
 report:=public.read_contract_management(e.id,p_actor_id,cutoff)||jsonb_build_object('baselineId',b.id,'originalBaselineId',(SELECT id FROM public.contract_baselines WHERE engagement_id=e.id AND state='approved' AND approved_at<=cutoff ORDER BY version LIMIT 1),'asOf',asof,'sourceCutoff',cutoff,'coverageComplete',(p_command->>'coverageComplete')::boolean,'coverageEvidence',p_command->>'coverageEvidence');
 IF (report->>'cutoffConflicts')::boolean THEN RAISE EXCEPTION 'Source changed after cutoff; choose a current cutoff' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(report->'rates')<>0 OR jsonb_array_length(report->'imports')<>0 OR jsonb_array_length(coalesce(report->'accountingImports','[]'))<>0 THEN RAISE EXCEPTION 'PM snapshot unexpectedly contains private finance records' USING ERRCODE='42501'; END IF;
 INSERT INTO public.contract_snapshots(engagement_id,workspace_id,title,snapshot,snapshot_hash,created_by,audience) VALUES(e.id,e.workspace_id,p_command->>'title',report,encode(extensions.digest(report::text,'sha256'),'hex'),p_actor_id,'management') RETURNING id INTO report_id;
 result:=jsonb_build_object('snapshotId',report_id);
 INSERT INTO public.contract_commands(engagement_id,request_id,actor_id,command,result) VALUES(e.id,req,p_actor_id,p_command,result);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.record_contract_command(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_contract_command(uuid,uuid,jsonb) TO service_role;

ALTER FUNCTION public.read_contract_management(uuid,uuid,timestamptz) RENAME TO read_contract_management_closeout;
REVOKE ALL ON FUNCTION public.read_contract_management_closeout(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.read_contract_management(p_engagement_id uuid,p_actor_id uuid,p_cutoff timestamptz DEFAULT now()) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 result:=public.read_contract_management_closeout(p_engagement_id,p_actor_id,p_cutoff);
 IF result->>'role'='pm' THEN result:=result||jsonb_build_object('snapshots',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'created_at',s.created_at,'snapshot_hash',s.snapshot_hash) ORDER BY s.created_at DESC) FROM public.contract_snapshots s WHERE s.engagement_id=p_engagement_id AND s.created_at<=p_cutoff AND s.audience='management'),'[]')); END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.read_contract_management(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_contract_management(uuid,uuid,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_contract_snapshot(p_report_id uuid,p_format text,p_actor_id uuid)
RETURNS public.kb_ocr_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.contract_snapshots; d public.kb_documents; j public.kb_ocr_jobs;
BEGIN
 SELECT * INTO r FROM public.contract_snapshots WHERE id=p_report_id FOR UPDATE;
 IF r.id IS NULL OR NOT public.contract_snapshot_can_read(r.id,p_actor_id) THEN RAISE EXCEPTION 'Private management report access denied' USING ERRCODE='42501'; END IF;
 IF p_format IS NULL OR p_format NOT IN ('pdf','xlsx') THEN RAISE EXCEPTION 'Invalid report format' USING ERRCODE='22023'; END IF;
 SELECT * INTO d FROM public.kb_documents WHERE contract_snapshot_id=r.id AND contract_snapshot_format=p_format;
 IF d.id IS NULL THEN
  INSERT INTO public.kb_documents(workspace_id,uploaded_by,title,source_kind,original_filename,content_type,status,extraction_source,contract_snapshot_id,contract_snapshot_format)
  VALUES(r.workspace_id,p_actor_id,'Contract management: '||r.title,CASE p_format WHEN 'pdf' THEN 'uploaded_pdf' ELSE 'uploaded_spreadsheet' END,
  'contract-snapshot-'||r.id||'.'||p_format,CASE p_format WHEN 'pdf' THEN 'application/pdf' ELSE 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' END,'pending','none',r.id,p_format) RETURNING * INTO d;
 END IF;
 SELECT * INTO j FROM public.kb_ocr_jobs WHERE document_id=d.id AND job_kind='work_program_export' ORDER BY created_at DESC LIMIT 1;
 IF j.id IS NOT NULL THEN
  IF j.status='failed' THEN UPDATE public.kb_ocr_jobs SET status='queued',requested_by=p_actor_id,failure_detail=NULL,cancel_requested=false,lease_token=NULL,lease_until=NULL WHERE id=j.id RETURNING * INTO j; END IF;
  RETURN j;
 END IF;
 INSERT INTO public.kb_ocr_jobs(workspace_id,document_id,request_id,requested_by,job_kind) VALUES(r.workspace_id,d.id,gen_random_uuid()::text,p_actor_id,'work_program_export') RETURNING * INTO j;
 RETURN j;
END $$;

CREATE OR REPLACE FUNCTION public.finish_work_program_export(p_job uuid,p_token uuid,p_checksum text,p_bytes bigint,p_storage_ref text,p_engine text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j public.kb_ocr_jobs; d public.kb_documents;
BEGIN
 SELECT * INTO j FROM public.kb_ocr_jobs WHERE id=p_job AND job_kind='work_program_export' FOR UPDATE;
 IF j.id IS NULL OR p_token IS NULL OR j.status<>'running' OR j.lease_token IS DISTINCT FROM p_token OR j.lease_until IS NULL OR j.lease_until<=now() OR j.cancel_requested
 THEN RAISE EXCEPTION 'Export lease no longer current' USING ERRCODE='PT409'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=j.workspace_id AND user_id=j.requested_by) THEN RAISE EXCEPTION 'Requester access revoked' USING ERRCODE='42501'; END IF;
 SELECT * INTO d FROM public.kb_documents WHERE id=j.document_id FOR UPDATE;
 IF d.workspace_id IS DISTINCT FROM j.workspace_id OR (d.work_program_revision_id IS NULL AND d.work_program_packet_id IS NULL AND d.work_program_report_id IS NULL AND d.contract_snapshot_id IS NULL) OR p_checksum IS NULL OR p_bytes IS NULL OR p_storage_ref IS NULL OR p_checksum !~ '^[a-f0-9]{64}$' OR p_bytes<=0 OR p_storage_ref IS DISTINCT FROM
  'storage://kb-documents/'||d.workspace_id||'/'||d.id||'/'||p_checksum||'.'||coalesce(d.work_program_export_format,d.work_program_packet_format,d.work_program_report_format,d.contract_snapshot_format)
 THEN RAISE EXCEPTION 'Invalid retained export identity' USING ERRCODE='22023'; END IF;
 IF (d.work_program_report_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=j.workspace_id AND user_id=j.requested_by AND role IN ('owner','admin'))) OR (d.contract_snapshot_id IS NOT NULL AND NOT public.contract_snapshot_can_read(d.contract_snapshot_id,j.requested_by)) THEN RAISE EXCEPTION 'Private report requester access revoked' USING ERRCODE='42501'; END IF;
 UPDATE public.kb_documents SET checksum=p_checksum,byte_size=p_bytes,storage_ref=p_storage_ref,status='stored',extraction_error=NULL WHERE id=d.id;
 UPDATE public.kb_ocr_jobs SET status='succeeded',progress=100,message='Review file retained',engine_name=p_engine,lease_until=NULL WHERE id=j.id;
END $$;

CREATE OR REPLACE FUNCTION public.can_read_management_object(object_name text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT NOT EXISTS(SELECT 1 FROM public.kb_documents d WHERE d.id::text=split_part(object_name,'/',2) AND
 ((d.work_program_report_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=d.workspace_id AND m.user_id=auth.uid() AND m.role IN ('owner','admin'))) OR
  (d.contract_snapshot_id IS NOT NULL AND NOT public.contract_snapshot_can_read(d.contract_snapshot_id,auth.uid()))))
$$;
