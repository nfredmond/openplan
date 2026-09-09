import { requireContractVerificationStack } from "./helpers/contract-verification-stack";
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";

const setup = readFileSync("src/test/fixtures/contracts/setup.sql", "utf8");
function check(body: string) {
  requireContractVerificationStack(resolveLocalDbContainer());
  const mutation = process.env.OPENPLAN_CONTRACT_TEST_SQL ? readFileSync(process.env.OPENPLAN_CONTRACT_TEST_SQL, "utf8") : "";
  const output = execFileSync("docker", ["exec", "-i", resolveLocalDbContainer(), "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], {
    input: `BEGIN;${mutation}\n${setup.replace("-- TEST_BODY", body)} SELECT 'PENDING_ASSERTIONS_REACHED'; ROLLBACK;`, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  });
  expect(output).toContain("PENDING_ASSERTIONS_REACHED");
}
const asActor = (actor: string) => `PERFORM set_config('request.jwt.claim.sub',${actor}::text,true);SET LOCAL ROLE authenticated;`;
const pm = `INSERT INTO public.contract_access_versions(engagement_id,workspace_id,user_id,version,role,active,evidence,created_by) VALUES(engagement,workspace,member_id,1,'pm',true,'Synthetic PM',owner_id);`;

describe.skipIf(!LIVE_RLS)("pending contract review eligibility", () => {
  it("shows designated finance the latest master proposal and only the latest unapplied response", () => check(`
    INSERT INTO public.contract_access_versions(engagement_id,workspace_id,user_id,version,role,active,evidence,created_by) VALUES(engagement,workspace,member_id,1,'finance',true,'Synthetic finance',owner_id);
    report:=gen_random_uuid();INSERT INTO public.contract_master_terms(id,engagement_id,workspace_id,version,state,currency,ceiling,starts_on,ends_on,terms,source_document_id,source_receipt,created_by) VALUES(entry,engagement,workspace,1,'proposed','USD',1500,'2026-01-01','2026-12-31','Synthetic master terms',document,'{}',owner_id),(report,engagement,workspace,2,'proposed','USD',2500,'2026-01-01','2026-12-31','Synthetic revised terms',document,'{}',owner_id);
    ${asActor("member_id")}
    IF (SELECT count(*) FROM public.contract_pending_my_work WHERE engagement_id=engagement AND review_kind='master')<>1 OR NOT EXISTS(SELECT 1 FROM public.contract_pending_my_work WHERE id=report) THEN RAISE EXCEPTION 'Scoped finance master version incorrect';END IF;RESET ROLE;
    UPDATE public.contract_master_terms SET state='approved',approved_at=now(),approval_evidence='Synthetic master approval' WHERE id=report;
    ${asActor("member_id")}
    IF EXISTS(SELECT 1 FROM public.contract_pending_my_work WHERE engagement_id=engagement) THEN RAISE EXCEPTION 'Old master proposal resurrected';END IF;RESET ROLE;
    INSERT INTO public.contract_forecasts(id,engagement_id,workspace_id,version,input_hash,content,created_by) VALUES(p,engagement,workspace,1,repeat('a',64),'{}',owner_id);
    INSERT INTO public.contract_management_responses(id,engagement_id,workspace_id,forecast_id,input_hash,content,created_by,created_at) VALUES(entry,engagement,workspace,p,repeat('a',64),jsonb_build_object('sourceRecord',jsonb_build_object('title','Synthetic old response')),owner_id,now()-interval '1 minute'),(report,engagement,workspace,p,repeat('a',64),jsonb_build_object('sourceRecord',jsonb_build_object('title','Synthetic latest response')),owner_id,now());
    ${asActor("member_id")}
    IF (SELECT count(*) FROM public.contract_pending_my_work WHERE engagement_id=engagement AND review_kind='response')<>1 OR NOT EXISTS(SELECT 1 FROM public.contract_pending_my_work WHERE id=report AND title='Synthetic latest response') THEN RAISE EXCEPTION 'Latest response decision incorrect';END IF;RESET ROLE;
    INSERT INTO public.contract_schedules(id,engagement_id,workspace_id,version,content,created_by) VALUES(element,engagement,workspace,1,'{}',owner_id);
    INSERT INTO public.contract_response_applications(engagement_id,workspace_id,response_id,schedule_id,evidence,created_by) VALUES(engagement,workspace,report,element,'Synthetic applied comparison',owner_id);
    ${asActor("member_id")}
    IF EXISTS(SELECT 1 FROM public.contract_pending_my_work WHERE engagement_id=engagement) THEN RAISE EXCEPTION 'Applied response remained pending';END IF;RESET ROLE;
  `));
  it("routes proposed baselines only to finance and removes approved decisions", () => check(`
    PERFORM public.record_contract_command(engagement,owner_id,c);
    ${asActor("owner_id")}
    IF (SELECT count(*) FROM public.contract_pending_my_work WHERE engagement_id=engagement AND review_kind='baseline')<>1 THEN RAISE EXCEPTION 'Finance baseline queue missing';END IF;
    RESET ROLE;
    ${asActor("member_id")}
    IF EXISTS(SELECT 1 FROM public.contract_pending_my_work WHERE engagement_id=engagement) THEN RAISE EXCEPTION 'Staff received finance decision';END IF;RESET ROLE;
    ${pm}${asActor("member_id")}
    IF EXISTS(SELECT 1 FROM public.contract_pending_my_work WHERE engagement_id=engagement) THEN RAISE EXCEPTION 'PM received finance decision';END IF;RESET ROLE;
    ${asActor("outsider")}
    IF EXISTS(SELECT 1 FROM public.contract_pending_my_work WHERE engagement_id=engagement) THEN RAISE EXCEPTION 'Foreign actor saw contract decision';END IF;RESET ROLE;
    PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','approve','requestId',gen_random_uuid(),'baselineId',baseline,'expectedVersion',1,'approvalEvidence','Synthetic approval'));
    ${asActor("owner_id")}
    IF EXISTS(SELECT 1 FROM public.contract_pending_my_work WHERE engagement_id=engagement) THEN RAISE EXCEPTION 'Approved baseline still pending';END IF;RESET ROLE;
  `));
  it("moves current received invoices from PM review to finance without resurfacing returned or approved versions", () => check(`
    ${pm}
    INSERT INTO public.contract_received_invoices(invoice_id,engagement_id,workspace_id,version,state,content,submitted_by,created_by) VALUES(entry,engagement,workspace,1,'submitted',jsonb_build_object('number','SYNTHETIC-001'),member_id,owner_id);
    ${asActor("member_id")}
    IF (SELECT count(*) FROM public.contract_pending_my_work WHERE engagement_id=engagement AND review_kind='received_review' AND title='SYNTHETIC-001')<>1 THEN RAISE EXCEPTION 'PM invoice queue missing';END IF;RESET ROLE;
    INSERT INTO public.contract_received_invoices(invoice_id,engagement_id,workspace_id,version,state,content,submitted_by,created_by) VALUES(entry,engagement,workspace,2,'reviewed',jsonb_build_object('number','SYNTHETIC-001'),member_id,owner_id);
    ${asActor("member_id")}
    IF EXISTS(SELECT 1 FROM public.contract_pending_my_work WHERE engagement_id=engagement) THEN RAISE EXCEPTION 'Reviewed invoice retained PM approval';END IF;RESET ROLE;
    ${asActor("owner_id")}
    IF (SELECT count(*) FROM public.contract_pending_my_work WHERE engagement_id=engagement AND review_kind='received_finance')<>1 THEN RAISE EXCEPTION 'Finance invoice queue missing';END IF;RESET ROLE;
    INSERT INTO public.contract_received_invoices(invoice_id,engagement_id,workspace_id,version,state,content,submitted_by,created_by) VALUES(entry,engagement,workspace,3,'returned',jsonb_build_object('number','SYNTHETIC-001'),member_id,owner_id);
    ${asActor("owner_id")}
    IF EXISTS(SELECT 1 FROM public.contract_pending_my_work WHERE engagement_id=engagement) THEN RAISE EXCEPTION 'Returned invoice resurrected review';END IF;RESET ROLE;
    INSERT INTO public.contract_received_invoices(invoice_id,engagement_id,workspace_id,version,state,content,submitted_by,created_by) VALUES(entry,engagement,workspace,4,'approved',jsonb_build_object('number','SYNTHETIC-001'),member_id,owner_id);
    ${asActor("owner_id")}
    IF EXISTS(SELECT 1 FROM public.contract_pending_my_work WHERE engagement_id=engagement) THEN RAISE EXCEPTION 'Approved invoice still pending';END IF;RESET ROLE;
  `));
});

describe.skipIf(!LIVE_RLS)("scoped participant and accounting queues",()=>{
 it("keeps participant view caller-owned and denies anonymous function access",()=>check(`
 IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='contract_participant_my_work' AND c.reloptions @> ARRAY['security_invoker=true','security_barrier=true']) THEN RAISE EXCEPTION 'Participant view bypasses caller privileges';END IF;
 IF has_function_privilege('anon','public.contract_participant_work_rows()','EXECUTE') THEN RAISE EXCEPTION 'Anonymous participant function access';END IF;
 IF NOT has_function_privilege('authenticated','public.contract_participant_work_rows()','EXECUTE') THEN RAISE EXCEPTION 'Caller participant function unavailable';END IF;
 `));

 it("shows only the consultant's explicit grants and current own returned invoices",()=>check(`
 INSERT INTO public.contract_access_versions(engagement_id,workspace_id,user_id,version,role,active,evidence,created_by) VALUES(engagement,workspace,outsider,1,'consultant',true,'Synthetic external consultant',owner_id);
 INSERT INTO public.invoicing_engagements(id,workspace_id,client_id,project_id,title) VALUES(p,workspace,client,other_project,'PRIVATE OTHER ASSIGNMENT');
 INSERT INTO public.contract_received_invoices(invoice_id,engagement_id,workspace_id,version,state,content,submitted_by,created_by) VALUES(entry,engagement,workspace,1,'submitted',jsonb_build_object('number','SYNTH-OWN'),outsider,outsider),(entry,engagement,workspace,2,'returned',jsonb_build_object('number','SYNTH-OWN'),outsider,owner_id),(gen_random_uuid(),engagement,workspace,1,'returned',jsonb_build_object('number','PRIVATE-OTHER-PARTICIPANT'),owner_id,owner_id);
 ${asActor("outsider")}
 IF (SELECT count(*) FROM public.contract_participant_my_work) IS DISTINCT FROM 1 OR (SELECT returned_invoices FROM public.contract_participant_my_work WHERE id=engagement) IS DISTINCT FROM 1::bigint OR EXISTS(SELECT 1 FROM public.contract_participant_my_work WHERE title LIKE '%PRIVATE%') THEN RAISE EXCEPTION 'Participant grant or own return count incorrect';END IF;RESET ROLE;
 ${asActor("member_id")}
 IF EXISTS(SELECT 1 FROM public.contract_participant_my_work) THEN RAISE EXCEPTION 'Ungranting staff saw consultant assignment';END IF;RESET ROLE;
 INSERT INTO public.contract_received_invoices(invoice_id,engagement_id,workspace_id,version,state,content,submitted_by,created_by) VALUES(entry,engagement,workspace,3,'submitted',jsonb_build_object('number','SYNTH-OWN'),outsider,outsider);
 ${asActor("outsider")}
 IF (SELECT returned_invoices FROM public.contract_participant_my_work WHERE id=engagement) IS DISTINCT FROM 0::bigint THEN RAISE EXCEPTION 'Old returned invoice resurfaced';END IF;RESET ROLE;
 INSERT INTO public.contract_access_versions(engagement_id,workspace_id,user_id,version,role,active,evidence,created_by) VALUES(engagement,workspace,outsider,2,'consultant',false,'Synthetic revoked access',owner_id);
 ${asActor("outsider")}
 IF EXISTS(SELECT 1 FROM public.contract_participant_my_work) THEN RAISE EXCEPTION 'Revoked consultant retained entry';END IF;RESET ROLE;
 `));
 it("queues unreviewed and unresolved imported rows for finance without resurfacing an earlier review",()=>check(`
 INSERT INTO public.contract_accounting_imports(id,engagement_id,workspace_id,filename,csv_text,source_hash,mapping,rows,created_by) VALUES(p,engagement,workspace,'Synthetic accounting.csv','SYNTH',repeat('a',64),'{}',jsonb_build_array(jsonb_build_object('externalId','SYNTH-POST','sourceKey','SYNTH-COST','amount','0.00','hours',NULL,'currency','USD')),owner_id);
 ${asActor("owner_id")}
 IF NOT EXISTS(SELECT 1 FROM public.contract_pending_my_work WHERE id=p AND review_kind='accounting') THEN RAISE EXCEPTION 'Unreviewed accounting row missing';END IF;RESET ROLE;
 ${pm}${asActor("member_id")}
 IF EXISTS(SELECT 1 FROM public.contract_pending_my_work WHERE id=p) THEN RAISE EXCEPTION 'PM received private accounting queue';END IF;RESET ROLE;
 INSERT INTO public.contract_accounting_reviews(import_id,row_index,engagement_id,workspace_id,version,state,evidence,created_by) VALUES(p,0,engagement,workspace,1,'unresolved','Synthetic missing source',owner_id);
 ${asActor("owner_id")}
 IF NOT EXISTS(SELECT 1 FROM public.contract_pending_my_work WHERE id=p) THEN RAISE EXCEPTION 'Unresolved accounting row missing';END IF;RESET ROLE;
 PERFORM public.record_contract_command(engagement,owner_id,c);PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','approve','requestId',gen_random_uuid(),'expectedVersion',1,'baselineId',baseline,'approvalEvidence','Synthetic'));
 c:=jsonb_build_object('kind','actual','requestId',gen_random_uuid(),'entryId',entry,'expectedVersion',0,'sourceKey','SYNTH-COST','sourceReference','Synthetic zero final adjustment','entryDate','2026-09-08','category','expense','status','approved','description','Synthetic zero-dollar source','staffId',NULL,'hours',NULL,'amount','0.00','valuationBasis','recorded','rateId',NULL,'billable',false,'allocations',jsonb_build_array(jsonb_build_object('taskId',task,'deliverableId',deliverable,'share',10000)));
 PERFORM public.record_contract_command(engagement,owner_id,c);SELECT id INTO report FROM public.contract_actual_versions WHERE entry_id=entry;
 ${asActor("member_id")}
 IF public.contract_accounting_source_stale(report) IS NOT NULL THEN RAISE EXCEPTION 'PM learned private accounting source state';END IF;RESET ROLE;

 INSERT INTO public.contract_accounting_reviews(import_id,row_index,engagement_id,workspace_id,version,actual_version_id,state,evidence,created_by) VALUES(p,0,engagement,workspace,2,report,'reconciled','Synthetic retained matching source',owner_id);
 ${asActor("owner_id")}
 IF EXISTS(SELECT 1 FROM public.contract_pending_my_work WHERE id=p) THEN RAISE EXCEPTION 'Old unresolved accounting row resurfaced';END IF;RESET ROLE;
 INSERT INTO public.contract_accounting_reviews(import_id,row_index,engagement_id,workspace_id,version,actual_version_id,state,evidence,created_by) VALUES(p,0,engagement,workspace,3,report,'unresolved','Synthetic reviewer reopens posting discrepancy',owner_id);
 ${asActor("owner_id")}
 IF NOT EXISTS(SELECT 1 FROM public.contract_pending_my_work WHERE id=p) THEN RAISE EXCEPTION 'Reopened source discrepancy missing';END IF;RESET ROLE;
 INSERT INTO public.contract_accounting_reviews(import_id,row_index,engagement_id,workspace_id,version,actual_version_id,state,evidence,created_by) VALUES(p,0,engagement,workspace,4,report,'reconciled','Synthetic resolved posting discrepancy',owner_id);

 PERFORM public.record_contract_command(engagement,owner_id,c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',1,'amount','1.00','correctionNote','Synthetic posted correction requiring renewed reconciliation'));
 ${asActor("owner_id")}
 IF NOT EXISTS(SELECT 1 FROM public.contract_pending_my_work WHERE id=p) THEN RAISE EXCEPTION 'Changed reconciled source missing from queue';END IF;RESET ROLE;
 `));
});
