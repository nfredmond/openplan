import { requireContractVerificationStack } from "./helpers/contract-verification-stack";
import {describe,it,expect} from "vitest";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {LIVE_RLS} from "./local-supabase-env";
import {resolveLocalDbContainer} from "./helpers/live-catalog";
const setup=readFileSync("src/test/fixtures/contracts/setup.sql","utf8");
function check(body:string){
 requireContractVerificationStack(resolveLocalDbContainer());
 const mutation=process.env.OPENPLAN_CONTRACT_TEST_SQL?readFileSync(process.env.OPENPLAN_CONTRACT_TEST_SQL,"utf8"):"";
 const output=execFileSync("docker",["exec","-i",resolveLocalDbContainer(),"psql","-X","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1","-At"],{encoding:"utf8",input:`BEGIN;${mutation}\n${setup.replace("-- TEST_BODY",body)} SELECT 'DIRECTION_ASSERTIONS_REACHED';ROLLBACK;`,stdio:["pipe","pipe","pipe"]});expect(output).toContain("DIRECTION_ASSERTIONS_REACHED");
}
(LIVE_RLS?describe:describe.skip)("database approved agreement billing direction",()=>{
 it("retains direction in exact approved baseline and publishes the new snapshot format",()=>check(`
 c:=jsonb_set(c,'{content,billingDirection}','"received"');
 PERFORM public.record_contract_command(engagement,owner_id,c);
 IF EXISTS(SELECT 1 FROM public.contract_baselines b WHERE b.id=baseline AND b.state='approved') THEN RAISE EXCEPTION 'Proposal gained authority';END IF;
 PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','approve','requestId',gen_random_uuid(),'expectedVersion',1,'baselineId',baseline,'approvalEvidence','Synthetic source-authorized purchaser'));
 state:=public.read_contract_management(engagement,owner_id);
 IF (state->>'schemaVersion')::integer<6 OR state->'baselines'->0->'content'->>'billingDirection'<>'received' THEN RAISE EXCEPTION 'Approved perspective or report format lost';END IF;
 `));
 it("rejects invalid or undocumented perspectives even through the database command boundary",()=>check(`
 c:=jsonb_set(c,'{content,billingDirection}','"invented"');
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c);RAISE EXCEPTION 'Invalid perspective accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 c:=jsonb_set(c,'{content,billingDirection}','"internal"');c:=jsonb_set(c,'{content,feeBasis}','"unassessed"');c:=jsonb_set(c,'{content,feeTerms}','""');
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c);RAISE EXCEPTION 'Undocumented perspective accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 `));
 it("invalidates reviewed forecast inputs when a received invoice version arrives",()=>check(`
 PERFORM public.record_contract_command(engagement,owner_id,c);
 original_hash:=public.contract_delivery_hash(workspace);
 c:=jsonb_build_object('kind','received_invoice','requestId',gen_random_uuid(),'expectedVersion',0,'invoiceId',entry,'content',jsonb_build_object('number','SYNTHETIC-HASH','date','2026-09-01','currency','USD','lines',jsonb_build_array(jsonb_build_object('description','Synthetic direct cost','amount','25.00','treatment','direct','basis','Synthetic invoice basis'))),'file',jsonb_build_object('filename','synthetic.csv','contentType','text/csv','base64',encode(convert_to('source,amount'||chr(10)||'SYNTHETIC-HASH,25.00','UTF8'),'base64')));
 PERFORM public.record_contract_command(engagement,owner_id,c);
 IF original_hash=public.contract_delivery_hash(workspace) THEN RAISE EXCEPTION 'Received invoice did not stale forecast';END IF;
 `));
 it("preserves legacy baseline JSON without silently assigning a new purchaser meaning",()=>check(`
 PERFORM public.record_contract_command(engagement,owner_id,c);
 IF (SELECT content ? 'billingDirection' FROM public.contract_baselines WHERE id=baseline) THEN RAISE EXCEPTION 'Legacy perspective was backfilled';END IF;
 `));
});
