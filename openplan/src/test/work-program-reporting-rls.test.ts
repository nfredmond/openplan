import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
const live = LIVE_RLS ? describe : describe.skip;
const migration = readFileSync("supabase/migrations/20260910000001_work_program_actuals.sql", "utf8");
const actualFunction = migration.slice(migration.indexOf("CREATE FUNCTION public.record_work_program_actual"), migration.indexOf("REVOKE ALL ON FUNCTION public.record_work_program_actual")).replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION");
live("OWP operational actuals and frozen reporting", () => {
 let container: string;
 beforeAll(() => {
  if (!process.env.CI && !process.env.OPENPLAN_SUPABASE_WORKDIR) throw new Error("An explicitly identified disposable Supabase workdir is required");
  container = resolveLocalDbContainer();
 });
 function exercise(body: string, replacement = "") {
  return execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], input: `BEGIN; ${replacement}
  DO $test$ DECLARE
  o uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); foreign_user uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); staff uuid:=gen_random_uuid(); element uuid:=gen_random_uuid(); task uuid:=gen_random_uuid();
  r public.program_work_program_revisions; c jsonb; result jsonb; result2 jsonb; entry uuid:=gen_random_uuid(); period_id uuid:=gen_random_uuid(); rate_id uuid:=gen_random_uuid(); report_id uuid; before_hash text;
  BEGIN
   INSERT INTO auth.users(id,email) VALUES(o,o||'@example.test'),(m,m||'@example.test'),(foreign_user,foreign_user||'@example.test');
   INSERT INTO public.workspaces(id,name,slug) VALUES(w,'Synthetic OWP actuals',w::text);
   INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(w,o,'owner'),(w,m,'member');
   INSERT INTO public.programs(id,workspace_id,title,program_type,cycle_name) VALUES(p,w,'Synthetic reporting, no real agency costs','other','Test');
   INSERT INTO public.invoicing_staff(id,workspace_id,name,user_id) VALUES(staff,w,'Synthetic staff',m);
   SELECT * INTO r FROM public.save_program_work_program_revision(p,o,0,gen_random_uuid(),jsonb_build_object('schemaVersion',1,'agency','Synthetic agency','periodStart','2026-07-01','periodEnd','2027-06-30','elements',jsonb_build_array(jsonb_build_object('id',element,'projectId',NULL,'tasks',jsonb_build_array(jsonb_build_object('id',task))))));
   c:=jsonb_build_object('requestId',gen_random_uuid(),'entryId',entry,'expectedVersion',0,'revisionId',r.id,'kind','labor','status','draft','entryDate','2026-08-01','sourceKey','synthetic-source-1','sourceReference','Synthetic payroll reference','description','Synthetic time, not actual agency spending','staffId',staff,'projectId',NULL,'contractId',NULL,'hours','1.00','amount',NULL,'basis','unvalued','allocations',jsonb_build_array(jsonb_build_object('elementId',element,'taskId',task,'share',10000)));
   ${body}
  END $test$;
  SELECT 'OWP_REPORT_ASSERTIONS_REACHED'; ROLLBACK;` });
 }
 const marker = (body: string, replacement = "") => expect(exercise(body, replacement)).toContain("OWP_REPORT_ASSERTIONS_REACHED");
 const save = "result:=public.record_work_program_actual(p,m,c);";
 const approve = `c:=c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',1,'amount','12.35','basis','recorded','status','approved','correctionNote','Payroll reconciled'); result:=public.record_work_program_actual(p,o,c);`;
 const period = `INSERT INTO public.program_work_program_events(program_id,workspace_id,sequence,revision_id,revision_hash,kind,actor_id,payload,evidence,request_id) VALUES(p,w,1,r.id,r.content_sha256,'adoption',o,'{}','[]',gen_random_uuid());
 c:=jsonb_build_object('kind','period','requestId',gen_random_uuid(),'periodId',period_id,'expectedVersion',0,'name','Synthetic August','startsOn','2026-08-01','endsOn','2026-08-31','baselineId',r.id,'sourceCutoff',now(),'progress','[]'::jsonb);
 result:=public.work_program_management_command(p,o,c);`;
 it("records agency time, exact retries, version corrections and private rate valuation", () => marker(`${save}
 result2:=public.record_work_program_actual(p,m,c);
 IF result<>result2 OR (SELECT count(*) FROM public.invoicing_time_entries WHERE work_program_id=p)<>1 THEN RAISE EXCEPTION 'Retry duplicated time'; END IF;
 BEGIN PERFORM public.record_work_program_actual(p,m,c||'{"hours":"2.00"}'); RAISE EXCEPTION 'Changed retry accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 PERFORM public.work_program_management_command(p,o,jsonb_build_object('kind','rate','requestId',gen_random_uuid(),'rateId',rate_id,'staffId',staff,'startsOn','2026-07-01','endsOn','2026-12-31','hourlyCost','12.35','sourceReference','Synthetic approved cost rate'));
 c:=c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',1,'status','approved','basis','cost_rate','rateId',rate_id,'hours','1.01','correctionNote','Synthetic approval');
 result:=public.record_work_program_actual(p,o,c);
 IF (SELECT amount FROM public.work_program_actual_versions WHERE entry_id=entry AND version=2)<>12.47 THEN RAISE EXCEPTION 'Cost valuation is not exact'; END IF;
 IF (SELECT hours FROM public.work_program_actual_versions WHERE entry_id=entry AND version=1)<>1 THEN RAISE EXCEPTION 'Original valuation changed'; END IF;
 BEGIN PERFORM public.record_work_program_actual(p,m,c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',2,'status','draft','basis','unvalued','amount',NULL)); RAISE EXCEPTION 'Member changed approved time'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 `));
 it("refuses foreign roles, bad task allocation, missing rates, duplicate sources and unbalanced splits", () => marker(`
 BEGIN PERFORM public.record_work_program_actual(p,foreign_user,c); RAISE EXCEPTION 'Foreign actor accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.record_work_program_actual(p,m,c||jsonb_build_object('staffId',gen_random_uuid())); RAISE EXCEPTION 'Foreign staff accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.record_work_program_actual(p,o,c||jsonb_build_object('allocations',jsonb_build_array(jsonb_build_object('elementId',element,'taskId',gen_random_uuid(),'share',10000)))); RAISE EXCEPTION 'Foreign task accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.record_work_program_actual(p,o,c||'{"status":"approved","basis":"cost_rate"}'); RAISE EXCEPTION 'Missing rate accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.record_work_program_actual(p,o,c||jsonb_build_object('allocations',jsonb_build_array(jsonb_build_object('elementId',element,'share',3333)))); RAISE EXCEPTION 'Unbalanced split accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 ${save}
 BEGIN PERFORM public.record_work_program_actual(p,o,c||jsonb_build_object('requestId',gen_random_uuid(),'entryId',gen_random_uuid())); RAISE EXCEPTION 'Duplicate source accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 `));
 it("preserves exact split totals and requires payroll overlap reconciliation", () => marker(`${save}
 c:=c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',1,'amount','0.01','basis','recorded','status','approved','correctionNote','Split penny','allocations',jsonb_build_array(jsonb_build_object('elementId',element,'share',3333),jsonb_build_object('elementId',element,'taskId',task,'share',6667)));
 result:=public.record_work_program_actual(p,o,c);
 IF (SELECT sum(a.amount) FROM public.work_program_actual_allocations a JOIN public.work_program_actual_versions v ON v.id=a.actual_version_id WHERE v.entry_id=entry AND v.version=2)<>0.01 THEN RAISE EXCEPTION 'Split cents lost'; END IF;
 BEGIN PERFORM public.record_work_program_actual(p,o,c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',0,'entryId',gen_random_uuid(),'sourceKey','unmatched-payroll')); RAISE EXCEPTION 'Unmatched payroll double counted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 `));
 it("freezes reviewed history, issues correction versions and refuses edits to issued periods", () => marker(`${save}${approve}${period}
 PERFORM public.work_program_management_command(p,o,jsonb_build_object('kind','review','requestId',gen_random_uuid(),'periodId',period_id,'expectedVersion',1,'note','Reviewed source reconciliation'));
 result:=public.work_program_management_command(p,o,jsonb_build_object('kind','issue','requestId',gen_random_uuid(),'periodId',period_id,'expectedVersion',2,'note','Internal synthetic issue'));
 report_id:=(result->>'reportId')::uuid;
 SELECT snapshot_hash INTO before_hash FROM public.work_program_period_reports WHERE id=report_id;
 BEGIN PERFORM public.work_program_management_command(p,o,c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',3,'name','Rewrite issued period')); RAISE EXCEPTION 'Issued period edited'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 PERFORM public.work_program_management_command(p,o,jsonb_build_object('kind','correct','requestId',gen_random_uuid(),'periodId',period_id,'expectedVersion',3,'note','Correct synthetic cost'));
 PERFORM public.work_program_management_command(p,o,jsonb_build_object('kind','review','requestId',gen_random_uuid(),'periodId',period_id,'expectedVersion',4,'note','Review corrected version'));
 result:=public.work_program_management_command(p,o,jsonb_build_object('kind','issue','requestId',gen_random_uuid(),'periodId',period_id,'expectedVersion',5,'note','Corrected internal issue'));
 IF (SELECT snapshot_hash FROM public.work_program_period_reports WHERE id=report_id)<>before_hash OR (SELECT corrects_report_id FROM public.work_program_period_reports WHERE id=(result->>'reportId')::uuid)<>report_id THEN RAISE EXCEPTION 'Issued history overwritten'; END IF;
 `));
 it("denies private rates, actuals, report documents and source edits through direct authenticated SQL", () => marker(`${save}${approve}${period}
 PERFORM public.work_program_management_command(p,o,jsonb_build_object('kind','review','requestId',gen_random_uuid(),'periodId',period_id,'expectedVersion',1,'note','Review'));
 result:=public.work_program_management_command(p,o,jsonb_build_object('kind','issue','requestId',gen_random_uuid(),'periodId',period_id,'expectedVersion',2,'note','Issue'));
 PERFORM public.enqueue_work_program_report((result->>'reportId')::uuid,'pdf',o);
 PERFORM set_config('request.jwt.claim.sub',m::text,true); EXECUTE 'SET LOCAL ROLE authenticated';
 IF EXISTS(SELECT 1 FROM public.work_program_actual_versions WHERE program_id=p) OR EXISTS(SELECT 1 FROM public.work_program_period_reports WHERE program_id=p) OR EXISTS(SELECT 1 FROM public.kb_documents WHERE work_program_report_id=(result->>'reportId')::uuid) THEN RAISE EXCEPTION 'Private cost records leaked'; END IF;
 BEGIN UPDATE public.invoicing_time_entries SET hours=3 WHERE work_program_id=p; IF FOUND THEN RAISE EXCEPTION 'Direct source correction allowed'; END IF; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.record_work_program_actual(p,o,c); RAISE EXCEPTION 'Actor spoof RPC allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 EXECUTE 'RESET ROLE';
 `));
 it("requires an adopted baseline and resolved actuals for review", () => marker(`${save}
 c:=jsonb_build_object('kind','period','requestId',gen_random_uuid(),'periodId',period_id,'expectedVersion',0,'name','Draft','startsOn','2026-08-01','endsOn','2026-08-31','baselineId',NULL,'sourceCutoff',now(),'progress','[]'::jsonb);
 PERFORM public.work_program_management_command(p,o,c);
 BEGIN PERFORM public.work_program_management_command(p,o,jsonb_build_object('kind','review','requestId',gen_random_uuid(),'periodId',period_id,'expectedVersion',1,'note','Review')); RAISE EXCEPTION 'Unadopted report reviewed'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 `));
 it("aggregates every actual beyond the REST page cap", () => marker(`
 FOR n IN 1..1101 LOOP
  PERFORM public.record_work_program_actual(p,o,c||jsonb_build_object('requestId',gen_random_uuid(),'entryId',gen_random_uuid(),'sourceKey','synthetic-expense-'||n,'kind','expense','staffId',NULL,'hours',NULL,'amount','0.01','basis','recorded','status','approved'));
 END LOOP;
 ${period}
 PERFORM public.work_program_management_command(p,o,jsonb_build_object('kind','review','requestId',gen_random_uuid(),'periodId',period_id,'expectedVersion',1,'note','Review complete source population'));
 IF (SELECT jsonb_array_length(review_snapshot->'actuals') FROM public.work_program_reporting_periods WHERE id=period_id)<>1101 THEN RAISE EXCEPTION 'Report truncated actuals'; END IF;
 IF (SELECT sum((v->>'amount')::numeric) FROM public.work_program_reporting_periods x CROSS JOIN LATERAL jsonb_array_elements(x.review_snapshot->'actuals') v WHERE x.id=period_id)<>11.01 THEN RAISE EXCEPTION 'Large ledger total incorrect'; END IF;
 `));
 it("refuses overlapping opening costs and preserves departed staff history", () => marker(`
 c:=c||jsonb_build_object('kind','opening','entryDate','2026-07-31','staffId',NULL,'hours','100.00','amount','1000.00','basis','recorded','status','approved','openingBasis','Synthetic July accounting total','openingStart','2026-07-01','openingEnd','2026-07-31');
 PERFORM public.record_work_program_actual(p,o,c);
 PERFORM public.record_work_program_actual(p,o,c||jsonb_build_object('requestId',gen_random_uuid(),'entryId',gen_random_uuid(),'sourceKey','overlapping-detail','kind','expense','hours',NULL,'entryDate','2026-07-15','amount','10.00'));
 ${period}
 BEGIN PERFORM public.work_program_management_command(p,o,jsonb_build_object('kind','review','requestId',gen_random_uuid(),'periodId',period_id,'expectedVersion',1,'note','Review')); RAISE EXCEPTION 'Opening coverage double counted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 UPDATE public.invoicing_staff SET active=false WHERE id=staff;
 c:=jsonb_build_object('requestId',gen_random_uuid(),'entryId',gen_random_uuid(),'expectedVersion',0,'revisionId',r.id,'kind','labor','status','approved','entryDate','2026-08-02','sourceKey','departed-staff','sourceReference','Historical time','description','Synthetic departed staff work','staffId',staff,'hours','1.00','amount','1.00','basis','recorded','allocations',jsonb_build_array(jsonb_build_object('elementId',element,'taskId',task,'share',10000)));
 PERFORM public.record_work_program_actual(p,o,c);
 IF NOT EXISTS(SELECT 1 FROM public.work_program_actual_versions WHERE staff_id=staff AND status='approved') THEN RAISE EXCEPTION 'Departed staff history lost'; END IF;
 BEGIN PERFORM public.record_work_program_actual(p,m,c||jsonb_build_object('requestId',gen_random_uuid(),'entryId',gen_random_uuid(),'sourceKey','inactive-member-time','status','draft','basis','unvalued','amount',NULL)); RAISE EXCEPTION 'Inactive staff entered new time'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 `));
 it("populated private tables deny members and foreign actors, including allocations and rates", () => marker(`${save}${approve}${period}
 PERFORM public.work_program_management_command(p,o,jsonb_build_object('kind','rate','requestId',gen_random_uuid(),'rateId',rate_id,'staffId',staff,'startsOn','2026-07-01','endsOn','2026-12-31','hourlyCost','12.35','sourceReference','Synthetic approved cost rate'));
 IF NOT EXISTS(SELECT 1 FROM public.work_program_cost_rates WHERE id=rate_id) OR NOT EXISTS(SELECT 1 FROM public.work_program_actual_allocations a JOIN public.work_program_actual_versions v ON v.id=a.actual_version_id WHERE v.program_id=p) THEN RAISE EXCEPTION 'Private fixtures missing'; END IF;
 PERFORM set_config('request.jwt.claim.sub',m::text,true); EXECUTE 'SET LOCAL ROLE authenticated';
 IF EXISTS(SELECT 1 FROM public.work_program_cost_rates WHERE id=rate_id) OR EXISTS(SELECT 1 FROM public.work_program_reporting_periods WHERE id=period_id) OR EXISTS(SELECT 1 FROM public.work_program_actual_allocations) THEN RAISE EXCEPTION 'Private management detail leaked'; END IF;
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claim.sub',foreign_user::text,true); EXECUTE 'SET LOCAL ROLE authenticated';
 IF EXISTS(SELECT 1 FROM public.work_program_actual_versions WHERE program_id=p) OR EXISTS(SELECT 1 FROM public.work_program_cost_rates WHERE id=rate_id) OR EXISTS(SELECT 1 FROM public.work_program_reporting_periods WHERE id=period_id) THEN RAISE EXCEPTION 'Foreign private rows leaked'; END IF;
 EXECUTE 'RESET ROLE';
 `));

 const storageBody = `${save}${approve}${period}
 PERFORM public.work_program_management_command(p,o,jsonb_build_object('kind','review','requestId',gen_random_uuid(),'periodId',period_id,'expectedVersion',1,'note','Review'));
 result:=public.work_program_management_command(p,o,jsonb_build_object('kind','issue','requestId',gen_random_uuid(),'periodId',period_id,'expectedVersion',2,'note','Issue'));
 report_id:=(result->>'reportId')::uuid;
 SELECT to_jsonb(j) INTO result FROM public.enqueue_work_program_report(report_id,'pdf',o) j;
 UPDATE public.kb_ocr_jobs SET status='failed',failure_detail='Synthetic interrupted worker' WHERE id=(result->>'id')::uuid;
 SELECT to_jsonb(j) INTO result2 FROM public.enqueue_work_program_report(report_id,'pdf',o) j;
 IF result->>'id'<>result2->>'id' OR result2->>'status'<>'queued' THEN RAISE EXCEPTION 'Worker retry duplicated the issued artifact'; END IF;
 UPDATE public.kb_ocr_jobs SET status='running',lease_token=rate_id,lease_until=now()+interval '1 minute' WHERE id=(result->>'id')::uuid;
 BEGIN PERFORM public.finish_work_program_export((result->>'id')::uuid,gen_random_uuid(),repeat('a',64),10,'invalid','synthetic'); RAISE EXCEPTION 'Stale worker lease accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 BEGIN INSERT INTO public.kb_document_chunks(document_id,workspace_id,chunk_index,content) VALUES((result->>'document_id')::uuid,w,0,'PRIVATE synthetic payroll'); RAISE EXCEPTION 'Private report indexed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 -- A rollback-only permissive control proves the restrictive rule, even if deployment storage access is broadened.
 CREATE POLICY owp_storage_test_control ON storage.objects FOR ALL TO authenticated USING(bucket_id='kb-documents');
 INSERT INTO storage.objects(bucket_id,name) VALUES('kb-documents',w||'/'||(result->>'document_id')||'/synthetic.pdf');
 PERFORM set_config('request.jwt.claim.sub',m::text,true); PERFORM set_config('request.jwt.claim.role','authenticated',true); EXECUTE 'SET LOCAL ROLE authenticated';
 IF EXISTS(SELECT 1 FROM storage.objects WHERE name=w||'/'||(result->>'document_id')||'/synthetic.pdf') THEN RAISE EXCEPTION 'Member storage read leaked'; END IF;
 EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claim.sub',o::text,true); EXECUTE 'SET LOCAL ROLE authenticated';
 IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE name=w||'/'||(result->>'document_id')||'/synthetic.pdf') THEN RAISE EXCEPTION 'Owner positive storage control missing'; END IF;
 BEGIN UPDATE storage.objects SET metadata='{"synthetic":"changed"}' WHERE name=w||'/'||(result->>'document_id')||'/synthetic.pdf'; RAISE EXCEPTION 'Issued storage changed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN DELETE FROM storage.objects WHERE name=w||'/'||(result->>'document_id')||'/synthetic.pdf'; RAISE EXCEPTION 'Issued storage deleted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.kb_documents SET work_program_report_id=NULL,work_program_report_format=NULL WHERE id=(result->>'document_id')::uuid; IF FOUND THEN RAISE EXCEPTION 'Private identity removed'; END IF; EXCEPTION WHEN check_violation THEN NULL; END;
 EXECUTE 'RESET ROLE';
 `;
 it("retains worker retry identity, rejects stale leases, shared indexing and private storage deletion", () => marker(storageBody));

 it("rejects cross-project contracts and deliverables, then maps existing time and spending once", () => marker(`
 INSERT INTO public.projects(id,workspace_id,name) VALUES(period_id,w,'Synthetic linked project');
 INSERT INTO public.invoicing_clients(id,workspace_id,name) VALUES(rate_id,w,'Synthetic client');
 INSERT INTO public.invoicing_engagements(id,workspace_id,client_id,project_id,title) VALUES(entry,w,rate_id,period_id,'Synthetic contract');
 INSERT INTO public.project_deliverables(id,project_id,title) VALUES(rate_id,period_id,'Synthetic deliverable');
 BEGIN PERFORM public.record_work_program_actual(p,o,c||jsonb_build_object('projectId',period_id)); RAISE EXCEPTION 'Cross-project element accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.record_work_program_actual(p,o,c||jsonb_build_object('contractId',entry)); RAISE EXCEPTION 'Cross-project contract accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.record_work_program_actual(p,o,c||jsonb_build_object('allocations',jsonb_build_array(jsonb_build_object('elementId',element,'deliverableId',rate_id,'share',10000)))); RAISE EXCEPTION 'Cross-project deliverable accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 SELECT * INTO r FROM public.save_program_work_program_revision(p,o,1,gen_random_uuid(),jsonb_set(r.content_json,'{elements,0,projectId}',to_jsonb(period_id)));
 INSERT INTO public.invoicing_time_entries(id,workspace_id,staff_id,engagement_id,entry_date,hours,notes,billable,created_by) VALUES(rate_id,w,staff,entry,'2026-08-01',1,'Synthetic existing source',false,o);
 c:=c||jsonb_build_object('revisionId',r.id,'projectId',period_id,'contractId',entry,'timeEntryId',rate_id,'status','approved','amount','10.00','basis','recorded');
 PERFORM public.record_work_program_actual(p,o,c);
 IF (SELECT count(*) FROM public.invoicing_time_entries WHERE staff_id=staff)<>1 THEN RAISE EXCEPTION 'Mapping duplicated existing time'; END IF;
 BEGIN PERFORM public.record_work_program_actual(p,o,c||jsonb_build_object('requestId',gen_random_uuid(),'entryId',gen_random_uuid(),'sourceKey','same-time-different-key','reconciliationNote','Synthetic duplicate')); RAISE EXCEPTION 'Time remapped as another cost'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 INSERT INTO public.project_spend_entries(id,project_id,entry_date,amount,description,created_by) VALUES(rate_id,period_id,'2026-08-01',10,'Synthetic existing spend',o);
 c:=c||jsonb_build_object('requestId',gen_random_uuid(),'entryId',gen_random_uuid(),'kind','expense','staffId',NULL,'hours',NULL,'timeEntryId',NULL,'spendEntryId',rate_id,'sourceKey','synthetic-existing-spend');
 PERFORM public.record_work_program_actual(p,o,c);
 IF (SELECT count(*) FROM public.project_spend_entries WHERE project_id=period_id)<>1 THEN RAISE EXCEPTION 'Mapping duplicated existing spending'; END IF;
 `));

 it("proves private indexing and storage guards can reject real writes", () => {
  const sql = readFileSync("supabase/migrations/20260910000003_work_program_report_exports.sql", "utf8");
  const functionSource = (name: string) => sql.slice(sql.indexOf(`CREATE FUNCTION public.${name}`), sql.indexOf("END $$;", sql.indexOf(`CREATE FUNCTION public.${name}`)) + 7).replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION");
  marker(storageBody, functionSource("guard_management_storage").replace("retained Documents worker custody", "retained worker custody"));
  expect(() => exercise(storageBody, functionSource("refuse_management_indexing").replace("IF EXISTS(SELECT", "IF false AND EXISTS(SELECT"))).toThrow(/Private report indexed/);
  expect(() => exercise(storageBody, functionSource("guard_management_storage").replace("IF auth.role()='authenticated'", "IF false"))).toThrow(/Issued storage changed/);
 });
 it("proves a harmless control survives while source deduplication and member approval mutations fail", () => {
  const body = `${save} BEGIN PERFORM public.record_work_program_actual(p,o,c||jsonb_build_object('requestId',gen_random_uuid(),'entryId',gen_random_uuid())); RAISE EXCEPTION 'Duplicate source accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;`;
  marker(body, actualFunction.replace('Actuals access denied', 'Actual access denied'));
  expect(() => exercise(body, actualFunction.replace("v.workspace_id=w AND v.source_key=p_command->>'sourceKey'", "false AND v.source_key=p_command->>'sourceKey'"))).toThrow(/Duplicate source accepted/);
  const memberBody = `BEGIN PERFORM public.record_work_program_actual(p,m,c||'{"amount":"10.00","basis":"recorded","status":"approved"}'); RAISE EXCEPTION 'Member approved private costs'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;`;
  marker(memberBody);
  expect(() => exercise(memberBody, actualFunction.replace("IF actor_role='member' AND", "IF false AND"))).toThrow(/Member approved private costs/);
 });
});
