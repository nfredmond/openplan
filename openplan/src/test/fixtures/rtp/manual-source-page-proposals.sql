-- PREPARED SOURCE ONLY. Root may run on an explicitly admitted isolated stack
-- after migration 20261019000002. No database operation ran in this lane.
-- Execute the entire file as the fixture administrator in one disposable transaction.
-- Blind: route verifier, actual two-session races, normal-user HTTP and OCR accuracy.
BEGIN;
CREATE FUNCTION pg_temp.manual_assert(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS NOT TRUE THEN RAISE EXCEPTION '%',label; END IF; END $$;
CREATE FUNCTION pg_temp.manual_refuses(statement text, expected_state text, expected_message text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE=expected_state AND (expected_message IS NULL OR SQLERRM=expected_message) THEN RETURN; END IF;
    RAISE EXCEPTION '% unexpected % %',label,SQLSTATE,SQLERRM;
  END;
  RAISE EXCEPTION '% accepted forbidden operation',label;
END $$;
DO $fixture$
DECLARE
  actor uuid:=gen_random_uuid(); workspace uuid:=gen_random_uuid(); cycle uuid:=gen_random_uuid();
  document uuid:=gen_random_uuid(); extraction uuid:=gen_random_uuid(); job uuid:=gen_random_uuid();
  request_id uuid:=gen_random_uuid(); request_json jsonb; call_sql text; result jsonb; replay jsonb;
  pages jsonb; source_text text:='SYNTHETIC source row $412,000,000 in 2024.';
  payload jsonb:='{"entryKind":"revenue","sourceName":"SYNTHETIC source row","amount":412000000}';
  before_count integer; source_page jsonb; content_hash text;
BEGIN
  INSERT INTO auth.users(id,email) VALUES(actor,actor||'@example.test');
  INSERT INTO public.workspaces(id,name,slug) VALUES(workspace,'SYNTHETIC manual source',workspace::text);
  INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(workspace,actor,'member');
  INSERT INTO public.rtp_cycles(id,workspace_id,title) VALUES(cycle,workspace,'SYNTHETIC prior-plan intake');
  INSERT INTO public.kb_documents(id,workspace_id,title,source_kind,status,checksum,extraction_source,storage_ref)
    VALUES(document,workspace,'SYNTHETIC retained plan','uploaded_pdf','ready','original-v1','text_layer','storage://kb-documents/'||workspace||'/'||document||'/synthetic.pdf');
  INSERT INTO public.kb_ocr_jobs(id,workspace_id,document_id,request_id,requested_by,extraction_mode,source_checksum,status)
    VALUES(job,workspace,document,job::text,actor,'text','original-v1','succeeded');
  SELECT jsonb_agg(jsonb_build_object('page',n,'text',CASE WHEN n=112 THEN source_text ELSE 'SYNTHETIC page '||n END) ORDER BY n)
    INTO pages FROM generate_series(1,140) n;
  content_hash:=encode(extensions.digest(convert_to(pages::text,'UTF8'),'sha256'),'hex');
  INSERT INTO public.kb_document_extractions(id,workspace_id,document_id,job_id,document_checksum,pages_json,page_count,content_sha256,engine_json)
    VALUES(extraction,workspace,document,job,'original-v1',pages,140,content_hash,'{"name":"synthetic text fixture"}');
  request_json:=jsonb_build_object('requestId',request_id,'kbDocumentId',document,'documentExtractionId',extraction,
    'sourcePage',112,'documentChecksum','original-v1','contentSha256',content_hash,'targetKind','financial_line','quote',source_text,'fields',payload);
  call_sql:=format('SELECT public.stage_rtp_manual_source_proposal(%L,%L,%L,%L,%L,%L,%L,%L)',cycle,workspace,actor,request_json,source_text,'text_layer',payload,source_text);
  SELECT count(*) INTO before_count FROM public.rtp_extraction_runs;
  -- Deliberate source text mismatch proves the transaction refuses before either insert.
  PERFORM pg_temp.manual_refuses(format('SELECT public.stage_rtp_manual_source_proposal(%L,%L,%L,%L,%L,%L,%L,%L)',cycle,workspace,actor,request_json,'altered page','text_layer',payload,source_text),'PT409','Source changed after verification','NATIVE_SOURCE_DRIFT');
  PERFORM pg_temp.manual_assert((SELECT count(*)=before_count FROM public.rtp_extraction_runs),'NATIVE_NO_PARTIAL_RUN');
  PERFORM pg_temp.manual_refuses(format('SELECT public.stage_rtp_manual_source_proposal(%L,%L,%L,%L,%L,%L,%L,%L)',cycle,workspace,actor,jsonb_set(request_json,'{contentSha256}','"different-version-hash"'),source_text,'text_layer',payload,source_text),'PT409','Source changed after verification','NATIVE_HASH_DRIFT');
  -- Force a candidate CHECK failure after run insertion. The whole call rolls back.
  PERFORM pg_temp.manual_refuses(format('SELECT public.stage_rtp_manual_source_proposal(%L,%L,%L,%L,%L,%L,%L,%L)',cycle,workspace,actor,jsonb_set(request_json,'{targetKind}','"invalid_kind"'),source_text,'text_layer',payload,source_text),'23514',NULL,'NATIVE_ATOMIC_CANDIDATE_FAILURE');
  PERFORM pg_temp.manual_assert((SELECT count(*)=before_count FROM public.rtp_extraction_runs),'NATIVE_ATOMIC_RUN_ROLLBACK');
  EXECUTE call_sql INTO result;
  EXECUTE call_sql INTO replay;
  PERFORM pg_temp.manual_assert(result->>'runId'=replay->>'runId' AND result->>'candidateId'=replay->>'candidateId' AND (replay->>'deduped')::boolean,'NATIVE_IDENTICAL_REPLAY');
  PERFORM pg_temp.manual_refuses(format('SELECT public.stage_rtp_manual_source_proposal(%L,%L,%L,%L,%L,%L,%L,%L)',cycle,workspace,actor,jsonb_set(request_json,'{quote}','"changed quote"'),source_text,'text_layer',payload,source_text),'PT409','Retry payload changed','NATIVE_CHANGED_REPLAY');
  PERFORM pg_temp.manual_assert((SELECT model IS NULL AND source_method='manual_retained_page' AND extraction_source='text_layer'
    AND manual_authorship='authenticated_user' AND manual_request_payload=request_json AND manual_payload_sha256=encode(extensions.digest(convert_to(request_json::text,'UTF8'),'sha256'),'hex')
    FROM public.rtp_extraction_runs WHERE id=(result->>'runId')::uuid),'NATIVE_PROVENANCE');
  PERFORM pg_temp.manual_assert((SELECT candidate.source_chunk_id IS NULL AND candidate.quote_verified AND candidate.source_page=112 AND candidate.proposed_json=payload
    FROM public.rtp_extraction_candidates candidate WHERE candidate.id=(result->>'candidateId')::uuid),'NATIVE_CANDIDATE');
  SELECT public.read_rtp_retained_source_page(cycle,document,extraction,112) INTO source_page;
  PERFORM pg_temp.manual_assert(source_page->>'text'=source_text AND source_page->>'pageCount'='140' AND source_page->>'extractionId'=extraction::text,'NATIVE_FULL_LATE_PAGE');
  PERFORM pg_temp.manual_assert(public.read_rtp_retained_source_page(cycle,document,gen_random_uuid(),112) IS NULL,'NATIVE_WRONG_VERSION');
  PERFORM pg_temp.manual_refuses(format('UPDATE public.rtp_extraction_candidates SET source_quote=%L WHERE id=%L','changed',result->>'candidateId'),'23514','Manual proposal source and payload are immutable','NATIVE_CANDIDATE_IMMUTABLE');
  PERFORM pg_temp.manual_refuses(format('UPDATE public.rtp_extraction_runs SET manual_payload_sha256=%L WHERE id=%L','changed',result->>'runId'),'23514','Manual source run is immutable','NATIVE_RUN_IMMUTABLE');
  PERFORM pg_temp.manual_refuses(format('UPDATE public.kb_document_extractions SET pages_json=%L WHERE id=%L','[]',extraction),'23514','Referenced retained pages are immutable','NATIVE_PAGE_IMMUTABLE');
  PERFORM pg_temp.manual_refuses(format('UPDATE public.kb_ocr_jobs SET extraction_mode=%L WHERE id=%L','ocr',job),'23514','Referenced text method is immutable','NATIVE_METHOD_IMMUTABLE');
  PERFORM pg_temp.manual_refuses(format('DELETE FROM public.kb_documents WHERE id=%L',document),'23503',NULL,'NATIVE_ORIGINAL_RESTRICT');
  PERFORM pg_temp.manual_refuses(format('DELETE FROM public.kb_document_extractions WHERE id=%L',extraction),'23503',NULL,'NATIVE_VERSION_RESTRICT');
  UPDATE public.rtp_extraction_candidates SET status='rejected',reviewed_by=actor,reviewed_at=now() WHERE id=(result->>'candidateId')::uuid;
  PERFORM pg_temp.manual_assert((SELECT status='rejected' FROM public.rtp_extraction_candidates WHERE id=(result->>'candidateId')::uuid),'NATIVE_REVIEW_MUTABLE');
  UPDATE public.workspace_members SET role='viewer' WHERE workspace_id=workspace AND user_id=actor;
  PERFORM pg_temp.manual_refuses(call_sql,'42501','Plan write access revoked','NATIVE_ACCESS_REVOCATION');
  PERFORM pg_temp.manual_assert(NOT has_function_privilege('authenticated','public.stage_rtp_manual_source_proposal(uuid,uuid,uuid,jsonb,text,text,jsonb,text)','EXECUTE')
    AND NOT has_function_privilege('anon','public.stage_rtp_manual_source_proposal(uuid,uuid,uuid,jsonb,text,text,jsonb,text)','EXECUTE'),'NATIVE_NO_CLIENT_WRITE');
  PERFORM pg_temp.manual_assert(has_function_privilege('authenticated','public.read_rtp_retained_source_page(uuid,uuid,uuid,integer)','EXECUTE'),'NATIVE_MEMBER_READ_RPC');
  DELETE FROM public.rtp_cycles WHERE id=cycle;
  PERFORM pg_temp.manual_assert(NOT EXISTS(SELECT 1 FROM public.rtp_extraction_candidates WHERE id=(result->>'candidateId')::uuid),'NATIVE_CYCLE_CASCADE');
END $fixture$;
ROLLBACK;
