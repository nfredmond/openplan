import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
const setup=readFileSync("src/test/fixtures/contracts/setup.sql","utf8");
const prepare=`
 PERFORM public.record_contract_command(engagement,owner_id,c);PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','approve','requestId',gen_random_uuid(),'expectedVersion',1,'baselineId',baseline,'approvalEvidence','Synthetic approved agreement'));
 c:=jsonb_build_object('kind','actual','requestId',gen_random_uuid(),'entryId',entry,'expectedVersion',0,'sourceKey','synthetic-payroll','sourceReference','Synthetic accounting source','entryDate','2026-09-01','category','expense','status','approved','description','Synthetic imported expense','staffId',NULL,'hours',NULL,'amount','25.01','valuationBasis','recorded','rateId',NULL,'billable',false,'allocations',jsonb_build_array(jsonb_build_object('taskId',task,'deliverableId',deliverable,'share',10000)));
 PERFORM public.record_contract_command(engagement,owner_id,c);
 SELECT id INTO cost_rate FROM public.contract_actual_versions WHERE entry_id=entry;
 c:=jsonb_build_object('kind','accounting_import','requestId',p,'filename','synthetic-accounting.csv','csv','externalId,sourceKey,amount,hours,currency'||chr(10)||'POST-1,synthetic-payroll,25.00,,USD','mapping','{}'::jsonb,'rows',jsonb_build_array(jsonb_build_object('externalId','POST-1','sourceKey','synthetic-payroll','amount','25.00','hours',NULL,'currency','USD')));
 result:=public.record_contract_command(engagement,owner_id,c);again:=public.record_contract_command(engagement,owner_id,c);
 IF result<>again OR (SELECT count(*) FROM public.contract_accounting_imports WHERE id=p)<>1 THEN RAISE EXCEPTION 'Accounting retry duplicated';END IF;
`;
function check(body:string){
 if(!process.env.CI&&!process.env.OPENPLAN_SUPABASE_WORKDIR?.includes("m11-contract-verification"))throw new Error("Explicit disposable m11-contract-verification stack required");
 const mutation=process.env.OPENPLAN_CONTRACT_TEST_SQL?readFileSync(process.env.OPENPLAN_CONTRACT_TEST_SQL,"utf8"):"";
 const output=execFileSync("docker",["exec","-i",resolveLocalDbContainer(),"psql","-X","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1","-At"],{encoding:"utf8",input:`BEGIN;${mutation}\n${setup.replace("-- TEST_BODY",body)} SELECT 'ACCOUNTING_ASSERTIONS_REACHED'; ROLLBACK;`,stdio:["pipe","pipe","pipe"]});expect(output).toContain("ACCOUNTING_ASSERTIONS_REACHED");
}
(LIVE_RLS?describe:describe.skip)("retained accounting reconciliation",()=>{
 it("keeps discrepancies unresolved, binds reviews to exact valuations and retains original source bytes",()=>check(`${prepare}
 c:=jsonb_build_object('kind','accounting_review','requestId',gen_random_uuid(),'importId',p,'rowIndex',0,'expectedVersion',0,'actualVersionId',cost_rate,'state','reconciled','evidence','Synthetic review');
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c);RAISE EXCEPTION 'Mismatched accounting values reconciled';EXCEPTION WHEN check_violation THEN NULL;END;
 PERFORM public.record_contract_command(engagement,owner_id,c||jsonb_build_object('state','unresolved'));
 IF (SELECT r.state FROM public.contract_accounting_reviews r WHERE r.import_id=p)<>'unresolved' THEN RAISE EXCEPTION 'Discrepancy decision missing';END IF;
 SELECT command INTO state FROM public.contract_actual_versions WHERE id=cost_rate;
 PERFORM public.record_contract_command(engagement,owner_id,state||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',1,'amount','25.00','correctionNote','Synthetic source correction after independent review'));
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',1));RAISE EXCEPTION 'Stale accounting valuation accepted';EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
 SELECT id INTO billing_rate FROM public.contract_actual_versions WHERE entry_id=entry AND version=2;
 PERFORM public.record_contract_command(engagement,owner_id,c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',1,'actualVersionId',billing_rate));
 IF (SELECT count(*) FROM public.contract_actual_versions WHERE entry_id=entry)<>2 THEN RAISE EXCEPTION 'Reconciliation created another cost';END IF;
 IF (SELECT source_hash FROM public.contract_accounting_imports WHERE id=p) IS DISTINCT FROM (SELECT encode(extensions.digest(csv_text,'sha256'),'hex') FROM public.contract_accounting_imports WHERE id=p) THEN RAISE EXCEPTION 'Original accounting hash incorrect';END IF;
 BEGIN UPDATE public.contract_accounting_imports SET csv_text='changed' WHERE id=p;RAISE EXCEPTION 'Accounting file replaced';EXCEPTION WHEN check_violation THEN NULL;END;
 BEGIN UPDATE public.contract_accounting_reviews SET evidence='changed' WHERE import_id=p;RAISE EXCEPTION 'Review evidence replaced';EXCEPTION WHEN check_violation THEN NULL;END;
 `));
 it("keeps accounting originals private and enables designated finance without rate editing by PM",()=>check(`${prepare}
 PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','access','requestId',gen_random_uuid(),'expectedVersion',0,'email',member_id||'@example.test','role','pm','active',true,'evidence','Synthetic PM'));
 state:=public.read_contract_management(engagement,member_id);IF state?'accountingImports' THEN RAISE EXCEPTION 'PM received raw payroll import';END IF;
 PERFORM set_config('request.jwt.claim.sub',member_id::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 IF EXISTS(SELECT 1 FROM public.contract_accounting_imports) THEN RAISE EXCEPTION 'PM read accounting originals';END IF;EXECUTE 'RESET ROLE';
 PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','access','requestId',gen_random_uuid(),'expectedVersion',1,'email',member_id||'@example.test','role','finance','active',true,'evidence','Synthetic finance'));
 PERFORM public.record_contract_command(engagement,member_id,jsonb_build_object('kind','accounting_review','requestId',gen_random_uuid(),'importId',p,'rowIndex',0,'expectedVersion',0,'actualVersionId',cost_rate,'state','unresolved','evidence','Synthetic finance discrepancy'));
 PERFORM set_config('request.jwt.claim.sub',member_id::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 IF NOT EXISTS(SELECT 1 FROM public.contract_accounting_imports WHERE id=p) OR NOT EXISTS(SELECT 1 FROM public.contract_accounting_reviews WHERE import_id=p) THEN RAISE EXCEPTION 'Designated finance lost accounting access';END IF;EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claim.sub',outsider::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 IF EXISTS(SELECT 1 FROM public.contract_accounting_imports) OR EXISTS(SELECT 1 FROM public.contract_accounting_reviews) OR EXISTS(SELECT 1 FROM public.contract_access_versions) THEN RAISE EXCEPTION 'Accounting evidence leaked to outsider';END IF;EXECUTE 'RESET ROLE';
 `));
});
