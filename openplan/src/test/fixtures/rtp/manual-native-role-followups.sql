-- PREPARED SOURCE ONLY. Not parsed, compiled or executed in this lane.
-- Standalone addition to manual-source-page-proposals.sql, not a replacement.
-- Root must admit an isolated disposable database with 20261019000002 installed.
-- Run the ENTIRE file on one initial fixture-administrator connection, with
-- stop-on-error enabled. That login must seed auth/public rows and SET ROLE.
-- No helper function or SECURITY DEFINER test wrapper changes caller identity.
-- SQL only tests database shape; it does not invoke the TypeScript draft readers.
BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';
SELECT set_config('rtp_native_followup.initial_role', current_user, true);
SELECT set_config('request.jwt.claims', '{}', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', '', true);
DO $seed$
DECLARE
  tenants jsonb := '[]'; item jsonb; actor uuid; workspace uuid; cycle uuid;
  document uuid; extraction uuid; job uuid; request_id uuid; pages jsonb; hash text; custodian uuid:=gen_random_uuid();
  source_text text := 'SYNTHETIC policy. Improve access to the transit center.';
BEGIN
  IF current_user IS DISTINCT FROM session_user THEN RAISE EXCEPTION 'ROLE_INITIAL_ADMIN_CONTEXT'; END IF;
  INSERT INTO auth.users(id,email) VALUES(custodian,custodian||'@example.test');
  FOR i IN 1..2 LOOP
    actor:=gen_random_uuid(); cycle:=gen_random_uuid();
    document:=gen_random_uuid(); extraction:=gen_random_uuid(); job:=gen_random_uuid(); request_id:=gen_random_uuid();
    INSERT INTO auth.users(id,email) VALUES(actor,actor||'@example.test');
    -- Actual handle_new_user() creates one owned workspace. Preserve the owner
    -- floor with a separate synthetic custodian before demoting/deleting actor.
    IF (SELECT count(*) FROM public.workspace_members WHERE user_id=actor AND role='owner')<>1
      THEN RAISE EXCEPTION 'SEED_SIGNUP_WORKSPACE_SHAPE'; END IF;
    SELECT workspace_id INTO workspace FROM public.workspace_members WHERE user_id=actor AND role='owner';
    INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(workspace,custodian,'owner');
    UPDATE public.workspace_members SET role='member' WHERE workspace_id=workspace AND user_id=actor;
    UPDATE public.workspaces SET name='SYNTHETIC manual role tenant '||i WHERE id=workspace;
    INSERT INTO public.rtp_cycles(id,workspace_id,title) VALUES(cycle,workspace,'SYNTHETIC retained plan');
    INSERT INTO public.kb_documents(id,workspace_id,uploaded_by,title,source_kind,status,checksum,extraction_source,storage_ref)
      VALUES(document,workspace,actor,'SYNTHETIC retained source','uploaded_pdf','ready','synthetic-original-v1','text_layer',
        'storage://kb-documents/'||workspace||'/'||document||'/synthetic.pdf');
    INSERT INTO public.kb_ocr_jobs(id,workspace_id,document_id,request_id,requested_by,extraction_mode,source_checksum,status)
      VALUES(job,workspace,document,job::text,actor,'text','synthetic-original-v1','succeeded');
    pages:=jsonb_build_array(jsonb_build_object('page',1,'text',source_text));
    hash:=encode(extensions.digest(convert_to(pages::text,'UTF8'),'sha256'),'hex');
    INSERT INTO public.kb_document_extractions(id,workspace_id,document_id,job_id,document_checksum,pages_json,page_count,content_sha256,engine_json)
      VALUES(extraction,workspace,document,job,'synthetic-original-v1',pages,1,hash,'{"name":"synthetic role fixture"}');
    item:=jsonb_build_object('actor',actor,'workspace',workspace,'cycle',cycle,'document',document,'extraction',extraction,
      'job',job,'text',source_text,'hash',hash,'draft',gen_random_uuid(),'target',gen_random_uuid(),
      'proposal',jsonb_build_object('text',source_text),'request',jsonb_build_object('requestId',request_id,
        'kbDocumentId',document,'documentExtractionId',extraction,'sourcePage',1,'documentChecksum','synthetic-original-v1',
        'contentSha256',hash,'targetKind','chapter_block','quote',source_text,'fields',jsonb_build_object('text',source_text)));
    tenants:=tenants||jsonb_build_array(item);
  END LOOP;
  PERFORM set_config('rtp_native_followup.tenants',tenants::text,true);
END $seed$;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
DO $service$
DECLARE tenants jsonb:=current_setting('rtp_native_followup.tenants')::jsonb; item jsonb; result jsonb; replay jsonb;
BEGIN
  IF current_user<>'service_role' OR auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'ROLE_SERVICE_CONTEXT'; END IF;
  item:=tenants->0;
  BEGIN
    PERFORM public.stage_rtp_manual_source_proposal((item->>'cycle')::uuid,(item->>'workspace')::uuid,NULL,
      item->'request',item->>'text','text_layer',item->'proposal',item->>'text');
    RAISE EXCEPTION 'ROLE_NULL_ACTOR_ACCEPTED';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM<>'Plan write access revoked' THEN RAISE EXCEPTION 'ROLE_NULL_ACTOR_WRONG_REFUSAL: %',SQLERRM; END IF;
  END;
  IF EXISTS(SELECT 1 FROM public.rtp_extraction_runs WHERE workspace_id=(item->>'workspace')::uuid)
    OR EXISTS(SELECT 1 FROM public.rtp_extraction_candidates WHERE workspace_id=(item->>'workspace')::uuid)
    THEN RAISE EXCEPTION 'ROLE_NULL_ACTOR_PARTIAL_WRITE'; END IF;
  FOR i IN 0..1 LOOP
    item:=tenants->i;
    result:=public.stage_rtp_manual_source_proposal((item->>'cycle')::uuid,(item->>'workspace')::uuid,(item->>'actor')::uuid,
      item->'request',item->>'text','text_layer',item->'proposal',item->>'text');
    replay:=public.stage_rtp_manual_source_proposal((item->>'cycle')::uuid,(item->>'workspace')::uuid,(item->>'actor')::uuid,
      item->'request',item->>'text','text_layer',item->'proposal',item->>'text');
    IF result->>'runId' IS NULL OR result->>'candidateId' IS NULL OR result->>'deduped' IS DISTINCT FROM 'false'
      OR replay->>'runId' IS DISTINCT FROM result->>'runId' OR replay->>'candidateId' IS DISTINCT FROM result->>'candidateId'
      OR replay->>'deduped' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'ROLE_SERVICE_CALL_REPLAY tenant %',i; END IF;
    IF (SELECT count(*) FROM public.rtp_extraction_runs WHERE workspace_id=(item->>'workspace')::uuid)<>1
      OR (SELECT count(*) FROM public.rtp_extraction_candidates WHERE workspace_id=(item->>'workspace')::uuid)<>1
      THEN RAISE EXCEPTION 'ROLE_SERVICE_EXACT_CARDINALITY tenant %',i; END IF;
    item:=item||jsonb_build_object('run',result->>'runId','candidate',result->>'candidateId');
    tenants:=jsonb_set(tenants,ARRAY[i::text],item);
  END LOOP;
  PERFORM set_config('rtp_native_followup.tenants',tenants::text,true);
  RAISE NOTICE 'ROLE_SERVICE_CALL_REPLAY / ROLE_NULL_ACTOR: observed on this future run';
END $service$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
DO $member$
DECLARE tenants jsonb:=current_setting('rtp_native_followup.tenants')::jsonb; own jsonb; other jsonb; page jsonb;
  grounding jsonb; row_json jsonb; probe record; constraint_name text;
BEGIN
  IF current_user<>'authenticated' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls))
    THEN RAISE EXCEPTION 'ROLE_MEMBER_CONTEXT'; END IF;
  -- Each actor has exactly one membership, in a different synthetic workspace.
  FOR i IN 0..1 LOOP
    own:=tenants->i; other:=tenants->(1-i);
    PERFORM set_config('request.jwt.claim.sub',own->>'actor',true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',own->>'actor')::text,true);
    IF auth.uid() IS DISTINCT FROM (own->>'actor')::uuid THEN RAISE EXCEPTION 'ROLE_MEMBER_UID tenant %',i; END IF;
    page:=public.read_rtp_retained_source_page((own->>'cycle')::uuid,(own->>'document')::uuid,(own->>'extraction')::uuid,1);
    IF page->>'text' IS DISTINCT FROM own->>'text' OR page->>'extractionId' IS DISTINCT FROM own->>'extraction'
      OR page->>'contentSha256' IS DISTINCT FROM own->>'hash' THEN RAISE EXCEPTION 'ROLE_SAME_TENANT_READER tenant %',i; END IF;
    IF public.read_rtp_retained_source_page((other->>'cycle')::uuid,(other->>'document')::uuid,(other->>'extraction')::uuid,1) IS NOT NULL
      OR public.read_rtp_retained_source_page((own->>'cycle')::uuid,(other->>'document')::uuid,(other->>'extraction')::uuid,1) IS NOT NULL
      OR public.read_rtp_retained_source_page((own->>'cycle')::uuid,(own->>'document')::uuid,(other->>'extraction')::uuid,1) IS NOT NULL
      THEN RAISE EXCEPTION 'ROLE_CROSS_TENANT_READER tenant %',i; END IF;
    FOR probe IN
      SELECT 'cycle' label,count(*) FILTER(WHERE id=(own->>'cycle')::uuid) n,count(*) FILTER(WHERE id=(other->>'cycle')::uuid) foreign_n FROM public.rtp_cycles WHERE id IN ((own->>'cycle')::uuid,(other->>'cycle')::uuid)
      UNION ALL SELECT 'document',count(*) FILTER(WHERE id=(own->>'document')::uuid),count(*) FILTER(WHERE id=(other->>'document')::uuid) FROM public.kb_documents WHERE id IN ((own->>'document')::uuid,(other->>'document')::uuid)
      UNION ALL SELECT 'extraction',count(*) FILTER(WHERE id=(own->>'extraction')::uuid),count(*) FILTER(WHERE id=(other->>'extraction')::uuid) FROM public.kb_document_extractions WHERE id IN ((own->>'extraction')::uuid,(other->>'extraction')::uuid)
      UNION ALL SELECT 'job',count(*) FILTER(WHERE id=(own->>'job')::uuid),count(*) FILTER(WHERE id=(other->>'job')::uuid) FROM public.kb_ocr_jobs WHERE id IN ((own->>'job')::uuid,(other->>'job')::uuid)
      UNION ALL SELECT 'run',count(*) FILTER(WHERE id=(own->>'run')::uuid),count(*) FILTER(WHERE id=(other->>'run')::uuid) FROM public.rtp_extraction_runs WHERE id IN ((own->>'run')::uuid,(other->>'run')::uuid)
      UNION ALL SELECT 'candidate',count(*) FILTER(WHERE id=(own->>'candidate')::uuid),count(*) FILTER(WHERE id=(other->>'candidate')::uuid) FROM public.rtp_extraction_candidates WHERE id IN ((own->>'candidate')::uuid,(other->>'candidate')::uuid)
    LOOP
      IF probe.n<>1 OR probe.foreign_n<>0 THEN RAISE EXCEPTION 'ROLE_DIRECT_RLS tenant % table % own % foreign %',i,probe.label,probe.n,probe.foreign_n; END IF;
    END LOOP;
    BEGIN
      PERFORM public.stage_rtp_manual_source_proposal((own->>'cycle')::uuid,(own->>'workspace')::uuid,(own->>'actor')::uuid,
        own->'request',own->>'text','text_layer',own->'proposal',own->>'text');
      RAISE EXCEPTION 'ROLE_MEMBER_SINK_ACCEPTED';
    EXCEPTION WHEN insufficient_privilege THEN
      IF SQLERRM<>'permission denied for function stage_rtp_manual_source_proposal' THEN RAISE EXCEPTION 'ROLE_MEMBER_SINK_WRONG_REFUSAL: %',SQLERRM; END IF;
    END;
    grounding:=jsonb_build_object('mode','transcription','source_method','manual_retained_page','verbatim',true,
      'retained_source',jsonb_build_object('extractionId',own->>'extraction','checksum','synthetic-original-v1','contentSha256',own->>'hash'),
      'extraction_candidate_id',own->>'candidate','kb_document_id',own->>'document','document_title','SYNTHETIC retained source',
      'source_page',1,'source_quote',own->>'text','chunk_recheck','retained_page_matched',
      'grounded_sentence_count',0,'total_sentence_count',0,'note','SYNTHETIC database shape fixture, not an accepted draft.');
    -- target_id is deliberately polymorphic with no FK in the actual schema.
    -- The synthetic UUID here does not establish a real chapter/route relationship.
    INSERT INTO public.document_narrative_drafts(id,workspace_id,target_kind,target_id,section_key,draft_markdown,model,
      grounding_json,grounded_sentence_count,total_sentence_count,facts_hash,status,accepted_markdown,accepted_by,accepted_at,created_by,created_at)
      VALUES((own->>'draft')::uuid,(own->>'workspace')::uuid,'rtp_chapter',(own->>'target')::uuid,NULL,own->>'text',NULL,
        grounding,0,0,'SYNTHETIC-not-a-route-facts-hash','draft',NULL,NULL,NULL,(own->>'actor')::uuid,now());
    SELECT to_jsonb(d) INTO row_json FROM public.document_narrative_drafts d WHERE id=(own->>'draft')::uuid;
    IF row_json IS NULL OR row_json->'model' IS DISTINCT FROM 'null'::jsonb OR row_json->'grounding_json' IS DISTINCT FROM grounding
      THEN RAISE EXCEPTION 'DRAFT_MANUAL_NULL_MODEL_READBACK tenant %',i; END IF;
    -- Expose the actual row to a later separately authorized application-reader check.
    tenants:=jsonb_set(tenants,ARRAY[i::text,'draftRow'],row_json);
    BEGIN
      INSERT INTO public.document_narrative_drafts(workspace_id,target_kind,target_id,section_key,draft_markdown,model,
        grounding_json,grounded_sentence_count,total_sentence_count,facts_hash,created_by)
        VALUES((own->>'workspace')::uuid,'rtp_chapter',(own->>'target')::uuid,NULL,own->>'text',NULL,'{}',0,0,'SYNTHETIC',(own->>'actor')::uuid);
      RAISE EXCEPTION 'DRAFT_ORDINARY_NULL_MODEL_ACCEPTED';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS constraint_name=CONSTRAINT_NAME;
      IF constraint_name<>'manual_transcription_without_model' THEN RAISE EXCEPTION 'DRAFT_ORDINARY_WRONG_CHECK: %',constraint_name; END IF;
    END;
    BEGIN
      INSERT INTO public.document_narrative_drafts(workspace_id,target_kind,target_id,section_key,draft_markdown,model,
        grounding_json,grounded_sentence_count,total_sentence_count,facts_hash,created_by)
        VALUES((own->>'workspace')::uuid,'report_section',(own->>'target')::uuid,'summary',own->>'text',NULL,grounding,0,0,'SYNTHETIC',(own->>'actor')::uuid);
      RAISE EXCEPTION 'DRAFT_REPORT_NULL_MODEL_ACCEPTED';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS constraint_name=CONSTRAINT_NAME;
      IF constraint_name<>'manual_transcription_without_model' THEN RAISE EXCEPTION 'DRAFT_REPORT_WRONG_CHECK: %',constraint_name; END IF;
    END;
    -- A nonnull-model control uses the same required columns and valid section shape.
    INSERT INTO public.document_narrative_drafts(workspace_id,target_kind,target_id,section_key,draft_markdown,model,
      grounding_json,grounded_sentence_count,total_sentence_count,facts_hash,created_by)
      VALUES((own->>'workspace')::uuid,'report_section',(own->>'target')::uuid,'summary','SYNTHETIC model control','synthetic-test-model',
        '{}',0,0,'SYNTHETIC',(own->>'actor')::uuid);
  END LOOP;
  -- Both manual rows now exist; probe symmetric draft isolation by exact IDs.
  FOR i IN 0..1 LOOP
    own:=tenants->i; other:=tenants->(1-i);
    PERFORM set_config('request.jwt.claim.sub',own->>'actor',true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',own->>'actor')::text,true);
    IF (SELECT count(*) FROM public.document_narrative_drafts WHERE id=(own->>'draft')::uuid)<>1
      OR EXISTS(SELECT 1 FROM public.document_narrative_drafts WHERE id=(other->>'draft')::uuid)
      THEN RAISE EXCEPTION 'DRAFT_DIRECT_RLS tenant %',i; END IF;
  END LOOP;
  PERFORM set_config('rtp_native_followup.tenants',tenants::text,true);
  RAISE NOTICE 'ROLE_MEMBER_READER_RLS / ROLE_MEMBER_SINK / DRAFT_NULL_MODEL: observed on this future run';
END $member$;
RESET ROLE;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT set_config('request.jwt.claim.role', 'anon', true);
SELECT set_config('request.jwt.claim.sub', '', true);
DO $anonymous$
DECLARE own jsonb:=current_setting('rtp_native_followup.tenants')::jsonb->0;
BEGIN
  IF current_user<>'anon' OR auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'ROLE_ANON_CONTEXT'; END IF;
  BEGIN
    PERFORM public.stage_rtp_manual_source_proposal((own->>'cycle')::uuid,(own->>'workspace')::uuid,(own->>'actor')::uuid,
      own->'request',own->>'text','text_layer',own->'proposal',own->>'text');
    RAISE EXCEPTION 'ROLE_ANON_SINK_ACCEPTED';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM<>'permission denied for function stage_rtp_manual_source_proposal' THEN RAISE EXCEPTION 'ROLE_ANON_SINK_WRONG_REFUSAL: %',SQLERRM; END IF;
  END;
  BEGIN
    PERFORM public.read_rtp_retained_source_page((own->>'cycle')::uuid,(own->>'document')::uuid,(own->>'extraction')::uuid,1);
    RAISE EXCEPTION 'ROLE_ANON_READER_ACCEPTED';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM<>'permission denied for function read_rtp_retained_source_page' THEN RAISE EXCEPTION 'ROLE_ANON_READER_WRONG_REFUSAL: %',SQLERRM; END IF;
  END;
  BEGIN
    PERFORM id FROM public.rtp_extraction_runs WHERE id=(own->>'run')::uuid;
    RAISE EXCEPTION 'ROLE_ANON_DIRECT_READ_ACCEPTED';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM<>'permission denied for table rtp_extraction_runs' THEN RAISE EXCEPTION 'ROLE_ANON_DIRECT_READ_WRONG_REFUSAL: %',SQLERRM; END IF;
  END;
  RAISE NOTICE 'ROLE_ANON_SINK_READER_DIRECT: observed on this future run';
END $anonymous$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
SELECT set_config('request.jwt.claim.role', '', true);
SELECT set_config('request.jwt.claim.sub', '', true);
DO $delete_actor$
DECLARE tenants jsonb:=current_setting('rtp_native_followup.tenants')::jsonb; own jsonb:=tenants->0;
  before_run jsonb; before_candidate jsonb; after_row jsonb; before_extraction jsonb; before_job jsonb; before_document jsonb;
BEGIN
  IF current_user IS DISTINCT FROM current_setting('rtp_native_followup.initial_role') THEN RAISE EXCEPTION 'ROLE_ADMIN_NOT_RESTORED'; END IF;
  UPDATE public.rtp_extraction_candidates SET status='rejected',reviewed_by=(own->>'actor')::uuid,reviewed_at=now() WHERE id=(own->>'candidate')::uuid;
  SELECT to_jsonb(r) INTO before_run FROM public.rtp_extraction_runs r WHERE id=(own->>'run')::uuid;
  SELECT to_jsonb(c) INTO before_candidate FROM public.rtp_extraction_candidates c WHERE id=(own->>'candidate')::uuid;
  SELECT to_jsonb(e) INTO before_extraction FROM public.kb_document_extractions e WHERE id=(own->>'extraction')::uuid;
  SELECT to_jsonb(j) INTO before_job FROM public.kb_ocr_jobs j WHERE id=(own->>'job')::uuid;
  SELECT to_jsonb(d) INTO before_document FROM public.kb_documents d WHERE id=(own->>'document')::uuid;
  DELETE FROM auth.users WHERE id=(own->>'actor')::uuid;
  IF EXISTS(SELECT 1 FROM auth.users WHERE id=(own->>'actor')::uuid)
    OR EXISTS(SELECT 1 FROM public.workspace_members WHERE user_id=(own->>'actor')::uuid)
    THEN RAISE EXCEPTION 'ACTOR_DELETE_NOT_APPLIED'; END IF;
  SELECT to_jsonb(r) INTO after_row FROM public.rtp_extraction_runs r WHERE id=(own->>'run')::uuid;
  IF after_row IS NULL OR after_row->'created_by' IS DISTINCT FROM 'null'::jsonb
    OR (after_row-'created_by') IS DISTINCT FROM (before_run-'created_by') THEN RAISE EXCEPTION 'ACTOR_DELETE_RUN_CUSTODY'; END IF;
  SELECT to_jsonb(c) INTO after_row FROM public.rtp_extraction_candidates c WHERE id=(own->>'candidate')::uuid;
  IF after_row IS NULL OR after_row->'reviewed_by' IS DISTINCT FROM 'null'::jsonb
    OR (after_row-'reviewed_by') IS DISTINCT FROM (before_candidate-'reviewed_by') THEN RAISE EXCEPTION 'ACTOR_DELETE_CANDIDATE_CUSTODY'; END IF;
  SELECT to_jsonb(e) INTO after_row FROM public.kb_document_extractions e WHERE id=(own->>'extraction')::uuid;
  IF after_row IS DISTINCT FROM before_extraction THEN RAISE EXCEPTION 'ACTOR_DELETE_PAGE_CUSTODY'; END IF;
  SELECT to_jsonb(j) INTO after_row FROM public.kb_ocr_jobs j WHERE id=(own->>'job')::uuid;
  IF after_row IS NULL OR after_row->'requested_by' IS DISTINCT FROM 'null'::jsonb
    OR (after_row-ARRAY['requested_by','updated_at']) IS DISTINCT FROM (before_job-ARRAY['requested_by','updated_at'])
    THEN RAISE EXCEPTION 'ACTOR_DELETE_JOB_CUSTODY'; END IF;
  SELECT to_jsonb(d) INTO after_row FROM public.document_narrative_drafts d WHERE id=(own->>'draft')::uuid;
  IF after_row IS NULL OR after_row->'created_by' IS DISTINCT FROM 'null'::jsonb
    OR (after_row-'created_by') IS DISTINCT FROM ((own->'draftRow')-'created_by') THEN RAISE EXCEPTION 'ACTOR_DELETE_DRAFT_CUSTODY'; END IF;
  SELECT to_jsonb(d) INTO after_row FROM public.kb_documents d WHERE id=(own->>'document')::uuid;
  IF after_row IS NULL OR after_row->'uploaded_by' IS DISTINCT FROM 'null'::jsonb
    OR (after_row-ARRAY['uploaded_by','updated_at']) IS DISTINCT FROM (before_document-ARRAY['uploaded_by','updated_at'])
    THEN RAISE EXCEPTION 'ACTOR_DELETE_DOCUMENT_CUSTODY'; END IF;
  -- Permit FK nulling, but never rebinding a retained run to a different user.
  BEGIN
    UPDATE public.rtp_extraction_runs SET created_by=(tenants->1->>'actor')::uuid WHERE id=(own->>'run')::uuid;
    RAISE EXCEPTION 'ACTOR_REBIND_ACCEPTED';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM<>'Manual source actor cannot be rebound' THEN RAISE EXCEPTION 'ACTOR_REBIND_WRONG_REFUSAL: %',SQLERRM; END IF;
  END;
  RAISE NOTICE 'ACTOR_DELETE_SET_NULL_CUSTODY / ACTOR_REBIND: observed on this future run';
END $delete_actor$;
-- Optional later reader bridge: capture the two pre-deletion database row JSON
-- values from this SELECT without treating SQL as application-reader evidence.
SELECT 'RTP_MANUAL_DRAFT:' || (value->'draftRow')::text AS manual_draft_row_for_separate_reader_check
  FROM jsonb_array_elements(current_setting('rtp_native_followup.tenants')::jsonb);
ROLLBACK;
