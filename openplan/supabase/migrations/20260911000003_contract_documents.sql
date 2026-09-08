ALTER TABLE public.kb_documents ADD COLUMN contract_snapshot_id uuid REFERENCES public.contract_snapshots(id);
ALTER TABLE public.kb_documents ADD COLUMN contract_snapshot_format text CHECK(contract_snapshot_format IN ('pdf','xlsx'));
ALTER TABLE public.kb_documents ADD CONSTRAINT contract_snapshot_identity CHECK((contract_snapshot_id IS NULL)=(contract_snapshot_format IS NULL) AND (contract_snapshot_id IS NULL OR (work_program_revision_id IS NULL AND work_program_packet_id IS NULL AND work_program_report_id IS NULL)));
CREATE UNIQUE INDEX contract_snapshot_document ON public.kb_documents(contract_snapshot_id,contract_snapshot_format) WHERE contract_snapshot_id IS NOT NULL;
CREATE POLICY private_contract_documents ON public.kb_documents AS RESTRICTIVE FOR ALL TO authenticated USING(contract_snapshot_id IS NULL OR EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=kb_documents.workspace_id AND m.user_id=auth.uid() AND m.role IN ('owner','admin')));
CREATE OR REPLACE FUNCTION public.can_read_management_object(object_name text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT NOT EXISTS(SELECT 1 FROM public.kb_documents d WHERE d.id::text=split_part(object_name,'/',2) AND (d.work_program_report_id IS NOT NULL OR d.contract_snapshot_id IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=d.workspace_id AND m.user_id=auth.uid() AND m.role IN ('owner','admin')))
$$;
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
 IF (d.work_program_report_id IS NOT NULL OR d.contract_snapshot_id IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=j.workspace_id AND user_id=j.requested_by AND role IN ('owner','admin')) THEN RAISE EXCEPTION 'Private report requester access revoked' USING ERRCODE='42501'; END IF;
 UPDATE public.kb_documents SET checksum=p_checksum,byte_size=p_bytes,storage_ref=p_storage_ref,status='stored',extraction_error=NULL WHERE id=d.id;
 UPDATE public.kb_ocr_jobs SET status='succeeded',progress=100,message='Review file retained',engine_name=p_engine,lease_until=NULL WHERE id=j.id;
END $$;
CREATE OR REPLACE FUNCTION public.refuse_management_indexing() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.kb_documents d WHERE d.id=NEW.document_id AND (d.work_program_report_id IS NOT NULL OR d.contract_snapshot_id IS NOT NULL)) THEN RAISE EXCEPTION 'Private management reports cannot be indexed in shared Documents search' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.guard_management_storage() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF auth.role()='authenticated' AND EXISTS(SELECT 1 FROM public.kb_documents d WHERE (d.work_program_report_id IS NOT NULL OR d.contract_snapshot_id IS NOT NULL) AND
  ((TG_OP<>'INSERT' AND OLD.bucket_id='kb-documents' AND d.id::text=split_part(OLD.name,'/',2)) OR
   (TG_OP<>'DELETE' AND NEW.bucket_id='kb-documents' AND d.id::text=split_part(NEW.name,'/',2))))
 THEN RAISE EXCEPTION 'Issued management storage requires retained Documents worker custody' USING ERRCODE='42501'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION public.guard_contract_snapshot_document() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.contract_snapshot_id IS NOT NULL THEN RAISE EXCEPTION 'Issued management file cannot be deleted' USING ERRCODE='23503'; END IF;
  RETURN OLD;
 END IF;
 IF NEW.contract_snapshot_id IS NOT NULL AND auth.role()='authenticated' THEN RAISE EXCEPTION 'Issued report documents are written only by the Documents worker' USING ERRCODE='42501'; END IF;
 IF NEW.contract_snapshot_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.contract_snapshots p WHERE p.id=NEW.contract_snapshot_id AND p.workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'Foreign report document' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' AND OLD.contract_snapshot_id IS NOT NULL AND ((NEW.workspace_id,NEW.contract_snapshot_id,NEW.contract_snapshot_format) IS DISTINCT FROM (OLD.workspace_id,OLD.contract_snapshot_id,OLD.contract_snapshot_format) OR (OLD.checksum IS NOT NULL AND (NEW.storage_ref,NEW.checksum,NEW.byte_size,NEW.content_type) IS DISTINCT FROM (OLD.storage_ref,OLD.checksum,OLD.byte_size,OLD.content_type))) THEN RAISE EXCEPTION 'Issued file identity is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_contract_snapshot_document BEFORE INSERT OR UPDATE OR DELETE ON public.kb_documents FOR EACH ROW EXECUTE FUNCTION public.guard_contract_snapshot_document();
CREATE FUNCTION public.enqueue_contract_snapshot(p_report_id uuid,p_format text,p_actor_id uuid)
RETURNS public.kb_ocr_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.contract_snapshots; d public.kb_documents; j public.kb_ocr_jobs;
BEGIN
 SELECT * INTO r FROM public.contract_snapshots WHERE id=p_report_id FOR UPDATE;
 IF r.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=r.workspace_id AND user_id=p_actor_id AND role IN ('owner','admin')) THEN RAISE EXCEPTION 'Private management report access denied' USING ERRCODE='42501'; END IF;
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
REVOKE ALL ON FUNCTION public.enqueue_contract_snapshot(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_contract_snapshot(uuid,text,uuid) TO service_role;

