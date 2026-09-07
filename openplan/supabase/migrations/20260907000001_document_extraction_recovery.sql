-- Extend Documents/OCR custody. Accepted jobs are the existing kb_ocr_jobs queue.
ALTER TABLE public.kb_ocr_jobs ADD COLUMN extraction_mode text NOT NULL DEFAULT 'ocr' CHECK (extraction_mode IN ('text','ocr'));
ALTER TABLE public.kb_ocr_jobs ADD COLUMN source_checksum text;
ALTER TABLE public.kb_ocr_jobs ADD COLUMN dispatch_after timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.kb_ocr_jobs ADD COLUMN dispatch_callback_url text;
ALTER TABLE public.kb_ocr_jobs ADD COLUMN cancel_requested boolean NOT NULL DEFAULT false;
ALTER TABLE public.kb_ocr_job_callbacks ADD COLUMN applied_payload_sha256 text;

CREATE TABLE public.kb_document_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  document_id uuid NOT NULL REFERENCES public.kb_documents(id) ON DELETE CASCADE,
  job_id uuid NOT NULL UNIQUE REFERENCES public.kb_ocr_jobs(id) ON DELETE CASCADE,
  document_checksum text NOT NULL,
  pages_json jsonb NOT NULL CHECK (jsonb_typeof(pages_json) = 'array'),
  page_count integer NOT NULL CHECK (page_count > 0),
  content_sha256 text NOT NULL,
  engine_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.kb_document_extractions ENABLE ROW LEVEL SECURITY;
CREATE POLICY kb_document_extractions_read ON public.kb_document_extractions FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.kb_documents d JOIN public.workspace_members m ON m.workspace_id = d.workspace_id
    WHERE d.id = document_id AND d.workspace_id = kb_document_extractions.workspace_id AND m.user_id = auth.uid())
);
REVOKE ALL ON public.kb_document_extractions FROM anon, authenticated, service_role;
GRANT SELECT ON public.kb_document_extractions TO authenticated, service_role;

CREATE FUNCTION public.enqueue_kb_extraction(p_document_id uuid, p_actor_id uuid, p_request_id text, p_mode text, p_languages text[], p_callback_url text)
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
CREATE FUNCTION public.apply_kb_extraction_callback(p_callback jsonb, p_chunks jsonb, p_payload_bytes integer)
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
