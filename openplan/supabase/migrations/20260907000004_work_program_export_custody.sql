-- Generated proposal files use existing private Documents records and its durable job queue.
ALTER TABLE public.kb_documents ADD COLUMN work_program_revision_id uuid REFERENCES public.program_work_program_revisions(id);
ALTER TABLE public.kb_documents ADD COLUMN work_program_export_format text CHECK (work_program_export_format IN ('html','pdf','xlsx'));
ALTER TABLE public.kb_documents ADD CONSTRAINT work_program_export_identity CHECK ((work_program_revision_id IS NULL) = (work_program_export_format IS NULL));
CREATE UNIQUE INDEX kb_work_program_export_revision ON public.kb_documents(work_program_revision_id,work_program_export_format) WHERE work_program_revision_id IS NOT NULL;
ALTER TABLE public.kb_ocr_jobs ADD COLUMN job_kind text NOT NULL DEFAULT 'extraction' CHECK (job_kind IN ('extraction','work_program_export'));
ALTER TABLE public.kb_ocr_jobs ADD COLUMN lease_token uuid;
ALTER TABLE public.kb_ocr_jobs ADD COLUMN lease_until timestamptz;

CREATE FUNCTION public.guard_work_program_export_document() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.work_program_revision_id IS NOT NULL THEN RAISE EXCEPTION 'Retained proposal artifacts cannot be deleted' USING ERRCODE='23503'; END IF;
    RETURN OLD;
  END IF;
  IF NEW.work_program_revision_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.program_work_program_revisions r WHERE r.id=NEW.work_program_revision_id AND r.workspace_id=NEW.workspace_id
  ) THEN RAISE EXCEPTION 'Foreign proposal revision' USING ERRCODE='42501'; END IF;
  IF TG_OP='UPDATE' AND OLD.work_program_revision_id IS NOT NULL THEN
    IF (NEW.workspace_id,NEW.work_program_revision_id,NEW.work_program_export_format) IS DISTINCT FROM (OLD.workspace_id,OLD.work_program_revision_id,OLD.work_program_export_format)
      OR (OLD.checksum IS NOT NULL AND (NEW.storage_ref,NEW.checksum,NEW.byte_size,NEW.content_type) IS DISTINCT FROM (OLD.storage_ref,OLD.checksum,OLD.byte_size,OLD.content_type))
      THEN RAISE EXCEPTION 'Retained proposal artifact identity is immutable' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_work_program_export_document BEFORE INSERT OR UPDATE OR DELETE ON public.kb_documents FOR EACH ROW EXECUTE FUNCTION public.guard_work_program_export_document();

CREATE FUNCTION public.enqueue_work_program_export(p_program_id uuid,p_revision integer,p_format text,p_actor_id uuid)
RETURNS public.kb_ocr_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.program_work_program_revisions; d public.kb_documents; j public.kb_ocr_jobs;
BEGIN
  SELECT * INTO r FROM public.program_work_program_revisions WHERE program_id=p_program_id AND revision=p_revision FOR UPDATE;
  IF r.id IS NULL OR NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id=r.workspace_id AND user_id=p_actor_id)
    THEN RAISE EXCEPTION 'Proposal access denied' USING ERRCODE='42501'; END IF;
  IF p_format NOT IN ('html','pdf','xlsx') THEN RAISE EXCEPTION 'Invalid format' USING ERRCODE='22023'; END IF;
  SELECT * INTO d FROM public.kb_documents WHERE work_program_revision_id=r.id AND work_program_export_format=p_format;
  IF NOT FOUND THEN
    INSERT INTO public.kb_documents(workspace_id,uploaded_by,title,source_kind,original_filename,content_type,status,extraction_source,work_program_revision_id,work_program_export_format)
    VALUES(r.workspace_id,p_actor_id,'Work program proposal revision '||r.revision||' ('||upper(p_format)||')',CASE WHEN p_format='pdf' THEN 'uploaded_pdf' WHEN p_format='xlsx' THEN 'uploaded_spreadsheet' ELSE 'uploaded_other' END,
      'work-program-r'||r.revision||'.'||p_format,CASE p_format WHEN 'pdf' THEN 'application/pdf' WHEN 'xlsx' THEN 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ELSE 'text/html' END,'pending','none',r.id,p_format) RETURNING * INTO d;
  END IF;
  SELECT * INTO j FROM public.kb_ocr_jobs WHERE document_id=d.id AND job_kind='work_program_export' ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    IF j.status='failed' THEN UPDATE public.kb_ocr_jobs SET status='queued',requested_by=p_actor_id,failure_detail=NULL,cancel_requested=false,lease_token=NULL,lease_until=NULL WHERE id=j.id RETURNING * INTO j; END IF;
    RETURN j;
  END IF;
  INSERT INTO public.kb_ocr_jobs(workspace_id,document_id,request_id,requested_by,job_kind)
    VALUES(r.workspace_id,d.id,gen_random_uuid()::text,p_actor_id,'work_program_export') RETURNING * INTO j;
  RETURN j;
END $$;

CREATE FUNCTION public.claim_work_program_export(p_token uuid) RETURNS public.kb_ocr_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j public.kb_ocr_jobs;
BEGIN
  IF p_token IS NULL THEN RAISE EXCEPTION 'Missing lease token' USING ERRCODE='22023'; END IF;
  SELECT * INTO j FROM public.kb_ocr_jobs WHERE job_kind='work_program_export' AND (status='queued' OR (status='running' AND lease_until<now())) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF j.id IS NULL THEN RETURN NULL; END IF;
  IF j.cancel_requested OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=j.workspace_id AND user_id=j.requested_by) THEN
    UPDATE public.kb_ocr_jobs SET status='failed',failure_detail='Canceled or requester access revoked; saved revision retained.' WHERE id=j.id;
    RETURN NULL;
  END IF;
  UPDATE public.kb_ocr_jobs SET status='running',lease_token=p_token,lease_until=now()+interval '10 minutes',progress=5,message='Rendering saved proposal revision' WHERE id=j.id RETURNING * INTO j;
  RETURN j;
END $$;

CREATE FUNCTION public.finish_work_program_export(p_job uuid,p_token uuid,p_checksum text,p_bytes bigint,p_storage_ref text,p_engine text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j public.kb_ocr_jobs; d public.kb_documents;
BEGIN
  SELECT * INTO j FROM public.kb_ocr_jobs WHERE id=p_job AND job_kind='work_program_export' FOR UPDATE;
  IF j.id IS NULL OR j.status<>'running' OR j.lease_token IS DISTINCT FROM p_token OR j.lease_until<=now() OR j.cancel_requested
    THEN RAISE EXCEPTION 'Export lease no longer current' USING ERRCODE='PT409'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=j.workspace_id AND user_id=j.requested_by) THEN RAISE EXCEPTION 'Requester access revoked' USING ERRCODE='42501'; END IF;
  SELECT * INTO d FROM public.kb_documents WHERE id=j.document_id FOR UPDATE;
  IF d.workspace_id IS DISTINCT FROM j.workspace_id OR d.work_program_revision_id IS NULL OR p_checksum IS NULL OR p_bytes IS NULL OR p_storage_ref IS NULL OR p_checksum !~ '^[a-f0-9]{64}$' OR p_bytes<=0 OR p_storage_ref IS DISTINCT FROM
    'storage://kb-documents/'||d.workspace_id||'/'||d.id||'/'||p_checksum||'.'||d.work_program_export_format
    THEN RAISE EXCEPTION 'Invalid retained export identity' USING ERRCODE='22023'; END IF;
  UPDATE public.kb_documents SET checksum=p_checksum,byte_size=p_bytes,storage_ref=p_storage_ref,status='stored',extraction_error=NULL WHERE id=d.id;
  UPDATE public.kb_ocr_jobs SET status='succeeded',progress=100,message='Review file retained',engine_name=p_engine,lease_until=NULL WHERE id=j.id;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_work_program_export(uuid,integer,text,uuid),public.claim_work_program_export(uuid),public.finish_work_program_export(uuid,uuid,text,bigint,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_work_program_export(uuid,integer,text,uuid),public.claim_work_program_export(uuid),public.finish_work_program_export(uuid,uuid,text,bigint,text,text) TO service_role;

UPDATE storage.buckets SET allowed_mime_types=array_append(allowed_mime_types,'text/html') WHERE id='kb-documents' AND NOT 'text/html'=ANY(allowed_mime_types);
