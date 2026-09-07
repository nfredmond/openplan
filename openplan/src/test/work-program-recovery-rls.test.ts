import {randomUUID} from "node:crypto";
import {execFileSync} from "node:child_process";
import {beforeAll,describe,expect,it} from "vitest";
import {LIVE_RLS} from "./local-supabase-env";
import {resolveLocalDbContainer} from "./helpers/live-catalog";
const live=LIVE_RLS?describe:describe.skip;
live("Documents and OWP recovery transactions",()=>{
  let container:string;
  beforeAll(()=>{container=resolveLocalDbContainer();});
  function exercise(body:string) {
    const ids=Object.fromEntries(["owner","member","viewer","outsider","workspace","program","document"].map(key=>[key,randomUUID()]));
    const sql=`BEGIN;
      INSERT INTO auth.users(id,email) VALUES ('@owner','@owner@example.test'),('@member','@member@example.test'),('@viewer','@viewer@example.test'),('@outsider','@outsider@example.test');
      INSERT INTO public.workspaces(id,name,slug) VALUES ('@workspace','Synthetic recovery test','@workspace');
      INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES ('@workspace','@owner','owner'),('@workspace','@member','member'),('@workspace','@viewer','viewer');
      INSERT INTO public.programs(id,workspace_id,title,program_type,cycle_name) VALUES ('@program','@workspace','Synthetic proposal','other','Exercise only');
      INSERT INTO public.kb_documents(id,workspace_id,title,source_kind,checksum,storage_ref,status) VALUES ('@document','@workspace','Synthetic original','uploaded_pdf',repeat('a',64),'storage://kb-documents/@workspace/@document/source.pdf','stored');
      ${body}
      SELECT 'RECOVERY_ASSERTIONS_REACHED';ROLLBACK;`.replace(/@(owner|member|viewer|outsider|workspace|program|document)/g,(_,key)=>ids[key]);
    const output=execFileSync("docker",["exec","-i",container,"psql","-X","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1","-At"],{input:sql,encoding:"utf8",stdio:["pipe","pipe","pipe"]});
    expect(output).toContain("RECOVERY_ASSERTIONS_REACHED");
  }
  it("recovers legacy jobs, deduplicates accepted requests and refuses changed identity",()=>exercise(`
    DO $$ DECLARE old public.kb_ocr_jobs; j public.kb_ocr_jobs; again public.kb_ocr_jobs; BEGIN
      INSERT INTO public.kb_ocr_jobs(workspace_id,document_id,request_id,requested_by) VALUES('@workspace','@document','legacy','@owner') RETURNING * INTO old;
      SELECT * INTO j FROM public.enqueue_kb_extraction('@document','@member','new-request','text',ARRAY['eng'],'http://local/callback');
      IF j.id=old.id OR j.source_checksum<>repeat('a',64) OR j.dispatch_callback_url<>'http://local/callback' OR (SELECT status FROM public.kb_ocr_jobs WHERE id=old.id)<>'failed' THEN RAISE EXCEPTION 'Legacy job not recovered'; END IF;
      SELECT * INTO again FROM public.enqueue_kb_extraction('@document','@member','new-request','text',ARRAY['eng'],'http://local/callback');
      IF j.id<>again.id THEN RAISE EXCEPTION 'Request duplicated'; END IF;
      BEGIN PERFORM public.enqueue_kb_extraction('@document','@member','new-request','ocr',ARRAY['eng'],'http://local/callback'); RAISE EXCEPTION 'Changed retry accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
      BEGIN PERFORM public.enqueue_kb_extraction('@document','@viewer','viewer-request','text',ARRAY['eng'],'http://local/callback'); RAISE EXCEPTION 'Viewer queued extraction'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN PERFORM public.enqueue_kb_extraction('@document','@outsider','outsider-request','text',ARRAY['eng'],'http://local/callback'); RAISE EXCEPTION 'Outsider queued extraction'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END $$;`));
  const callback=`jsonb_build_object('requestId','read','callbackId','callback-one','jobReference','worker-one','status','succeeded','occurredAt',now(),'pageCount',2,'pages','[{"page":1,"text":"New text"},{"page":2,"text":""}]'::jsonb)`;
  const chunk=`jsonb_build_array(jsonb_build_object('document_id','@document','workspace_id','@workspace','chunk_index',0,'page_from',1,'page_to',1,'char_start',0,'char_end',8,'content','New text','token_estimate',2))`;
  it("commits blank pages and receipt together and rejects a changed callback",()=>exercise(`
    SELECT public.enqueue_kb_extraction('@document','@owner','read','text',ARRAY['eng'],'http://local/callback');
    DO $$ DECLARE cb jsonb := ${callback}; result jsonb; original_hash text; BEGIN
      result:=public.apply_kb_extraction_callback(cb,${chunk},500);
      SELECT content_sha256 INTO original_hash FROM public.kb_document_extractions WHERE document_id='@document';
      IF (SELECT jsonb_array_length(pages_json) FROM public.kb_document_extractions WHERE document_id='@document')<>2 OR (SELECT status FROM public.kb_documents WHERE id='@document')<>'ready' THEN RAISE EXCEPTION 'Pages or indexing lost'; END IF;
      result:=public.apply_kb_extraction_callback(cb,${chunk},500);
      IF NOT (result->>'deduped')::boolean OR (SELECT count(*) FROM public.kb_document_extractions WHERE document_id='@document')<>1 THEN RAISE EXCEPTION 'Callback duplicated'; END IF;
      BEGIN PERFORM public.apply_kb_extraction_callback(cb||'{"message":"changed"}',${chunk},500); RAISE EXCEPTION 'Changed callback accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
      IF (SELECT content_sha256 FROM public.kb_document_extractions WHERE document_id='@document')<>original_hash THEN RAISE EXCEPTION 'Historical pages changed'; END IF;
    END $$;`));
  it("retains new complete pages when a legacy partial search index conflicts",()=>exercise(`
    INSERT INTO public.kb_document_chunks(document_id,workspace_id,chunk_index,page_from,page_to,char_start,char_end,content,token_estimate) VALUES('@document','@workspace',0,1,1,0,8,'Old text',2);
    SELECT public.enqueue_kb_extraction('@document','@owner','read','text',ARRAY['eng'],'http://local/callback');
    SELECT public.apply_kb_extraction_callback(${callback},${chunk},500);
    DO $$ BEGIN
      IF (SELECT count(*) FROM public.kb_document_extractions WHERE document_id='@document')<>1 OR (SELECT content FROM public.kb_document_chunks WHERE document_id='@document')<>'Old text' OR (SELECT status FROM public.kb_documents WHERE id='@document')<>'failed' OR (SELECT message FROM public.kb_ocr_jobs WHERE request_id='read') NOT LIKE '%index differs%' THEN RAISE EXCEPTION 'Partial-index conflict lost retained extraction'; END IF;
    END $$;`));
  it("denies revoked callbacks and cross-workspace chunks without recording a receipt",()=>exercise(`
    SELECT public.enqueue_kb_extraction('@document','@member','read','text',ARRAY['eng'],'http://local/callback');
    DO $$ BEGIN
      BEGIN PERFORM public.apply_kb_extraction_callback(${callback},jsonb_set(${chunk},'{0,workspace_id}',to_jsonb(gen_random_uuid()::text)),500); RAISE EXCEPTION 'Foreign chunks accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END $$;
    DELETE FROM public.workspace_members WHERE workspace_id='@workspace' AND user_id='@member';
    DO $$ BEGIN
      BEGIN PERFORM public.apply_kb_extraction_callback(${callback},${chunk},500); RAISE EXCEPTION 'Revoked callback applied'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      IF EXISTS(SELECT 1 FROM public.kb_document_extractions WHERE document_id='@document') OR EXISTS(SELECT 1 FROM public.kb_ocr_job_callbacks WHERE callback_id='callback-one') THEN RAISE EXCEPTION 'Rejected callback left partial custody'; END IF;
    END $$;`));
  it("isolates extraction versions and denies direct mutation",()=>exercise(`
    SELECT public.enqueue_kb_extraction('@document','@owner','read','text',ARRAY['eng'],'http://local/callback');
    SELECT public.apply_kb_extraction_callback(${callback},${chunk},500);
    SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub','@viewer',true);
    DO $$ BEGIN IF (SELECT count(*) FROM public.kb_document_extractions WHERE document_id='@document')<>1 THEN RAISE EXCEPTION 'Viewer could not inspect pages'; END IF;
      BEGIN UPDATE public.kb_document_extractions SET pages_json='[]'; RAISE EXCEPTION 'Direct page edit allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN PERFORM public.enqueue_kb_extraction('@document','@owner','spoofed','text',ARRAY['eng'],'http://local/callback'); RAISE EXCEPTION 'Actor spoof allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END $$;
    SELECT set_config('request.jwt.claim.sub','@outsider',true);
    DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.kb_document_extractions WHERE document_id='@document') THEN RAISE EXCEPTION 'Foreign pages visible'; END IF; END $$; RESET ROLE;`));
  it("resumes expired export leases and retains one immutable artifact per revision and format",()=>exercise(`
    SELECT public.save_program_work_program_revision('@program','@owner',0,gen_random_uuid(),'{"schemaVersion":1,"elements":[]}');
    DO $$ DECLARE j public.kb_ocr_jobs; second public.kb_ocr_jobs; token uuid:=gen_random_uuid(); oldtoken uuid:=gen_random_uuid(); path text; BEGIN
      SELECT * INTO j FROM public.enqueue_work_program_export('@program',1,'pdf','@viewer');
      SELECT * INTO second FROM public.enqueue_work_program_export('@program',1,'pdf','@owner');
      IF j.id<>second.id THEN RAISE EXCEPTION 'Export retry duplicated artifact'; END IF;
      SELECT * INTO j FROM public.claim_work_program_export(oldtoken);
      UPDATE public.kb_ocr_jobs SET lease_until=now()-interval '1 second' WHERE id=j.id;
      SELECT * INTO second FROM public.claim_work_program_export(token);
      IF second.id<>j.id THEN RAISE EXCEPTION 'Expired rendering not recovered'; END IF;
      path:='storage://kb-documents/@workspace/'||j.document_id||'/'||repeat('b',64)||'.pdf';
      BEGIN PERFORM public.finish_work_program_export(j.id,oldtoken,repeat('b',64),123,path,'synthetic'); RAISE EXCEPTION 'Expired worker finalized'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
      PERFORM public.finish_work_program_export(j.id,token,repeat('b',64),123,path,'synthetic');
      IF (SELECT checksum FROM public.kb_documents WHERE id=j.document_id)<>repeat('b',64) OR (SELECT status FROM public.kb_ocr_jobs WHERE id=j.id)<>'succeeded' THEN RAISE EXCEPTION 'Artifact not retained'; END IF;
      BEGIN UPDATE public.kb_documents SET checksum=repeat('c',64) WHERE id=j.document_id; RAISE EXCEPTION 'Artifact checksum changed'; EXCEPTION WHEN check_violation THEN NULL; END;
      BEGIN DELETE FROM public.kb_documents WHERE id=j.document_id; RAISE EXCEPTION 'Artifact deleted'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
      BEGIN PERFORM public.enqueue_work_program_export('@program',1,'pdf','@outsider'); RAISE EXCEPTION 'Foreign export queued'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END $$;`));
  it("cancels only an accessible active extraction and preserves its original",()=>exercise(`
    DO $$ DECLARE j public.kb_ocr_jobs; BEGIN
      SELECT * INTO j FROM public.enqueue_kb_extraction('@document','@owner','cancel-test','text',ARRAY['eng'],'http://local/callback');
      BEGIN PERFORM public.cancel_kb_extraction('@document',j.id,'@viewer'); RAISE EXCEPTION 'Viewer cancelled'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN PERFORM public.cancel_kb_extraction('@document',j.id,'@outsider'); RAISE EXCEPTION 'Outsider cancelled'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      IF public.cancel_kb_extraction('@document',gen_random_uuid(),'@owner') THEN RAISE EXCEPTION 'Foreign job cancelled'; END IF;
      IF NOT public.cancel_kb_extraction('@document',j.id,'@member') THEN RAISE EXCEPTION 'Member cancellation lost'; END IF;
      IF NOT public.cancel_kb_extraction('@document',j.id,'@owner') THEN RAISE EXCEPTION 'Owner retry lost'; END IF;
      IF NOT (SELECT cancel_requested FROM public.kb_ocr_jobs WHERE id=j.id) OR (SELECT checksum FROM public.kb_documents WHERE id='@document')<>repeat('a',64) THEN RAISE EXCEPTION 'Cancellation changed original'; END IF;
      UPDATE public.kb_ocr_jobs SET status='succeeded' WHERE id=j.id;
      IF public.cancel_kb_extraction('@document',j.id,'@owner') THEN RAISE EXCEPTION 'Terminal job cancelled'; END IF;
      UPDATE public.kb_ocr_jobs SET status='queued',job_kind='work_program_export' WHERE id=j.id;
      IF public.cancel_kb_extraction('@document',j.id,'@owner') THEN RAISE EXCEPTION 'Export cancelled through extraction RPC'; END IF;
      DELETE FROM public.workspace_members WHERE workspace_id='@workspace' AND user_id='@member';
      BEGIN PERFORM public.cancel_kb_extraction('@document',j.id,'@member'); RAISE EXCEPTION 'Revoked member cancelled'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END $$;`));

});
