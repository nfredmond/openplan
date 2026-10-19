-- SOURCE ONLY. Reserved additive migration, not applied in the implementation lane.
-- NULL method means historical provenance was not recorded here. Do not invent it.
ALTER TABLE public.rtp_extraction_runs
  ADD COLUMN source_method text CHECK (source_method IS NULL OR source_method = 'manual_retained_page'),
  ADD COLUMN document_extraction_id uuid REFERENCES public.kb_document_extractions(id) ON DELETE RESTRICT,
  ADD COLUMN original_checksum text,
  ADD COLUMN extraction_content_sha256 text,
  ADD COLUMN manual_request_id uuid,
  ADD COLUMN manual_request_payload jsonb,
  ADD COLUMN manual_payload_sha256 text,
  ADD COLUMN manual_authorship text,
  ADD CONSTRAINT rtp_manual_run_shape CHECK (
    (source_method IS NULL AND document_extraction_id IS NULL AND original_checksum IS NULL
      AND extraction_content_sha256 IS NULL AND manual_request_id IS NULL
      AND manual_request_payload IS NULL AND manual_payload_sha256 IS NULL AND manual_authorship IS NULL)
    OR (source_method IS NOT NULL AND source_method = 'manual_retained_page' AND model IS NULL AND status = 'succeeded'
      AND candidate_count = 1 AND discarded_count = 0 AND document_extraction_id IS NOT NULL
      AND original_checksum IS NOT NULL AND extraction_content_sha256 IS NOT NULL
      AND manual_request_id IS NOT NULL AND manual_request_payload IS NOT NULL
      AND manual_payload_sha256 IS NOT NULL AND manual_authorship IS NOT NULL AND manual_authorship = 'authenticated_user')
  );
CREATE UNIQUE INDEX rtp_manual_request_identity ON public.rtp_extraction_runs(workspace_id, manual_request_id)
  WHERE manual_request_id IS NOT NULL;
CREATE INDEX rtp_manual_retained_source ON public.rtp_extraction_runs(document_extraction_id)
  WHERE document_extraction_id IS NOT NULL;

-- A manual copy uses the same draft review table without inventing a model id.
-- Historical non-null rows and AI writers remain unchanged.
ALTER TABLE public.document_narrative_drafts ALTER COLUMN model DROP NOT NULL;
ALTER TABLE public.document_narrative_drafts ADD CONSTRAINT manual_transcription_without_model CHECK (
  model IS NOT NULL OR (target_kind='rtp_chapter'
    AND grounding_json->>'mode' IS NOT DISTINCT FROM 'transcription'
    AND grounding_json->>'source_method' IS NOT DISTINCT FROM 'manual_retained_page'
    AND grounding_json->>'chunk_recheck' IS NOT DISTINCT FROM 'retained_page_matched')
);

-- One full numbered page, projected inside Postgres so the application never loads
-- the entire retained PDF text or mistakes a truncated preview for the source.
CREATE FUNCTION public.read_rtp_retained_source_page(p_cycle_id uuid, p_document_id uuid, p_extraction_id uuid, p_page integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE d public.kb_documents; e public.kb_document_extractions; j public.kb_ocr_jobs; v_page jsonb;
BEGIN
  SELECT doc.* INTO d FROM public.kb_documents doc JOIN public.rtp_cycles c ON c.workspace_id=doc.workspace_id
    WHERE c.id=p_cycle_id AND doc.id=p_document_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO e FROM public.kb_document_extractions WHERE id=p_extraction_id AND document_id=d.id AND workspace_id=d.workspace_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO j FROM public.kb_ocr_jobs WHERE id=e.job_id AND document_id=d.id AND workspace_id=d.workspace_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF d.checksum IS DISTINCT FROM e.document_checksum OR j.source_checksum IS DISTINCT FROM e.document_checksum
     OR d.source_kind <> 'uploaded_pdf' OR d.storage_ref IS NULL OR btrim(d.storage_ref)=''
     OR j.extraction_mode NOT IN ('text','ocr')
    THEN RAISE EXCEPTION 'Retained source identity changed' USING ERRCODE='PT409'; END IF;
  IF p_page IS NULL OR p_page < 1 OR p_page > e.page_count THEN RETURN NULL; END IF;
  v_page := e.pages_json->(p_page-1);
  IF (v_page->>'page')::integer IS DISTINCT FROM p_page OR jsonb_typeof(v_page->'text') IS DISTINCT FROM 'string'
    THEN RAISE EXCEPTION 'Retained page unavailable' USING ERRCODE='PT409'; END IF;
  IF length(v_page->>'text') > 200000 OR btrim(v_page->>'text') = '' THEN
    RETURN jsonb_build_object('uncheckable', true);
  END IF;
  RETURN jsonb_build_object('documentId',d.id,'extractionId',e.id,'checksum',e.document_checksum,
    'contentSha256',e.content_sha256,'source',CASE j.extraction_mode WHEN 'text' THEN 'text_layer' ELSE 'ocr' END,
    'page',p_page,'pageCount',e.page_count,'text',v_page->>'text');
END $$;
REVOKE ALL ON FUNCTION public.read_rtp_retained_source_page(uuid,uuid,uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.read_rtp_retained_source_page(uuid,uuid,uuid,integer) TO authenticated, service_role;

-- Service-only sink after route-local deterministic verification. No caller-provided
-- workspace, verified flag or candidate may reach this function through the Data API.
-- Job -> document -> membership -> cycle -> extraction locking keeps source/access
-- checks and both inserts in one transaction, including concurrent identical retries.
CREATE FUNCTION public.stage_rtp_manual_source_proposal(
  p_cycle_id uuid, p_workspace_id uuid, p_actor_id uuid, p_request jsonb,
  p_page_text text, p_source text, p_proposed jsonb, p_quote text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  d public.kb_documents; e public.kb_document_extractions; j public.kb_ocr_jobs;
  r public.rtp_extraction_runs; c public.rtp_extraction_candidates;
  v_page integer; v_request_id uuid; v_page_json jsonb; v_hash text;
BEGIN
  -- Match the extraction callback's job-before-document order. Definer rights
  -- permit locking the SELECT-only immutable extraction without granting its
  -- UPDATE privilege to service_role. EXECUTE remains service-only below.
  SELECT * INTO e FROM public.kb_document_extractions WHERE id=(p_request->>'documentExtractionId')::uuid
    AND document_id=(p_request->>'kbDocumentId')::uuid AND workspace_id=p_workspace_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Retained source missing' USING ERRCODE='PT409'; END IF;
  SELECT * INTO j FROM public.kb_ocr_jobs WHERE id=e.job_id AND document_id=e.document_id AND workspace_id=p_workspace_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Retained job missing' USING ERRCODE='PT409'; END IF;
  SELECT * INTO d FROM public.kb_documents WHERE id=(p_request->>'kbDocumentId')::uuid AND workspace_id=p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source missing' USING ERRCODE='PT409'; END IF;
  PERFORM 1 FROM public.workspace_members WHERE workspace_id=d.workspace_id AND user_id=p_actor_id AND role IN ('owner','admin','member') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan write access revoked' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.rtp_cycles WHERE id=p_cycle_id AND workspace_id=d.workspace_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cycle access changed' USING ERRCODE='42501'; END IF;
  SELECT * INTO e FROM public.kb_document_extractions WHERE id=(p_request->>'documentExtractionId')::uuid AND document_id=d.id AND workspace_id=d.workspace_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Retained source missing' USING ERRCODE='PT409'; END IF;
  IF j.id IS DISTINCT FROM e.job_id THEN RAISE EXCEPTION 'Retained job changed' USING ERRCODE='PT409'; END IF;
  v_page := (p_request->>'sourcePage')::integer;
  v_page_json := e.pages_json->(v_page-1);
  IF d.source_kind <> 'uploaded_pdf' OR d.storage_ref IS NULL OR btrim(d.storage_ref)=''
    OR d.checksum IS DISTINCT FROM e.document_checksum
    OR e.document_checksum IS DISTINCT FROM p_request->>'documentChecksum'
    OR e.content_sha256 IS DISTINCT FROM p_request->>'contentSha256'
    OR j.source_checksum IS DISTINCT FROM e.document_checksum
    OR j.extraction_mode NOT IN ('text','ocr')
    OR p_source IS DISTINCT FROM CASE j.extraction_mode WHEN 'text' THEN 'text_layer' ELSE 'ocr' END
    OR v_page IS NULL OR v_page < 1 OR v_page > e.page_count
    OR (v_page_json->>'page')::integer IS DISTINCT FROM v_page
    OR jsonb_typeof(v_page_json->'text') IS DISTINCT FROM 'string'
    OR p_page_text IS DISTINCT FROM v_page_json->>'text'
    OR length(p_page_text) > 200000 OR btrim(p_page_text) = ''
    THEN RAISE EXCEPTION 'Source changed after verification' USING ERRCODE='PT409'; END IF;
  IF p_quote IS NULL OR btrim(p_quote) = '' OR p_proposed IS NULL OR jsonb_typeof(p_proposed) <> 'object'
    THEN RAISE EXCEPTION 'Verified proposal required' USING ERRCODE='22023'; END IF;
  v_request_id := (p_request->>'requestId')::uuid;
  IF v_request_id IS NULL THEN RAISE EXCEPTION 'Request identity required' USING ERRCODE='22023'; END IF;
  -- Serializes one request across different documents without a retry insert race.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':' || v_request_id::text, 0));
  v_hash := encode(extensions.digest(convert_to(p_request::text,'UTF8'),'sha256'),'hex');
  SELECT * INTO r FROM public.rtp_extraction_runs WHERE workspace_id=p_workspace_id AND manual_request_id=v_request_id;
  IF FOUND THEN
    IF r.rtp_cycle_id IS DISTINCT FROM p_cycle_id OR r.created_by IS DISTINCT FROM p_actor_id
      OR r.manual_request_payload IS DISTINCT FROM p_request OR r.manual_payload_sha256 IS DISTINCT FROM v_hash
      THEN RAISE EXCEPTION 'Retry payload changed' USING ERRCODE='PT409'; END IF;
    SELECT * INTO c FROM public.rtp_extraction_candidates WHERE run_id=r.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Retained candidate missing' USING ERRCODE='PT409'; END IF;
    RETURN jsonb_build_object('runId',r.id,'candidateId',c.id,'deduped',true);
  END IF;
  INSERT INTO public.rtp_extraction_runs(workspace_id,rtp_cycle_id,kb_document_id,model,extraction_source,status,
    candidate_count,discarded_count,created_by,source_method,document_extraction_id,original_checksum,
    extraction_content_sha256,manual_request_id,manual_request_payload,manual_payload_sha256,manual_authorship)
  VALUES (p_workspace_id,p_cycle_id,d.id,NULL,p_source,'succeeded',1,0,p_actor_id,'manual_retained_page',e.id,
    e.document_checksum,e.content_sha256,v_request_id,p_request,v_hash,'authenticated_user') RETURNING * INTO r;
  INSERT INTO public.rtp_extraction_candidates(workspace_id,rtp_cycle_id,run_id,target_kind,proposed_json,
    source_chunk_id,source_page,source_quote,quote_verified,status)
  VALUES (p_workspace_id,p_cycle_id,r.id,p_request->>'targetKind',p_proposed,NULL,v_page,p_quote,true,'pending') RETURNING * INTO c;
  RETURN jsonb_build_object('runId',r.id,'candidateId',c.id,'deduped',false);
END $$;
REVOKE ALL ON FUNCTION public.stage_rtp_manual_source_proposal(uuid,uuid,uuid,jsonb,text,text,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stage_rtp_manual_source_proposal(uuid,uuid,uuid,jsonb,text,text,jsonb,text) TO service_role;

-- Preserve manual source/payload identity, but leave the existing review status,
-- accepted-row linkage and rejection routes writable. No DELETE trigger changes
-- cycle/workspace cascades. The original document RESTRICT FK stays in force.
CREATE FUNCTION public.guard_rtp_manual_source_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_TABLE_NAME = 'rtp_extraction_runs' THEN
    IF OLD.source_method IS NOT NULL AND NEW.created_by IS DISTINCT FROM OLD.created_by AND NEW.created_by IS NOT NULL
      THEN RAISE EXCEPTION 'Manual source actor cannot be rebound' USING ERRCODE='23514'; END IF;
    IF (OLD.source_method IS NOT NULL OR NEW.source_method IS NOT NULL)
      AND (to_jsonb(NEW)-'created_by') IS DISTINCT FROM (to_jsonb(OLD)-'created_by')
      THEN RAISE EXCEPTION 'Manual source run is immutable' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME = 'rtp_extraction_candidates' THEN
    IF EXISTS (SELECT 1 FROM public.rtp_extraction_runs WHERE id IN (OLD.run_id,NEW.run_id) AND source_method='manual_retained_page')
      AND (NEW.id,NEW.workspace_id,NEW.rtp_cycle_id,NEW.run_id,NEW.target_kind,NEW.proposed_json,NEW.source_chunk_id,NEW.source_page,NEW.source_quote,NEW.quote_verified,NEW.created_at)
        IS DISTINCT FROM (OLD.id,OLD.workspace_id,OLD.rtp_cycle_id,OLD.run_id,OLD.target_kind,OLD.proposed_json,OLD.source_chunk_id,OLD.source_page,OLD.source_quote,OLD.quote_verified,OLD.created_at)
      THEN RAISE EXCEPTION 'Manual proposal source and payload are immutable' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME = 'kb_document_extractions' THEN
    IF EXISTS (SELECT 1 FROM public.rtp_extraction_runs WHERE document_extraction_id=OLD.id)
      AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)
      THEN RAISE EXCEPTION 'Referenced retained pages are immutable' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME = 'kb_ocr_jobs' THEN
    IF EXISTS (SELECT 1 FROM public.kb_document_extractions e JOIN public.rtp_extraction_runs r ON r.document_extraction_id=e.id WHERE e.job_id=OLD.id)
      AND (NEW.id,NEW.workspace_id,NEW.document_id,NEW.source_checksum,NEW.extraction_mode)
        IS DISTINCT FROM (OLD.id,OLD.workspace_id,OLD.document_id,OLD.source_checksum,OLD.extraction_mode)
      THEN RAISE EXCEPTION 'Referenced text method is immutable' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_rtp_manual_source_identity() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER rtp_manual_run_identity BEFORE UPDATE ON public.rtp_extraction_runs FOR EACH ROW EXECUTE FUNCTION public.guard_rtp_manual_source_identity();
CREATE TRIGGER rtp_manual_candidate_identity BEFORE UPDATE ON public.rtp_extraction_candidates FOR EACH ROW EXECUTE FUNCTION public.guard_rtp_manual_source_identity();
CREATE TRIGGER rtp_manual_retained_page_identity BEFORE UPDATE ON public.kb_document_extractions FOR EACH ROW EXECUTE FUNCTION public.guard_rtp_manual_source_identity();
CREATE TRIGGER rtp_manual_retained_job_identity BEFORE UPDATE ON public.kb_ocr_jobs FOR EACH ROW EXECUTE FUNCTION public.guard_rtp_manual_source_identity();
