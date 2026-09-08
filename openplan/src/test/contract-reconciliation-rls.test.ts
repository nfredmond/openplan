import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
const setup = readFileSync("src/test/fixtures/contracts/setup.sql", "utf8");
const saveBaseline = `result:=public.record_contract_command(engagement,owner_id,c); PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','approve','requestId',gen_random_uuid(),'baselineId',baseline,'expectedVersion',1,'approvalEvidence','Synthetic written authorization, no real authority'));`;
const time = `c:=jsonb_build_object('kind','actual','requestId',gen_random_uuid(),'entryId',entry,'expectedVersion',0,'sourceKey','synthetic-time','sourceReference','Synthetic timesheet','entryDate','2026-09-01','category','labor','status','draft','description','Synthetic draft effort','staffId',staff,'hours','1.01','amount',NULL,'valuationBasis','unvalued','rateId',NULL,'billable',true,'allocations',jsonb_build_array(jsonb_build_object('taskId',task,'deliverableId',deliverable,'share',3333),jsonb_build_object('taskId',task2,'deliverableId',deliverable,'share',6667)),'correctionNote','','openingBasis','','reconciliationNote','');`;
const approve = `c:=c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',1,'status','approved','amount','12.47','valuationBasis','recorded','correctionNote','Synthetic reviewed valuation'); PERFORM public.record_contract_command(engagement,owner_id,c);`;
function exercise(body: string, replacement = "") {
 if (!process.env.CI && !process.env.OPENPLAN_SUPABASE_WORKDIR?.includes("contract-verification")) throw new Error("Explicit isolated contract-verification stack required");
 return execFileSync("docker", ["exec", "-i", resolveLocalDbContainer(), "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], { encoding: "utf8", input: `BEGIN;${process.env.OPENPLAN_CONTRACT_TEST_SQL ? readFileSync(process.env.OPENPLAN_CONTRACT_TEST_SQL,"utf8") : ""}${replacement}\n${setup.replace("-- TEST_BODY",body)} SELECT 'CONTRACT_ASSERTIONS_REACHED';ROLLBACK;`, stdio: ["pipe","pipe","pipe"] });
}
const marker = (body: string, replacement = "") => expect(exercise(body,replacement)).toContain("CONTRACT_ASSERTIONS_REACHED");
(LIVE_RLS ? describe : describe.skip)("contract database custody", () => {
 it("retains proposals, approved baselines, exact retries and private member time", () => marker(`${saveBaseline}
 again:=public.record_contract_command(engagement,owner_id,c); IF again<>result THEN RAISE EXCEPTION 'Retry changed baseline'; END IF;
 ${time} result:=public.record_contract_command(engagement,member_id,c); again:=public.record_contract_command(engagement,member_id,c);
 IF result<>again OR (SELECT count(*) FROM public.invoicing_time_entries WHERE engagement_id=engagement)<>1 THEN RAISE EXCEPTION 'Retry duplicated time'; END IF;
 ${approve}
 state:=public.read_contract_management(engagement,member_id);
 IF state->'actuals'->1->>'amount' IS NOT NULL OR state::text LIKE '%12.47%' OR state::text LIKE '%500.00%' THEN RAISE EXCEPTION 'Private cost leaked'; END IF;
 IF (SELECT sum((a->>'amount')::numeric) FROM public.contract_actual_versions v CROSS JOIN LATERAL jsonb_array_elements(v.allocations) a WHERE v.entry_id=entry AND version=2)<>12.47 THEN RAISE EXCEPTION 'Split cents lost'; END IF;
 IF (SELECT count(*) FROM public.contract_actual_versions WHERE entry_id=entry)<>2 THEN RAISE EXCEPTION 'History overwritten'; END IF;
 `));
 it("rejects foreign projects, unauthorized approval, missing rates and source duplicates", () => marker(`
 BEGIN PERFORM public.record_contract_command(engagement,member_id,c); RAISE EXCEPTION 'Member approved baseline'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 ${saveBaseline}${time}
 BEGIN INSERT INTO public.invoicing_time_entries(workspace_id,staff_id,engagement_id,deliverable_id,entry_date,hours) VALUES(workspace,staff,engagement,foreign_deliverable,'2026-09-01',1); RAISE EXCEPTION 'Foreign project accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN PERFORM public.record_contract_command(engagement,outsider,c); RAISE EXCEPTION 'Outsider entered time'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c||'{"status":"approved","valuationBasis":"cost_rate"}'); RAISE EXCEPTION 'Missing rate accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 PERFORM public.record_contract_command(engagement,member_id,c);
 BEGIN PERFORM public.record_contract_command(engagement,member_id,c||jsonb_build_object('requestId',gen_random_uuid(),'entryId',gen_random_uuid())); RAISE EXCEPTION 'Duplicate source accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 ${approve}
 BEGIN PERFORM public.record_contract_command(engagement,member_id,c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',2,'status','draft','valuationBasis','unvalued','amount',NULL)); RAISE EXCEPTION 'Member changed approved actual'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 `));
 it("bills split sources once using effective billing rates and gross retention", () => marker(`${saveBaseline}${time}
 PERFORM public.record_contract_command(engagement,member_id,c); ${approve}
 PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','rate','requestId',gen_random_uuid(),'rateId',billing_rate,'staffId',staff,'basis','billing','startsOn','2026-01-01','endsOn','2026-12-31','hourlyRate','100.00','sourceReference','Synthetic approved billing schedule'));
 c:=jsonb_build_object('kind','bill','requestId',gen_random_uuid(),'invoiceNumber','SYNTH-1','invoiceDate','2026-09-01','retentionPercent','10.00','entryIds',jsonb_build_array(entry));
 result:=public.record_contract_command(engagement,owner_id,c); invoice:=(result->>'invoiceId')::uuid;
 IF result->>'gross'<>'101.00' OR result->>'net'<>'90.90' THEN RAISE EXCEPTION 'Billing rate or retention wrong'; END IF;
 IF (SELECT count(*) FROM public.client_invoice_line_items WHERE invoice_id=invoice)<>2 THEN RAISE EXCEPTION 'Split attribution collapsed'; END IF;
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c||jsonb_build_object('requestId',gen_random_uuid(),'invoiceNumber','SYNTH-2')); RAISE EXCEPTION 'Duplicate billing accepted'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 IF (SELECT count(*) FROM public.client_invoices WHERE engagement_id=engagement)<>1 THEN RAISE EXCEPTION 'Failed billing left orphan invoice'; END IF;
 `));
 it("rejects currency relabeling, contradictory allocations and changed project parents",()=>marker(`${saveBaseline}
 BEGIN UPDATE public.invoicing_engagements SET project_id=other_project WHERE id=engagement; RAISE EXCEPTION 'Retained project changed'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c||jsonb_build_object('requestId',gen_random_uuid(),'baselineId',gen_random_uuid(),'expectedVersion',1,'content',(c->'content')||'{"currency":"EUR"}')); RAISE EXCEPTION 'Currency relabeled'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.validate_contract_budget((c->'content')||'{"fee":"1.00"}'); RAISE EXCEPTION 'Contradictory budget approved'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 `));
 it("retains snapshot identities and private Documents access, with more than 1000 records",()=>marker(`${saveBaseline}${time}
 PERFORM public.record_contract_command(engagement,member_id,c);${approve}
 INSERT INTO public.contract_actual_versions(entry_id,engagement_id,workspace_id,version,source_key,command,amount,hours,allocations,created_by)
 SELECT gen_random_uuid(),engagement,workspace,1,'synthetic-bulk-'||i,c||jsonb_build_object('sourceKey','synthetic-bulk-'||i,'category','expense'),0.01,NULL,jsonb_build_array(jsonb_build_object('taskId',task,'deliverableId',deliverable,'share',10000,'amount','0.01','hours',NULL)),owner_id FROM generate_series(1,1101) i;
 state:=public.read_contract_management(engagement,owner_id);
 IF jsonb_array_length(state->'actuals')<>1103 THEN RAISE EXCEPTION 'Source pagination lost rows'; END IF;
 result:=public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','snapshot','requestId',gen_random_uuid(),'title','Synthetic snapshot','asOf','2026-09-01','sourceCutoff',now(),'coverageComplete',false,'coverageEvidence','Synthetic fixture coverage'));
 report:=(result->>'snapshotId')::uuid;
 SELECT snapshot_hash INTO original_hash FROM public.contract_snapshots WHERE id=report;
 PERFORM public.enqueue_contract_snapshot(report,'pdf',owner_id);
 BEGIN UPDATE public.contract_snapshots SET title='Changed' WHERE id=report; RAISE EXCEPTION 'Issued history edited'; EXCEPTION WHEN check_violation THEN NULL; END;
 PERFORM set_config('request.jwt.claim.sub',member_id::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 IF EXISTS(SELECT 1 FROM public.contract_actual_versions WHERE engagement_id=engagement) OR EXISTS(SELECT 1 FROM public.contract_snapshots WHERE id=report) OR EXISTS(SELECT 1 FROM public.kb_documents WHERE contract_snapshot_id=report) THEN RAISE EXCEPTION 'Private management records leaked'; END IF;
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c);RAISE EXCEPTION 'Actor spoof accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 EXECUTE 'RESET ROLE';
 `));
 it("preserves effective rates and rejects changed retries, foreign tasks and missing opening evidence",()=>marker(`${saveBaseline}${time}
 PERFORM public.record_contract_command(engagement,member_id,c);
 BEGIN PERFORM public.record_contract_command(engagement,member_id,c||'{"hours":"2.00"}');RAISE EXCEPTION 'Changed retry accepted';EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c||jsonb_build_object('requestId',gen_random_uuid(),'entryId',gen_random_uuid(),'sourceKey','foreign-task','allocations',jsonb_build_array(jsonb_build_object('taskId',gen_random_uuid(),'deliverableId',deliverable,'share',10000))));RAISE EXCEPTION 'Foreign task accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c||jsonb_build_object('requestId',gen_random_uuid(),'entryId',gen_random_uuid(),'sourceKey','opening','category','opening'));RAISE EXCEPTION 'Undocumented opening accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','rate','requestId',gen_random_uuid(),'rateId',cost_rate,'staffId',staff,'basis','cost','startsOn','2026-01-01','endsOn','2026-12-31','hourlyRate','12.35','sourceReference','Synthetic rate'));
 c:=c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',1,'status','approved','valuationBasis','cost_rate','rateId',cost_rate,'correctionNote','Synthetic review');PERFORM public.record_contract_command(engagement,owner_id,c);
 IF (SELECT amount FROM public.contract_actual_versions WHERE entry_id=entry AND version=2)<>12.47 THEN RAISE EXCEPTION 'Effective cost rate wrong';END IF;
 `));

 it("retains agreement bytes and historical staff and deliverable identities",()=>marker(`${saveBaseline}
 IF (SELECT source_receipts->0->>'checksum' FROM public.contract_baselines WHERE id=baseline)<>repeat('a',64) THEN RAISE EXCEPTION 'Original checksum lost';END IF;
 BEGIN DELETE FROM public.kb_documents WHERE id=document;RAISE EXCEPTION 'Agreement deleted';EXCEPTION WHEN foreign_key_violation THEN NULL;END;
 BEGIN UPDATE public.kb_documents SET checksum=repeat('b',64) WHERE id=document;RAISE EXCEPTION 'Agreement replaced';EXCEPTION WHEN check_violation THEN NULL;END;
 BEGIN INSERT INTO storage.objects(bucket_id,name) VALUES('kb-documents',workspace||'/'||document||'/synthetic.pdf');RAISE EXCEPTION 'Agreement bytes replaced';EXCEPTION WHEN check_violation THEN NULL;END;
 BEGIN UPDATE public.invoicing_staff SET user_id=owner_id WHERE id=staff;RAISE EXCEPTION 'Staff identity reassigned';EXCEPTION WHEN check_violation THEN NULL;END;
 UPDATE public.invoicing_staff SET active=false WHERE id=staff;
 ${time} BEGIN PERFORM public.record_contract_command(engagement,member_id,c);RAISE EXCEPTION 'Departed member entered time';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 UPDATE public.contract_tasks SET deliverable_id=NULL WHERE engagement_id=engagement;
 BEGIN UPDATE public.project_deliverables SET project_id=other_project WHERE id=deliverable;RAISE EXCEPTION 'Historical deliverable moved';EXCEPTION WHEN check_violation THEN NULL;END;
 BEGIN DELETE FROM public.project_deliverables WHERE id=deliverable;RAISE EXCEPTION 'Historical deliverable deleted';EXCEPTION WHEN check_violation THEN NULL;END;
 `));
 it("keeps issued billing lines immutable and cash separate from cost",()=>marker(`${saveBaseline}${time}
 PERFORM public.record_contract_command(engagement,member_id,c);${approve}
 PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','rate','requestId',gen_random_uuid(),'rateId',billing_rate,'staffId',staff,'basis','billing','startsOn','2026-01-01','endsOn','2026-12-31','hourlyRate','100.00','sourceReference','Synthetic billing rate'));
 result:=public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','bill','requestId',gen_random_uuid(),'invoiceNumber','SYNTH-CASH','invoiceDate','2026-09-01','retentionPercent','10.00','entryIds',jsonb_build_array(entry)));invoice:=(result->>'invoiceId')::uuid;
 UPDATE public.client_invoices SET status='sent',sent_date='2026-09-02' WHERE id=invoice;
 BEGIN INSERT INTO public.client_invoice_line_items(invoice_id,position,description,amount) VALUES(invoice,9,'Illicit append',1);RAISE EXCEPTION 'Issued line appended';EXCEPTION WHEN check_violation THEN NULL;END;
 BEGIN UPDATE public.client_invoice_line_items SET amount=999 WHERE invoice_id=invoice;RAISE EXCEPTION 'Issued line repriced';EXCEPTION WHEN check_violation THEN NULL;END;
 BEGIN UPDATE public.client_invoices SET subtotal_amount=999 WHERE id=invoice;RAISE EXCEPTION 'Issued gross repriced';EXCEPTION WHEN check_violation THEN NULL;END;
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c||jsonb_build_object('requestId',gen_random_uuid(),'entryId',gen_random_uuid(),'expectedVersion',0,'sourceKey','premature-credit','category','credit','hours',NULL,'amount','10.00','invoiceId',invoice));RAISE EXCEPTION 'Credit predates issued invoice';EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE '%event cannot precede%' THEN RAISE;END IF;END;
 c:=c||jsonb_build_object('requestId',gen_random_uuid(),'entryId',gen_random_uuid(),'expectedVersion',0,'sourceKey','partial-payment','entryDate','2026-09-02','category','payment','hours',NULL,'amount','40.00','invoiceId',invoice);
 PERFORM public.record_contract_command(engagement,owner_id,c);
 PERFORM public.record_contract_command(engagement,owner_id,c||jsonb_build_object('requestId',gen_random_uuid(),'entryId',gen_random_uuid(),'sourceKey','documented-credit','category','credit','amount','10.00'));
 IF (SELECT count(*) FROM public.project_spend_entries WHERE project_id=project)<>0 OR (SELECT count(*) FROM public.invoicing_time_entries WHERE engagement_id=engagement)<>1 THEN RAISE EXCEPTION 'Cash or billing created another cost';END IF;
 `));
 it("retains CSV input with atomic rows and unchanged retries",()=>marker(`${saveBaseline}${time}
 c:=c||jsonb_build_object('sourceReference','Synthetic CSV sha256:'||encode(extensions.digest('source,hours'||chr(10)||'one,1.01','sha256'),'hex'));
 state:=jsonb_build_object('requestId',gen_random_uuid(),'filename','synthetic.csv','csv','source,hours'||chr(10)||'one,1.01','mapping','{}'::jsonb,'commands',jsonb_build_array(c));
 result:=public.record_contract_import(engagement,owner_id,state);again:=public.record_contract_import(engagement,owner_id,state);
 IF result<>again OR (SELECT count(*) FROM public.contract_imports WHERE engagement_id=engagement)<>1 THEN RAISE EXCEPTION 'Import retry duplicated';END IF;
 BEGIN PERFORM public.record_contract_import(engagement,owner_id,state||'{"filename":"changed.csv"}');RAISE EXCEPTION 'Import payload changed';EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
 c:=c||jsonb_build_object('entryId',gen_random_uuid(),'requestId',gen_random_uuid(),'sourceKey','two');
 state:=state||jsonb_build_object('requestId',gen_random_uuid(),'commands',jsonb_build_array(c,c||jsonb_build_object('requestId',gen_random_uuid(),'entryId',gen_random_uuid(),'sourceKey','bad-row','hours','99.00')));
 BEGIN PERFORM public.record_contract_import(engagement,owner_id,state);RAISE EXCEPTION 'Invalid import committed';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 IF (SELECT count(*) FROM public.contract_actual_versions WHERE engagement_id=engagement)<>1 THEN RAISE EXCEPTION 'Partial import left rows';END IF;
 `));

 it("detects contract-first OWP attachment and blocks billing until current valuations reconcile",()=>marker(`${saveBaseline}${time}
 PERFORM public.record_contract_command(engagement,member_id,c);${approve}
 INSERT INTO public.programs(id,workspace_id,title,program_type,cycle_name) VALUES(p,workspace,'Synthetic shared OWP','other','Test');
 SELECT * INTO ow_revision FROM public.save_program_work_program_revision(p,owner_id,0,gen_random_uuid(),jsonb_build_object('schemaVersion',1,'agency','Synthetic agency','currency','USD','periodStart','2026-01-01','periodEnd','2026-12-31','elements',jsonb_build_array(jsonb_build_object('id',element,'projectId',project,'tasks','[]'::jsonb))));
 owc:=jsonb_build_object('requestId',gen_random_uuid(),'entryId',ow_entry,'expectedVersion',0,'revisionId',ow_revision.id,'kind','labor','status','approved','entryDate','2026-09-01','sourceKey','synthetic-shared-owp','sourceReference','Synthetic source mapping','description','Shared original time','staffId',staff,'projectId',project,'contractId',engagement,'hours','1.01','amount','12.47','basis','recorded','billable',true,'timeEntryId',(SELECT time_entry_id FROM public.contract_actual_versions WHERE entry_id=entry LIMIT 1),'allocations',jsonb_build_array(jsonb_build_object('elementId',element,'share',10000)));
 PERFORM public.record_work_program_actual(p,owner_id,owc);
 state:=public.read_contract_management(engagement,owner_id);
 IF NOT (state->'actuals'->1->>'shared_source_stale')::boolean THEN RAISE EXCEPTION 'Reverse shared mapping missed';END IF;
 PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','rate','requestId',gen_random_uuid(),'rateId',billing_rate,'staffId',staff,'basis','billing','startsOn','2026-01-01','endsOn','2026-12-31','hourlyRate','100.00','sourceReference','Synthetic rate'));
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','bill','requestId',gen_random_uuid(),'invoiceNumber','STALE','invoiceDate','2026-09-01','retentionPercent','0.00','entryIds',jsonb_build_array(entry)));RAISE EXCEPTION 'Stale shared actual billed';EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
 c:=c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',2,'owpVersionId',(SELECT id FROM public.work_program_actual_versions WHERE entry_id=ow_entry),'correctionNote','Reconciled shared source');PERFORM public.record_contract_command(engagement,owner_id,c);
 state:=public.read_contract_management(engagement,owner_id);IF (state->'actuals'->2->>'shared_source_stale')::boolean THEN RAISE EXCEPTION 'Matching source remains stale';END IF;
 owc:=owc||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',1,'amount','20.00','correctionNote','Synthetic payroll correction');PERFORM public.record_work_program_actual(p,owner_id,owc);
 state:=public.read_contract_management(engagement,owner_id);IF NOT (state->'actuals'->2->>'shared_source_stale')::boolean THEN RAISE EXCEPTION 'Later OWP correction missed';END IF;
 IF (SELECT count(*) FROM public.invoicing_time_entries WHERE engagement_id=engagement)<>1 THEN RAISE EXCEPTION 'Shared mapping duplicated physical source';END IF;
 `));

 it("probes every contract table with populated private rows and member assignments",()=>marker(`${saveBaseline}${time}
 PERFORM public.record_contract_command(engagement,member_id,c);${approve}
 PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','rate','requestId',gen_random_uuid(),'rateId',billing_rate,'staffId',staff,'basis','billing','startsOn','2026-01-01','endsOn','2026-12-31','hourlyRate','100.00','sourceReference','Synthetic private billing rate'));
 PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','estimate','requestId',gen_random_uuid(),'taskId',task,'expectedVersion',0,'asOf','2026-09-01','hours','2.00','cost','25.00','basis','Synthetic remaining work','progress',10,'progressNote','Synthetic'));
 PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','bill','requestId',gen_random_uuid(),'invoiceNumber','PRIVATE','invoiceDate','2026-09-01','retentionPercent','0.00','entryIds',jsonb_build_array(entry)));
 PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','snapshot','requestId',gen_random_uuid(),'title','Private synthetic management','asOf','2026-09-01','sourceCutoff',now(),'coverageComplete',false,'coverageEvidence','Synthetic'));
 INSERT INTO public.contract_imports(id,engagement_id,workspace_id,filename,csv_text,source_hash,mapping,commands,created_by) VALUES(gen_random_uuid(),engagement,workspace,'synthetic.csv','private synthetic payroll',repeat('a',64),'{}','[]',owner_id);
 FOREACH tab IN ARRAY ARRAY['contract_baselines','contract_rates','contract_actual_versions','contract_estimates','contract_snapshots','contract_billing_sources','contract_imports','contract_tasks','contract_task_assignments'] LOOP
  EXECUTE format('SELECT count(*) FROM public.%I WHERE workspace_id=$1',tab) INTO observed USING workspace;
  IF observed=0 THEN RAISE EXCEPTION 'Empty privacy fixture for %',tab;END IF;
  PERFORM set_config('request.jwt.claim.sub',member_id::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
  EXECUTE format('SELECT count(*) FROM public.%I WHERE workspace_id=$1',tab) INTO observed USING workspace;
  IF tab IN ('contract_tasks','contract_task_assignments') THEN IF observed=0 THEN RAISE EXCEPTION 'Member assignment hidden';END IF;
  ELSIF observed<>0 THEN RAISE EXCEPTION 'Private contract table leaked: %',tab;END IF;
  EXECUTE 'RESET ROLE';PERFORM set_config('request.jwt.claim.sub',outsider::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
  EXECUTE format('SELECT count(*) FROM public.%I WHERE workspace_id=$1',tab) INTO observed USING workspace;
  IF observed<>0 THEN RAISE EXCEPTION 'Foreign contract table leaked: %',tab;END IF;
  EXECUTE 'RESET ROLE';
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM public.contract_commands WHERE engagement_id=engagement) THEN RAISE EXCEPTION 'Empty command fixture';END IF;
 PERFORM set_config('request.jwt.claim.sub',member_id::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 BEGIN PERFORM 1 FROM public.contract_commands;RAISE EXCEPTION 'Private command read';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 EXECUTE 'RESET ROLE';
 `));

 it("refuses mutable source values after cutoff and reconstructs pre-approval baseline state",()=>marker(`${saveBaseline}
 INSERT INTO public.project_spend_entries(project_id,entry_date,amount,description,created_at,updated_at) VALUES(project,'2026-09-01',900,'Synthetic changed legacy expense',now()-interval '1 hour',now()+interval '1 second');
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','snapshot','requestId',gen_random_uuid(),'title','Bad historical source','asOf','2026-09-01','sourceCutoff',now(),'coverageComplete',false,'coverageEvidence','Synthetic'));RAISE EXCEPTION 'Future source value entered cutoff';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 report:=gen_random_uuid();INSERT INTO public.contract_baselines(id,engagement_id,workspace_id,version,state,content,content_hash,created_by,created_at) VALUES(report,engagement,workspace,2,'proposed',c->'content',repeat('b',64),owner_id,now()-interval '1 hour');
 PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','approve','requestId',gen_random_uuid(),'baselineId',report,'expectedVersion',2,'approvalEvidence','Synthetic later approval'));
 state:=public.read_contract_management(engagement,owner_id,now()-interval '1 microsecond');IF state->'baselines'->0->>'state'<>'proposed' OR state->'baselines'->0->>'approval_evidence'<>'' THEN RAISE EXCEPTION 'Future approval entered cutoff';END IF;
 `));

 it("refuses shared costs denominated in another or unknown currency",()=>marker(`${saveBaseline}${time}
 PERFORM public.record_contract_command(engagement,member_id,c);${approve}
 INSERT INTO public.programs(id,workspace_id,title,program_type,cycle_name) VALUES(p,workspace,'Synthetic foreign currency','other','Test');
 SELECT * INTO ow_revision FROM public.save_program_work_program_revision(p,owner_id,0,gen_random_uuid(),jsonb_build_object('schemaVersion',1,'agency','Synthetic agency','currency','EUR','periodStart','2026-01-01','periodEnd','2026-12-31','elements','[]'::jsonb));
 INSERT INTO public.work_program_actual_versions(id,entry_id,version,program_id,workspace_id,revision_id,source_key,entry_date,kind,staff_id,time_entry_id,hours,amount,valuation_basis,status,detail,created_by) VALUES(ow_entry,gen_random_uuid(),1,p,workspace,ow_revision.id,'synthetic-EUR','2026-09-01','labor',staff,(SELECT time_entry_id FROM public.contract_actual_versions WHERE entry_id=entry LIMIT 1),1.01,12.47,'recorded','approved','{}',owner_id);
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',2,'owpVersionId',ow_entry,'correctionNote','Attempted foreign currency mapping'));RAISE EXCEPTION 'Foreign currency relabeled';EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE '%same documented currency%' THEN RAISE;END IF;END;
 `));

 it("requires explicit review of additional payroll and retains deleted source evidence",()=>marker(`${saveBaseline}${time}
 PERFORM public.record_contract_command(engagement,member_id,c);${approve}
 c:=c||jsonb_build_object('requestId',gen_random_uuid(),'entryId',gen_random_uuid(),'expectedVersion',0,'sourceKey','second-payroll');
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c);RAISE EXCEPTION 'Duplicate payroll approved';EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE '%reconcile overlap explicitly%' THEN RAISE;END IF;END;
 PERFORM public.record_contract_command(engagement,owner_id,c||jsonb_build_object('reconciliationNote','Synthetic separate afternoon effort, original timesheet reviewed'));
 INSERT INTO public.project_spend_entries(id,project_id,entry_date,amount,description,created_at) VALUES(ow_entry,project,'2026-09-01',100,'Synthetic removed legacy receipt',now()-interval '1 hour');
 DELETE FROM public.project_spend_entries WHERE id=ow_entry;
 IF NOT EXISTS(SELECT 1 FROM public.contract_source_deletions WHERE source_id=ow_entry) THEN RAISE EXCEPTION 'Deleted source evidence lost';END IF;
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','snapshot','requestId',gen_random_uuid(),'title','Invalid old cutoff','asOf','2026-09-01','sourceCutoff',now(),'coverageComplete',true,'coverageEvidence','Synthetic'));RAISE EXCEPTION 'Deleted source vanished from cutoff';EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE '%deleted after cutoff%' THEN RAISE;END IF;END;
 PERFORM set_config('request.jwt.claim.sub',member_id::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 IF EXISTS(SELECT 1 FROM public.contract_source_deletions WHERE workspace_id=workspace) THEN RAISE EXCEPTION 'Deleted source identity leaked';END IF;EXECUTE 'RESET ROLE';
 `));
});
