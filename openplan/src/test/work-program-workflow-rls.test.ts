import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
const live = LIVE_RLS ? describe : describe.skip;
const migration = readFileSync("supabase/migrations/20260909000001_work_program_review.sql", "utf8");
const rpc = migration.slice(migration.indexOf("CREATE FUNCTION public.record_work_program_event"), migration.indexOf("REVOKE ALL ON FUNCTION public.record_work_program_event")).replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION");
live("OWP review transactional custody", () => {
  let container: string;
  beforeAll(() => { container = resolveLocalDbContainer(); });
  const run = (sql: string) => execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  function exercise(body: string, replacement = "") {
    const tag = randomUUID();
    return run(`BEGIN; ${replacement}
    CREATE FUNCTION pg_temp.command(k text, p uuid, r uuid, note text DEFAULT 'Synthetic engineering exercise, no agency decision') RETURNS jsonb LANGUAGE sql AS $c$
      SELECT jsonb_build_object('requestId',gen_random_uuid(),'expectedSequence',coalesce((SELECT sequence FROM public.program_work_program_workflow WHERE program_id=p),0),'expectedRevision',(SELECT max(revision) FROM public.program_work_program_revisions WHERE program_id=p),'revisionId',r,'revisionHash',(SELECT content_sha256 FROM public.program_work_program_revisions WHERE id=r),'kind',k,'note',note,'visibility','internal','reviewerIds','[]'::jsonb,'documentIds','[]'::jsonb,'dueOn',NULL,'evidenceDate',NULL,'authority','','scope','','targetEventId',NULL)
    $c$;
    DO $test$ DECLARE
      owner_id uuid:=gen_random_uuid(); reviewer_id uuid:=gen_random_uuid(); outsider_id uuid:=gen_random_uuid(); viewer_id uuid:=gen_random_uuid();
      workspace_id uuid:=gen_random_uuid(); program_id uuid:=gen_random_uuid(); doc uuid:=gen_random_uuid();
      r public.program_work_program_revisions; r2 public.program_work_program_revisions; e public.program_work_program_events; e2 public.program_work_program_events;
      c jsonb; saved_c jsonb; state public.program_work_program_workflow; j public.kb_ocr_jobs; pkt public.program_work_program_packets;
    BEGIN
      INSERT INTO auth.users(id,email) VALUES(owner_id,owner_id||'@example.test'),(reviewer_id,reviewer_id||'@example.test'),(outsider_id,outsider_id||'@example.test'),(viewer_id,viewer_id||'@example.test');
      INSERT INTO public.workspaces(id,name,slug) VALUES(workspace_id,'Synthetic review test ${tag}',workspace_id::text);
      INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(workspace_id,owner_id,'owner'),(workspace_id,reviewer_id,'member'),(workspace_id,viewer_id,'viewer');
      INSERT INTO public.programs(id,workspace_id,title,program_type,cycle_name) VALUES(program_id,workspace_id,'Synthetic OWP review','other','Exercise');
      INSERT INTO public.kb_documents(id,workspace_id,title,source_kind,checksum,page_count,status,storage_ref,byte_size) VALUES(doc,workspace_id,'Synthetic decision fixture, not a signature','uploaded_pdf',repeat('a',64),1,'stored','storage://kb-documents/synthetic',100);
      SELECT * INTO r FROM public.save_program_work_program_revision(program_id,owner_id,0,gen_random_uuid(),'{"schemaVersion":1,"elements":[],"agency":"Synthetic review"}');
      ${body}
    END $test$;
    SELECT 'OWP_REVIEW_ASSERTIONS_REACHED'; ROLLBACK;`);
  }
  const submit = `c:=pg_temp.command('submit',program_id,r.id)||jsonb_build_object('reviewerIds',jsonb_build_array(reviewer_id)); saved_c:=c; SELECT * INTO e FROM public.record_work_program_event(program_id,owner_id,c);`;
  const approve = `SELECT * INTO e FROM public.record_work_program_event(program_id,reviewer_id,pg_temp.command('approve',program_id,r.id));`;
  const adopt = `c:=pg_temp.command('adoption',program_id,r.id)||jsonb_build_object('authority','Synthetic board','scope','Engineering exercise only','evidenceDate',current_date,'documentIds',jsonb_build_array(doc)); SELECT * INTO e FROM public.record_work_program_event(program_id,owner_id,c);`;
  const marker = (body: string, replacement = "") => expect(exercise(body, replacement)).toContain("OWP_REVIEW_ASSERTIONS_REACHED");
  it("keeps review separate from adoption, retains exact retries and amendment identities", () => marker(`${submit}
    IF (SELECT count(*) FROM public.program_work_program_reviews v WHERE v.program_id=r.program_id AND due_on IS NULL AND status='pending')<>1 THEN RAISE EXCEPTION 'Undated assignment missing'; END IF;
    SELECT * INTO e2 FROM public.record_work_program_event(program_id,owner_id,saved_c);
    IF e2.id<>e.id THEN RAISE EXCEPTION 'Retry duplicated submission'; END IF;
    BEGIN PERFORM public.record_work_program_event(program_id,owner_id,saved_c||'{"note":"changed"}'); RAISE EXCEPTION 'Changed retry allowed'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
    ${approve}
    IF (SELECT effective_revision_id FROM public.program_work_program_workflow s WHERE s.program_id=r.program_id) IS NOT NULL THEN RAISE EXCEPTION 'Internal approval became adoption'; END IF;
    ${adopt}
    PERFORM public.record_work_program_event(program_id,owner_id,pg_temp.command('start_amendment',program_id,r.id));
    SELECT * INTO r2 FROM public.program_work_program_revisions WHERE program_work_program_revisions.program_id=r.program_id ORDER BY revision DESC LIMIT 1;
    IF r2.id=r.id OR r2.content_json<>r.content_json OR r2.amendment_baseline_id<>r.id OR r2.source_ids IS DISTINCT FROM r.source_ids THEN RAISE EXCEPTION 'Amendment lost baseline content or identities'; END IF;
    PERFORM public.record_work_program_event(program_id,owner_id,pg_temp.command('external_acceptance',program_id,r.id)||jsonb_build_object('authority','Synthetic external agency','scope','Original adopted baseline only','evidenceDate',current_date,'documentIds',jsonb_build_array(doc)));
    SELECT * INTO r2 FROM public.save_program_work_program_revision(program_id,owner_id,2,gen_random_uuid(),r2.content_json||'{"budget":999}');
    IF (SELECT effective_revision_id FROM public.program_work_program_workflow s WHERE s.program_id=r.program_id)<>r.id THEN RAISE EXCEPTION 'Pending budget replaced baseline'; END IF;
    BEGIN PERFORM public.record_work_program_event(program_id,owner_id,pg_temp.command('spending_authorization',program_id,r2.id)||jsonb_build_object('authority','Synthetic','scope','Test','evidenceDate',current_date,'documentIds',jsonb_build_array(doc))); RAISE EXCEPTION 'Old adoption authorized changed content'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  `));
  it("returns, revises and resubmits without inheriting old approval or duplicating assignments", () => marker(`${submit}
    SELECT * INTO e FROM public.record_work_program_event(program_id,reviewer_id,pg_temp.command('return',program_id,r.id));
    SELECT * INTO r2 FROM public.save_program_work_program_revision(program_id,owner_id,1,gen_random_uuid(),r.content_json||'{"agency":"Revised synthetic"}');
    BEGIN PERFORM public.record_work_program_event(program_id,reviewer_id,pg_temp.command('approve',program_id,r.id)); RAISE EXCEPTION 'Stale reviewer decision accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
    PERFORM public.record_work_program_event(program_id,owner_id,pg_temp.command('submit',program_id,r2.id)||jsonb_build_object('reviewerIds',jsonb_build_array(reviewer_id)));
    IF (SELECT count(*) FROM public.program_work_program_reviews v WHERE v.program_id=r.program_id AND status='pending')<>1 THEN RAISE EXCEPTION 'Duplicate live review work'; END IF;
  `));
  it("refuses self approval, foreign references, revoked actors, missing authority and stale sequence", () => marker(`
    BEGIN PERFORM public.record_work_program_event(program_id,owner_id,pg_temp.command('submit',program_id,r.id)||jsonb_build_object('reviewerIds',jsonb_build_array(owner_id))); RAISE EXCEPTION 'Self reviewer accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM public.record_work_program_event(program_id,owner_id,pg_temp.command('comment',program_id,r.id)||jsonb_build_object('documentIds',jsonb_build_array(gen_random_uuid()))); RAISE EXCEPTION 'Foreign document accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM public.record_work_program_event(program_id,owner_id,pg_temp.command('comment',program_id,r.id)||jsonb_build_object('revisionId',gen_random_uuid())); RAISE EXCEPTION 'Foreign revision accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM public.record_work_program_event(program_id,owner_id,pg_temp.command('comment',program_id,r.id)||'{"expectedSequence":8}'); RAISE EXCEPTION 'Stale sequence accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
    ${submit}
    BEGIN PERFORM public.record_work_program_event(program_id,owner_id,pg_temp.command('adoption',program_id,r.id)); RAISE EXCEPTION 'Missing authority accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
    UPDATE public.workspace_members m SET role='owner' WHERE m.user_id=reviewer_id AND m.workspace_id=r.workspace_id;
    DELETE FROM public.workspace_members m WHERE m.user_id=owner_id AND m.workspace_id=r.workspace_id;
    BEGIN PERFORM public.record_work_program_event(program_id,owner_id,saved_c); RAISE EXCEPTION 'Revoked retry accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  `));
  it("keeps comments unresolved until the author resolves them and blocks new unresolved adoption", () => marker(`${submit}
    SELECT * INTO e2 FROM public.record_work_program_event(program_id,reviewer_id,pg_temp.command('comment',program_id,r.id));
    BEGIN PERFORM public.record_work_program_event(program_id,reviewer_id,pg_temp.command('approve',program_id,r.id)); RAISE EXCEPTION 'Unresolved approval allowed'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
    PERFORM public.record_work_program_event(program_id,reviewer_id,pg_temp.command('resolve_comment',program_id,r.id)||jsonb_build_object('targetEventId',e2.id));
    ${approve}
    PERFORM public.record_work_program_event(program_id,reviewer_id,pg_temp.command('comment',program_id,r.id));
    c:=pg_temp.command('adoption',program_id,r.id)||jsonb_build_object('authority','Synthetic','scope','Test','evidenceDate',current_date,'documentIds',jsonb_build_array(doc));
    BEGIN PERFORM public.record_work_program_event(program_id,owner_id,c); RAISE EXCEPTION 'Unresolved adoption allowed'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  `));
  it("isolates metadata, denies direct writes and protects retained evidence", () => marker(`${submit} ${approve} ${adopt}
    PERFORM set_config('request.jwt.claim.sub',owner_id::text,true); SET LOCAL ROLE authenticated;
    IF (SELECT count(*) FROM public.program_work_program_events)>0 THEN NULL; ELSE RAISE EXCEPTION 'Member event read failed'; END IF;
    BEGIN UPDATE public.program_work_program_events SET kind='adoption'; RAISE EXCEPTION 'Direct mutation allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM public.record_work_program_event(program_id,owner_id,'{}'); RAISE EXCEPTION 'Actor spoof RPC allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RESET ROLE; PERFORM set_config('request.jwt.claim.sub',outsider_id::text,true); SET LOCAL ROLE authenticated;
    IF EXISTS(SELECT 1 FROM public.program_work_program_events) OR EXISTS(SELECT 1 FROM public.program_work_program_workflow) OR EXISTS(SELECT 1 FROM public.program_work_program_reviews) OR EXISTS(SELECT 1 FROM public.program_work_program_packets) THEN RAISE EXCEPTION 'Foreign review metadata leaked'; END IF;
    RESET ROLE;
    BEGIN UPDATE public.kb_documents SET checksum=repeat('b',64) WHERE id=doc; RAISE EXCEPTION 'Evidence changed'; EXCEPTION WHEN check_violation THEN NULL; END;
    BEGIN DELETE FROM public.kb_documents WHERE id=doc; RAISE EXCEPTION 'Evidence deleted'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  `));
  it("freezes public and internal copies separately, recovers jobs and denies unreviewed public copies", () => marker(`${submit}
    PERFORM public.record_work_program_event(program_id,reviewer_id,pg_temp.command('comment',program_id,r.id,'INTERNAL SENTINEL'));
    SELECT * INTO state FROM public.program_work_program_workflow s WHERE s.program_id=r.program_id;
    BEGIN PERFORM public.enqueue_work_program_packet(program_id,1,state.sequence,'public',false,'html',owner_id); RAISE EXCEPTION 'Unreviewed public copy accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    SELECT * INTO j FROM public.enqueue_work_program_packet(program_id,1,state.sequence,'public',true,'html',owner_id);
    SELECT * INTO pkt FROM public.program_work_program_packets WHERE id=(SELECT work_program_packet_id FROM public.kb_documents WHERE id=j.document_id);
    IF pkt.snapshot::text LIKE '%INTERNAL SENTINEL%' THEN RAISE EXCEPTION 'Internal note leaked'; END IF;
    IF (SELECT id FROM public.enqueue_work_program_packet(program_id,1,state.sequence,'public',true,'html',owner_id))<>j.id THEN RAISE EXCEPTION 'Retry duplicated job'; END IF;
    SELECT * INTO j FROM public.enqueue_work_program_packet(program_id,1,state.sequence,'internal',false,'xlsx',owner_id);
    SELECT * INTO pkt FROM public.program_work_program_packets WHERE id=(SELECT work_program_packet_id FROM public.kb_documents WHERE id=j.document_id);
    IF pkt.snapshot::text NOT LIKE '%INTERNAL SENTINEL%' THEN RAISE EXCEPTION 'Internal record omitted'; END IF;
  `));
  it("mutation harness admits harmless edits and kills removed expected-sequence and independent-review guards", () => {
    const stale = `BEGIN PERFORM public.record_work_program_event(program_id,owner_id,pg_temp.command('comment',program_id,r.id)||'{"expectedSequence":8}'); RAISE EXCEPTION 'Stale sequence accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;`;
    marker(stale, rpc.replace('Workflow or revision changed; reload','Workflow state changed; reload'));
    expect(() => exercise(stale, rpc.replace("s.sequence<>(p_command->>'expectedSequence')::integer OR ", ""))).toThrow(/Stale sequence accepted/);
    const self = `BEGIN PERFORM public.record_work_program_event(program_id,owner_id,pg_temp.command('submit',program_id,r.id)||jsonb_build_object('reviewerIds',jsonb_build_array(owner_id))); RAISE EXCEPTION 'Self reviewer accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;`;
    expect(() => exercise(self, rpc.replace('reviewer=r.created_by OR reviewer=p_actor_id OR ',''))).toThrow(/Self reviewer accepted/);
  });
});
