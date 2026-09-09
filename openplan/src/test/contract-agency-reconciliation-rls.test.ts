import { requireContractVerificationStack } from "./helpers/contract-verification-stack";
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
const setup=readFileSync("src/test/fixtures/contracts/setup.sql","utf8");
const baseline=`PERFORM public.record_contract_command(engagement,owner_id,c);PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','approve','requestId',gen_random_uuid(),'expectedVersion',1,'baselineId',baseline,'approvalEvidence','Synthetic approved agreement'));`;
const grants=`
 PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','access','requestId',gen_random_uuid(),'expectedVersion',0,'email',member_id||'@example.test','role','pm','active',true,'evidence','Synthetic PM designation'));
 PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','access','requestId',gen_random_uuid(),'expectedVersion',0,'email',outsider||'@example.test','role','consultant','active',true,'evidence','Synthetic consultant designation'));
`;
const invoice=`
 c:=jsonb_build_object('kind','received_invoice','requestId',gen_random_uuid(),'expectedVersion',0,'invoiceId',entry,'content',jsonb_build_object('number','SYNTHETIC-001','date','2026-09-01','currency','USD','lines',jsonb_build_array(jsonb_build_object('description','Synthetic invoice direct cost','amount','25.00','treatment','direct','basis','Synthetic invoice basis'))),'file',jsonb_build_object('filename','synthetic.csv','contentType','text/csv','base64',encode(convert_to('source,amount'||chr(10)||'SYNTHETIC-001,25.00','UTF8'),'base64')));
 result:=public.record_contract_command(engagement,outsider,c);again:=public.record_contract_command(engagement,outsider,c);
 IF result<>again OR (SELECT count(*) FROM public.contract_received_invoices WHERE invoice_id=entry)<>1 THEN RAISE EXCEPTION 'Received invoice retry duplicated';END IF;
`;
function check(body:string){
 requireContractVerificationStack(resolveLocalDbContainer());
 const mutation=process.env.OPENPLAN_CONTRACT_TEST_SQL?readFileSync(process.env.OPENPLAN_CONTRACT_TEST_SQL,"utf8"):"";
 const output=execFileSync("docker",["exec","-i",resolveLocalDbContainer(),"psql","-X","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1","-At"],{encoding:"utf8",input:`BEGIN;${mutation}\n${setup.replace("-- TEST_BODY",body)} SELECT 'AGENCY_ASSERTIONS_REACHED'; ROLLBACK;`,stdio:["pipe","pipe","pipe"]});expect(output).toContain("AGENCY_ASSERTIONS_REACHED");
}
(LIVE_RLS?describe:describe.skip)("agency contract roles and received invoices",()=>{
 it("grants PM costs within the assignment while keeping rate records and other contracts private",()=>check(`${baseline}${grants}
 PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','rate','requestId',gen_random_uuid(),'rateId',cost_rate,'staffId',staff,'basis','cost','startsOn','2026-01-01','endsOn','2026-12-31','hourlyRate','73.19','sourceReference','PRIVATE-RATE-REFERENCE'));
 state:=public.read_contract_management(engagement,member_id);
 IF state->>'role'<>'pm' OR state->'baselines'->0->'content'->>'cost'<>'500.00' OR state::text LIKE '%PRIVATE-RATE-REFERENCE%' THEN RAISE EXCEPTION 'PM cost or rate boundary incorrect';END IF;
 INSERT INTO public.invoicing_engagements(id,workspace_id,client_id,project_id,title) VALUES(p,workspace,client,other_project,'Other private contract');
 state:=public.read_contract_management(p,member_id);IF state->>'role'<>'member' THEN RAISE EXCEPTION 'PM grant escaped contract';END IF;
 BEGIN PERFORM public.record_contract_command(engagement,member_id,jsonb_build_object('kind','rate','requestId',gen_random_uuid(),'rateId',billing_rate,'staffId',staff,'basis','billing','startsOn','2026-01-01','endsOn','2026-12-31','hourlyRate','150.00','sourceReference','Synthetic approved billing rate'));RAISE EXCEPTION 'PM edited rates';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM set_config('request.jwt.claim.sub',member_id::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 IF NOT EXISTS(SELECT 1 FROM public.contract_baselines WHERE id=baseline) OR EXISTS(SELECT 1 FROM public.contract_rates WHERE id=cost_rate) THEN RAISE EXCEPTION 'PM direct database boundary incorrect';END IF;
 EXECUTE 'RESET ROLE';
 PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','access','requestId',gen_random_uuid(),'expectedVersion',1,'email',member_id||'@example.test','role','pm','active',false,'evidence','Synthetic revocation'));
 state:=public.read_contract_management(engagement,member_id);IF state->>'role'<>'member' OR state::text LIKE '%500.00%' THEN RAISE EXCEPTION 'Revoked PM retained cost access';END IF;
 `));
 it("retains submitted and returned versions, rejects stale reviews and denies consultant financial access",()=>check(`${baseline}${grants}${invoice}
 BEGIN PERFORM public.record_contract_command(engagement,outsider,jsonb_build_object('kind','received_review','requestId',gen_random_uuid(),'expectedVersion',1,'invoiceId',entry,'state','approved','note','Synthetic'));RAISE EXCEPTION 'Consultant approved invoice';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM public.record_contract_command(engagement,member_id,jsonb_build_object('kind','received_review','requestId',gen_random_uuid(),'expectedVersion',1,'invoiceId',entry,'state','returned','note','Synthetic discrepancy: clarify line basis','matches','[]'::jsonb));
 PERFORM public.record_contract_command(engagement,outsider,c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',2));
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','received_review','requestId',gen_random_uuid(),'expectedVersion',1,'invoiceId',entry,'state','reviewed','note','Stale review','matches','[]'::jsonb));RAISE EXCEPTION 'Stale invoice review accepted';EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
 state:=public.read_contract_management(engagement,outsider);
 IF jsonb_array_length(state->'receivedInvoices')<>3 OR state::text LIKE '%500.00%' OR state->'rates'<>'[]'::jsonb OR state->'actuals'<>'[]'::jsonb THEN RAISE EXCEPTION 'Consultant custody or confidentiality failed';END IF;
 PERFORM set_config('request.jwt.claim.sub',outsider::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 IF EXISTS(SELECT 1 FROM public.contract_received_files) OR EXISTS(SELECT 1 FROM public.contract_received_invoices) OR EXISTS(SELECT 1 FROM public.contract_baselines) THEN RAISE EXCEPTION 'Consultant direct private records leaked';END IF;
 EXECUTE 'RESET ROLE';
 PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','access','requestId',gen_random_uuid(),'expectedVersion',1,'email',outsider||'@example.test','role','consultant','active',false,'evidence','Synthetic revocation'));
 BEGIN PERFORM public.read_received_invoice_file(engagement,outsider,(state->'receivedInvoices'->0->'content'->>'fileId')::uuid);RAISE EXCEPTION 'Revoked consultant downloaded file';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 `));
 it("retains exact received original receipts within consultant scope and source cutoff",()=>check(`${baseline}${grants}${invoice}
 state:=public.read_contract_management(engagement,outsider);
 SELECT checksum INTO original_hash FROM public.contract_received_files WHERE id=(state->'receivedInvoices'->0->'content'->>'fileId')::uuid;
 IF state->'receivedInvoices'->0->'source_receipt'->>'checksum' IS DISTINCT FROM original_hash OR state->'receivedInvoices'->0->'source_receipt'->>'filename' IS DISTINCT FROM 'synthetic.csv' OR (state->'receivedInvoices'->0->'source_receipt'->>'bytes')::integer IS DISTINCT FROM octet_length(convert_to('source,amount'||chr(10)||'SYNTHETIC-001,25.00','UTF8')) THEN RAISE EXCEPTION 'Original received receipt missing';END IF;
 PERFORM public.record_contract_command(engagement,owner_id,c||jsonb_build_object('requestId',gen_random_uuid(),'invoiceId',gen_random_uuid(),'content',(c->'content')||jsonb_build_object('number','PRIVATE-OTHER-CONTRACTOR'),'file',jsonb_build_object('filename','PRIVATE-OTHER-CONTRACTOR.csv','contentType','text/csv','base64',encode(convert_to('PRIVATE-OTHER-CONTRACTOR','UTF8'),'base64'))));
 state:=public.read_contract_management(engagement,outsider);
 IF jsonb_array_length(state->'receivedInvoices') IS DISTINCT FROM 1 OR state::text LIKE '%PRIVATE-OTHER-CONTRACTOR%' THEN RAISE EXCEPTION 'Other contractor receipt leaked';END IF;
 state:=public.read_contract_management(engagement,owner_id);IF state->>'schemaVersion' IS DISTINCT FROM '7' THEN RAISE EXCEPTION 'New snapshot receipt format missing';END IF;
 INSERT INTO public.contract_received_files(id,engagement_id,workspace_id,filename,content_type,bytes,checksum,created_by,created_at) SELECT p,engagement_id,workspace_id,filename,content_type,bytes,checksum,created_by,now()+interval '1 minute' FROM public.contract_received_files WHERE checksum=original_hash AND engagement_id=engagement;
 INSERT INTO public.contract_received_invoices(invoice_id,engagement_id,workspace_id,version,state,content,submitted_by,created_by) SELECT i.invoice_id,i.engagement_id,i.workspace_id,2,i.state,jsonb_set(i.content,'{fileId}',to_jsonb(p)),i.submitted_by,i.created_by FROM public.contract_received_invoices i WHERE i.invoice_id=entry AND i.version=1;
 state:=public.read_contract_management(engagement,outsider,now());
 IF state->'receivedInvoices'->1->'source_receipt' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Future original receipt crossed cutoff';END IF;
 `));
 it("matches current sources exactly, prevents duplicate matching and never creates a second incurred cost",()=>check(`${baseline}${grants}${invoice}
 c:=jsonb_build_object('kind','actual','requestId',gen_random_uuid(),'entryId',ow_entry,'expectedVersion',0,'sourceKey','synthetic-vendor-cost','sourceReference','Synthetic accounting cost','entryDate','2026-09-01','category','expense','status','approved','description','Synthetic invoice source','staffId',NULL,'hours',NULL,'amount','25.00','valuationBasis','recorded','rateId',NULL,'billable',false,'allocations',jsonb_build_array(jsonb_build_object('taskId',task,'deliverableId',deliverable,'share',10000)));
 PERFORM public.record_contract_command(engagement,owner_id,c);
 SELECT id INTO cost_rate FROM public.contract_actual_versions WHERE entry_id=ow_entry;
 c:=jsonb_build_object('kind','received_review','requestId',gen_random_uuid(),'expectedVersion',1,'invoiceId',entry,'state','approved','note','Synthetic finance reconciliation','matches',jsonb_build_array(jsonb_build_object('entryId',ow_entry,'versionId',cost_rate,'amount','25.00')));
 BEGIN PERFORM public.record_contract_command(engagement,member_id,c);RAISE EXCEPTION 'PM financially approved received invoice';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM public.record_contract_command(engagement,owner_id,c);
 IF (SELECT count(*) FROM public.contract_actual_versions WHERE engagement_id=engagement)<>1 OR (SELECT sum(amount) FROM public.contract_actual_versions WHERE engagement_id=engagement)<>25 THEN RAISE EXCEPTION 'Received invoice duplicated incurred cost';END IF;
 IF (SELECT matches->0->'allocations'->0->>'amount' FROM public.contract_received_invoices WHERE invoice_id=entry AND version=2)<>'25.00' THEN RAISE EXCEPTION 'Invoice lost source allocation';END IF;
 state:=public.read_contract_management(engagement,outsider);IF state::text LIKE '%synthetic-vendor-cost%' OR state::text LIKE '%allocations%' THEN RAISE EXCEPTION 'Consultant saw internal source matching';END IF;
 INSERT INTO public.contract_received_invoices(invoice_id,engagement_id,workspace_id,version,state,content,submitted_by,created_by) SELECT p,engagement_id,workspace_id,1,'submitted',content,submitted_by,created_by FROM public.contract_received_invoices WHERE invoice_id=entry AND version=1;
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c||jsonb_build_object('requestId',gen_random_uuid(),'invoiceId',p));RAISE EXCEPTION 'Cost matched twice';EXCEPTION WHEN check_violation THEN NULL;END;
 `));
 it("shows finance-imported own hours without private notes, values, foreign staff or correction authority",()=>check(`${baseline}
 c:=jsonb_build_object('kind','actual','requestId',gen_random_uuid(),'entryId',entry,'expectedVersion',0,'sourceKey','SYNTHETIC-PAYROLL-OWN','sourceReference','PRIVATE-PAYROLL-FILE 73.19','entryDate','2026-09-01','category','labor','status','draft','description','PRIVATE-FINANCE-NOTE','staffId',staff,'hours','2.00','amount','146.38','valuationBasis','recorded','rateId',NULL,'billable',true,'allocations',jsonb_build_array(jsonb_build_object('taskId',task,'deliverableId',deliverable,'share',10000)));
 PERFORM public.record_contract_command(engagement,owner_id,c);
 state:=public.read_contract_management(engagement,member_id);
 IF jsonb_array_length(state->'actuals')<>1 OR state->'actuals'->0->>'hours' IS DISTINCT FROM '2.00' OR (state->'actuals'->0->>'member_can_correct')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'Imported own draft visibility or correction guard failed';END IF;
 BEGIN PERFORM public.record_contract_command(engagement,member_id,c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',1,'amount',NULL,'valuationBasis','unvalued','correctionNote','Attempt to change finance original'));RAISE EXCEPTION 'Staff edited finance draft';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM public.record_contract_command(engagement,owner_id,c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',1,'status','approved','hours','3.00','amount','219.57','correctionNote','PRIVATE-FINANCE-CORRECTION'));
 INSERT INTO public.invoicing_staff(id,workspace_id,name,user_id) VALUES(p,workspace,'Other staff',owner_id);
 PERFORM public.record_contract_command(engagement,owner_id,c||jsonb_build_object('requestId',gen_random_uuid(),'entryId',ow_entry,'sourceKey','PRIVATE-OTHER-PERSON','staffId',p));
 state:=public.read_contract_management(engagement,member_id);
 IF jsonb_array_length(state->'actuals')<>2 OR state->'actuals'->1->>'hours' IS DISTINCT FROM '3.00' OR state->'actuals'->1->'command'->>'status' IS DISTINCT FROM 'approved' OR state->'actuals'->1->'command'->>'entryDate' IS DISTINCT FROM '2026-09-01' THEN RAISE EXCEPTION 'Imported own current approved time missing';END IF;
 IF state::text LIKE '%PRIVATE-%' OR state::text LIKE '%219.57%' OR state::text LIKE '%146.38%' OR state->'actuals'->1->>'amount' IS NOT NULL OR state->'actuals'->1->'command'->>'rateId' IS NOT NULL OR state->'actuals'->1->'command'->'allocations'->0->>'amount' IS NOT NULL THEN RAISE EXCEPTION 'Imported payroll private fields leaked';END IF;
 IF state->'actuals'->1->'command'->'allocations'->0->>'taskId' IS DISTINCT FROM task::text OR state->'actuals'->1->'command'->'allocations'->0->>'deliverableId' IS DISTINCT FROM deliverable::text THEN RAISE EXCEPTION 'Own time attribution missing';END IF;
 PERFORM set_config('request.jwt.claim.sub',member_id::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 IF EXISTS(SELECT 1 FROM public.contract_actual_versions WHERE entry_id=entry) THEN RAISE EXCEPTION 'Staff read raw payroll values';END IF;
 EXECUTE 'RESET ROLE';
 `));

});
