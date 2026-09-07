-- Forward repair for installations that applied the first preparation migrations.
-- No source, proposal, document or financial data is rewritten.
CREATE OR REPLACE FUNCTION public.enqueue_kb_extraction(p_document_id uuid, p_actor_id uuid, p_request_id text, p_mode text, p_languages text[], p_callback_url text)
RETURNS public.kb_ocr_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE d public.kb_documents; j public.kb_ocr_jobs;
BEGIN
  SELECT * INTO d FROM public.kb_documents WHERE id = p_document_id FOR UPDATE;
  IF d.id IS NULL OR NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = d.workspace_id AND user_id = p_actor_id AND role IN ('owner','admin','member'))
    THEN RAISE EXCEPTION 'Document access denied' USING ERRCODE = '42501'; END IF;
  IF d.source_kind <> 'uploaded_pdf' OR to_jsonb(d)->>'work_program_revision_id' IS NOT NULL OR d.checksum IS NULL OR d.storage_ref IS NULL OR p_mode NOT IN ('text','ocr') OR p_request_id IS NULL
    THEN RAISE EXCEPTION 'Invalid extraction request' USING ERRCODE = '22023'; END IF;
  SELECT * INTO j FROM public.kb_ocr_jobs WHERE request_id = p_request_id;
  IF FOUND THEN
    IF j.document_id <> d.id OR j.extraction_mode <> p_mode OR j.source_checksum IS DISTINCT FROM d.checksum OR j.requested_by IS DISTINCT FROM p_actor_id
      THEN RAISE EXCEPTION 'Retry payload changed' USING ERRCODE = 'PT409'; END IF;
    RETURN j;
  END IF;
  SELECT * INTO j FROM public.kb_ocr_jobs WHERE document_id = d.id AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    IF j.dispatch_callback_url IS NOT NULL AND j.source_checksum = d.checksum AND NOT j.cancel_requested
       AND EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id=d.workspace_id AND user_id=j.requested_by AND role IN ('owner','admin','member')) THEN RETURN j; END IF;
    UPDATE public.kb_ocr_jobs SET status='failed', cancel_requested=true,
      failure_detail='Superseded by an explicit retry: the previous job lacks current dispatch custody or requester access. Original retained.' WHERE id=j.id;
  END IF;
  INSERT INTO public.kb_ocr_jobs(workspace_id, document_id, request_id, requested_by, extraction_mode, source_checksum, languages, dispatch_callback_url)
    VALUES (d.workspace_id, d.id, p_request_id, p_actor_id, p_mode, d.checksum, p_languages, p_callback_url) RETURNING * INTO j;
  RETURN j;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_kb_extraction(uuid,uuid,text,text,text[],text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_kb_extraction(uuid,uuid,text,text,text[],text) TO service_role;

-- Receipt, immutable pages, complete chunk application and status commit together.
-- Historical receipts without an applied hash do not acknowledge unapplied work.
CREATE OR REPLACE FUNCTION public.apply_kb_extraction_callback(p_callback jsonb, p_chunks jsonb, p_payload_bytes integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  j public.kb_ocr_jobs; d public.kb_documents; v_hash text; v_existing_hash text;
  v_status text; v_pages jsonb; v_chunk jsonb; v_count integer; v_extraction uuid; v_index_conflict boolean := false;
BEGIN
  SELECT * INTO j FROM public.kb_ocr_jobs WHERE request_id = p_callback->>'requestId' FOR UPDATE;
  IF j.id IS NULL OR coalesce(to_jsonb(j)->>'job_kind','extraction') <> 'extraction' THEN RAISE EXCEPTION 'Unknown extraction request' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO d FROM public.kb_documents WHERE id = j.document_id FOR UPDATE;
  IF d.workspace_id IS DISTINCT FROM j.workspace_id OR NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = j.workspace_id AND user_id = j.requested_by AND role IN ('owner','admin','member'))
    THEN RAISE EXCEPTION 'Extraction requester access revoked' USING ERRCODE = '42501'; END IF;
  IF j.source_checksum IS NOT NULL AND j.source_checksum IS DISTINCT FROM d.checksum
    THEN RAISE EXCEPTION 'Original checksum changed' USING ERRCODE = 'PT409'; END IF;
  IF j.worker_job_id IS NOT NULL AND j.worker_job_id <> p_callback->>'jobReference'
    THEN RAISE EXCEPTION 'Worker reference changed' USING ERRCODE = 'PT409'; END IF;
  v_hash := encode(extensions.digest(convert_to(p_callback::text, 'UTF8'), 'sha256'), 'hex');
  SELECT applied_payload_sha256 INTO v_existing_hash FROM public.kb_ocr_job_callbacks WHERE callback_id = p_callback->>'callbackId';
  IF v_existing_hash IS NOT NULL THEN
    IF v_hash <> v_existing_hash THEN RAISE EXCEPTION 'Callback payload changed' USING ERRCODE = 'PT409'; END IF;
    RETURN jsonb_build_object('ok',true,'deduped',true);
  END IF;
  IF j.status IN ('succeeded','failed') THEN RETURN jsonb_build_object('ok',true,'ignored','terminal'); END IF;
  v_status := CASE p_callback->>'status' WHEN 'accepted' THEN 'running' WHEN 'canceled' THEN 'failed' ELSE p_callback->>'status' END;
  IF v_status NOT IN ('running','succeeded','failed') THEN RAISE EXCEPTION 'Invalid callback status' USING ERRCODE = '22023'; END IF;
  IF j.cancel_requested THEN v_status := 'failed'; END IF;
  IF v_status = 'succeeded' THEN
    v_pages := p_callback->'pages'; v_count := (p_callback->>'pageCount')::integer;
    IF jsonb_typeof(v_pages) IS DISTINCT FROM 'array' OR v_count < 1 OR jsonb_array_length(v_pages) <> v_count OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_pages) WITH ORDINALITY AS pages(page,n)
      WHERE (page->>'page')::integer IS DISTINCT FROM n OR jsonb_typeof(page->'text') IS DISTINCT FROM 'string'
    ) THEN RAISE EXCEPTION 'Page sequence mismatch' USING ERRCODE = '22023'; END IF;
    INSERT INTO public.kb_document_extractions(workspace_id,document_id,job_id,document_checksum,pages_json,page_count,content_sha256,engine_json)
      VALUES (j.workspace_id,d.id,j.id,d.checksum,v_pages,v_count,encode(extensions.digest(convert_to(v_pages::text,'UTF8'),'sha256'),'hex'),coalesce(p_callback->'engine','{}'::jsonb)) RETURNING id INTO v_extraction;
    IF jsonb_array_length(p_chunks) = 0 THEN
      v_status := 'failed';
    ELSIF d.status <> 'ready' THEN
      -- Never rewrite legacy chunks: older claims may cite their identifiers.
      -- Retain the new complete pages even when the old partial index cannot be resumed.
      SELECT EXISTS (SELECT 1 FROM public.kb_document_chunks old WHERE old.document_id=d.id AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_chunks) candidate WHERE
          old.chunk_index=(candidate->>'chunk_index')::integer AND old.content=candidate->>'content'
          AND old.page_from=(candidate->>'page_from')::integer AND old.page_to=(candidate->>'page_to')::integer
          AND old.char_start=(candidate->>'char_start')::integer AND old.char_end=(candidate->>'char_end')::integer
      )) INTO v_index_conflict;
      IF v_index_conflict THEN
        UPDATE public.kb_documents SET status='failed', page_count=v_count,
          extraction_error='Complete extraction retained for source review. Existing partial search text differs and was preserved; search indexing remains unresolved.' WHERE id=d.id;
      ELSE
      FOR v_chunk IN SELECT value FROM jsonb_array_elements(p_chunks) LOOP
        IF (v_chunk->>'document_id')::uuid IS DISTINCT FROM d.id OR (v_chunk->>'workspace_id')::uuid IS DISTINCT FROM j.workspace_id
          THEN RAISE EXCEPTION 'Chunk scope mismatch' USING ERRCODE = '42501'; END IF;
        INSERT INTO public.kb_document_chunks(document_id,workspace_id,chunk_index,page_from,page_to,char_start,char_end,content,token_estimate)
          VALUES (d.id,j.workspace_id,(v_chunk->>'chunk_index')::integer,(v_chunk->>'page_from')::integer,(v_chunk->>'page_to')::integer,(v_chunk->>'char_start')::integer,(v_chunk->>'char_end')::integer,v_chunk->>'content',(v_chunk->>'token_estimate')::integer)
          ON CONFLICT (document_id,chunk_index) DO NOTHING;
        IF NOT EXISTS (SELECT 1 FROM public.kb_document_chunks WHERE document_id=d.id AND chunk_index=(v_chunk->>'chunk_index')::integer AND content=v_chunk->>'content' AND page_from=(v_chunk->>'page_from')::integer AND page_to=(v_chunk->>'page_to')::integer)
          THEN RAISE EXCEPTION 'Existing text differs; retained extraction available after conflict resolution' USING ERRCODE = 'PT409'; END IF;
      END LOOP;
      IF (SELECT count(*) FROM public.kb_document_chunks WHERE document_id=d.id) <> jsonb_array_length(p_chunks)
        THEN RAISE EXCEPTION 'Incomplete chunk set' USING ERRCODE = 'PT409'; END IF;
      UPDATE public.kb_documents SET status='ready',page_count=v_count,chunk_count=jsonb_array_length(p_chunks),
        char_count=(SELECT sum(length(value->>'text')) FROM jsonb_array_elements(v_pages)),
        extraction_source=CASE WHEN j.extraction_mode='text' THEN 'text_layer' ELSE 'ocr' END, extraction_error=NULL WHERE id=d.id;
      END IF;
    END IF;
    IF d.status <> 'ready' AND v_status='failed' THEN
      UPDATE public.kb_documents SET page_count=v_count, status='failed', extraction_error='No readable text. The original and page inventory remain available for manual review.' WHERE id=d.id;
    END IF;
  END IF;
  UPDATE public.kb_ocr_jobs SET status=v_status, worker_job_id=coalesce(worker_job_id,p_callback->>'jobReference'),
    progress=coalesce((p_callback->>'progress')::integer,progress), message=CASE WHEN v_index_conflict THEN 'Complete extraction retained; existing partial search index differs and remains unresolved.' ELSE p_callback->>'message' END,
    page_count=coalesce((p_callback->>'pageCount')::integer,page_count), engine_name=coalesce(p_callback->'engine'->>'name',engine_name),
    engine_version=coalesce(p_callback->'engine'->>'version',engine_version), pages_with_text=coalesce((p_callback->'engine'->>'pagesWithText')::integer,pages_with_text),
    last_callback_id=p_callback->>'callbackId',last_callback_at=(p_callback->>'occurredAt')::timestamptz,
    failure_detail=CASE WHEN v_status='failed' THEN CASE WHEN cancel_requested THEN 'Canceled by requester; original retained.' ELSE coalesce(p_callback->>'message','No readable text was produced.') END ELSE NULL END
    WHERE id=j.id;
  INSERT INTO public.kb_ocr_job_callbacks(ocr_job_id,workspace_id,callback_id,status,occurred_at,page_count,payload_bytes,applied_payload_sha256)
    VALUES (j.id,j.workspace_id,p_callback->>'callbackId',p_callback->>'status',(p_callback->>'occurredAt')::timestamptz,(p_callback->>'pageCount')::integer,p_payload_bytes,v_hash)
    ON CONFLICT(callback_id) DO UPDATE SET applied_payload_sha256=excluded.applied_payload_sha256;
  RETURN jsonb_build_object('ok',true,'status',v_status,'extractionId',v_extraction);
END $$;
REVOKE ALL ON FUNCTION public.apply_kb_extraction_callback(jsonb,jsonb,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_kb_extraction_callback(jsonb,jsonb,integer) TO service_role;

-- Keep the v1 storage envelope; preparation.formatVersion=2 is the structured proposal format.
-- Historical JSON is never rewritten. Recheck every source, extraction, staff and contract reference on save.
-- Application conflicts are not retryable transaction serialization failures.
-- Older PostgREST versions retry 40001 indefinitely, hiding the conflict until
-- the HTTP proxy times out. PT409 gives the caller a prompt conflict response.
CREATE OR REPLACE FUNCTION public.save_program_work_program_revision(
  p_program_id uuid, p_actor_id uuid, p_expected_revision integer,
  p_request_id uuid, p_content jsonb
) RETURNS public.program_work_program_revisions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_workspace uuid;
  v_latest public.program_work_program_revisions;
  v_existing public.program_work_program_revisions;
  v_saved public.program_work_program_revisions;
  v_element jsonb;
  v_ref jsonb;
BEGIN
  SELECT workspace_id INTO v_workspace FROM public.programs WHERE id = p_program_id FOR UPDATE;
  IF v_workspace IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.workspace_members WHERE workspace_id = v_workspace AND user_id = p_actor_id
      AND role IN ('owner','admin','member')
  ) THEN RAISE EXCEPTION 'Work program access denied' USING ERRCODE = '42501'; END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 0 OR p_request_id IS NULL OR p_content IS NULL OR octet_length(p_content::text) > 2000000
    OR p_content->>'schemaVersion' IS DISTINCT FROM '1' OR jsonb_typeof(p_content->'elements') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'Invalid work program content' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_existing FROM public.program_work_program_revisions WHERE program_id = p_program_id AND request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.content_json <> p_content THEN RAISE EXCEPTION 'Retry payload changed' USING ERRCODE = 'PT409'; END IF;
    RETURN v_existing;
  END IF;
  SELECT * INTO v_latest FROM public.program_work_program_revisions WHERE program_id = p_program_id ORDER BY revision DESC LIMIT 1;
  IF coalesce(v_latest.revision, 0) <> p_expected_revision THEN RAISE EXCEPTION 'Work program changed; reload before saving' USING ERRCODE = 'PT409'; END IF;
  FOR v_element IN SELECT value FROM jsonb_array_elements(p_content->'elements') LOOP
    IF v_element->'source' IS NOT NULL AND v_element->'source' <> 'null'::jsonb AND NOT EXISTS (
      SELECT 1 FROM public.program_work_program_sources s
      WHERE s.id = (v_element->'source'->>'sourceId')::uuid AND s.program_id = p_program_id AND s.workspace_id = v_workspace
    ) THEN RAISE EXCEPTION 'Source does not belong to this program' USING ERRCODE = '42501'; END IF;
    IF v_element->>'projectId' IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.projects WHERE id = (v_element->>'projectId')::uuid AND workspace_id = v_workspace
    ) THEN RAISE EXCEPTION 'Project does not belong to this workspace' USING ERRCODE = '42501'; END IF;
  END LOOP;

  FOR v_ref IN SELECT jsonb_path_query(p_content, '$.** ? (@.sourceId != null)') LOOP
    IF NOT EXISTS(SELECT 1 FROM public.program_work_program_sources WHERE id=(v_ref->>'sourceId')::uuid AND program_id=p_program_id AND workspace_id=v_workspace)
      THEN RAISE EXCEPTION 'Cited source belongs to another program' USING ERRCODE='42501'; END IF;
    IF coalesce(v_ref->>'extractionVersionId',v_ref->>'versionId') IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM public.program_work_program_extractions WHERE id=coalesce(v_ref->>'extractionVersionId',v_ref->>'versionId')::uuid AND source_id=(v_ref->>'sourceId')::uuid AND workspace_id=v_workspace)
      THEN RAISE EXCEPTION 'Cited extraction belongs to another source' USING ERRCODE='42501'; END IF;
  END LOOP;
  FOR v_ref IN SELECT value FROM jsonb_array_elements(coalesce(p_content->'preparation'->'amendments','[]'::jsonb)) LOOP
    IF NOT EXISTS(SELECT 1 FROM public.program_work_program_sources WHERE id=(v_ref->>'amendmentSourceId')::uuid AND program_id=p_program_id AND workspace_id=v_workspace)
      OR NOT EXISTS(SELECT 1 FROM public.program_work_program_sources WHERE id=(v_ref->>'modifiesSourceId')::uuid AND program_id=p_program_id AND workspace_id=v_workspace)
      THEN RAISE EXCEPTION 'Amendment relationship references another program' USING ERRCODE='42501'; END IF;
  END LOOP;
  FOR v_ref IN SELECT value FROM jsonb_array_elements(coalesce(p_content->'preparation'->'staffing','[]'::jsonb)) LOOP
    IF v_ref->>'staffId' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.invoicing_staff WHERE id=(v_ref->>'staffId')::uuid AND workspace_id=v_workspace)
      THEN RAISE EXCEPTION 'Staff member belongs to another workspace' USING ERRCODE='42501'; END IF;
  END LOOP;
  FOR v_ref IN SELECT value FROM jsonb_array_elements(coalesce(p_content->'preparation'->'costs','[]'::jsonb)) LOOP
    IF v_ref->>'contractId' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.invoicing_engagements WHERE id=(v_ref->>'contractId')::uuid AND workspace_id=v_workspace)
      THEN RAISE EXCEPTION 'Contract belongs to another workspace' USING ERRCODE='42501'; END IF;
  END LOOP;
  INSERT INTO public.program_work_program_revisions(program_id, workspace_id, revision, previous_revision_id, request_id, content_json, content_sha256, created_by, source_ids)
  VALUES (p_program_id, v_workspace, p_expected_revision + 1, v_latest.id, p_request_id, p_content,
    encode(extensions.digest(convert_to(p_content::text, 'UTF8'), 'sha256'), 'hex'), p_actor_id,
    ARRAY(SELECT s.id FROM public.program_work_program_sources s WHERE s.program_id = p_program_id ORDER BY s.id))
  RETURNING * INTO v_saved;
  RETURN v_saved;
END;
$$;
REVOKE ALL ON FUNCTION public.save_program_work_program_revision(uuid,uuid,integer,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_program_work_program_revision(uuid,uuid,integer,uuid,jsonb) TO service_role;


CREATE OR REPLACE FUNCTION public.guard_work_program_export_document() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
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

CREATE OR REPLACE FUNCTION public.enqueue_work_program_export(p_program_id uuid,p_revision integer,p_format text,p_actor_id uuid)
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

CREATE OR REPLACE FUNCTION public.claim_work_program_export(p_token uuid) RETURNS public.kb_ocr_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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

CREATE OR REPLACE FUNCTION public.finish_work_program_export(p_job uuid,p_token uuid,p_checksum text,p_bytes bigint,p_storage_ref text,p_engine text)
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
