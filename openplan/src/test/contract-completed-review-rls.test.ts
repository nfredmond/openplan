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
 const output=execFileSync("docker",["exec","-i",resolveLocalDbContainer(),"psql","-X","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1","-At"],{input:`BEGIN;${mutation}\n${setup.replace("-- TEST_BODY",body)} SELECT 'COMPLETED_REVIEW_ASSERTIONS_REACHED';ROLLBACK;`,encoding:"utf8",stdio:["pipe","pipe","pipe"]});expect(output).toContain("COMPLETED_REVIEW_ASSERTIONS_REACHED");
}
const prepare=`PERFORM public.record_contract_command(engagement,owner_id,c);PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','approve','requestId',gen_random_uuid(),'baselineId',baseline,'expectedVersion',1,'approvalEvidence','Synthetic approval'));
 c:=jsonb_build_object('kind','schedule','requestId',gen_random_uuid(),'expectedVersion',0,'content',jsonb_build_object('assumptions','Synthetic documented completed review','billingTreatment','unassessed','nodes',jsonb_build_array(jsonb_build_object('id',p,'taskId',task,'kind','agency_review','staff','[]'::jsonb,'completedReview',jsonb_build_object('startedOn','2026-09-02','finishedOn','2026-09-08','evidence','Synthetic dated outside reviewer confirmation')))));`;
describe.skipIf(!LIVE_RLS)("completed outside review custody",()=>{
 it("retains exact review dates without granting staff approval or accepting a deliverable",()=>check(`${prepare}
 original_hash:=(SELECT content_hash FROM public.contract_baselines WHERE id=baseline);
 BEGIN PERFORM public.record_contract_command(engagement,member_id,c);RAISE EXCEPTION 'Staff recorded management review actuals';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 result:=public.record_contract_command(engagement,owner_id,c);again:=public.record_contract_command(engagement,owner_id,c);IF result<>again THEN RAISE EXCEPTION 'Completed review retry changed';END IF;
 IF (SELECT content->'nodes'->0->'completedReview' FROM public.contract_schedules WHERE id=(result->>'id')::uuid) IS DISTINCT FROM c->'content'->'nodes'->0->'completedReview' THEN RAISE EXCEPTION 'Completed review evidence lost';END IF;
 IF EXISTS(SELECT 1 FROM public.contract_deliverable_events WHERE engagement_id=engagement) OR (SELECT content_hash FROM public.contract_baselines WHERE id=baseline)<>original_hash THEN RAISE EXCEPTION 'Review completion promoted acceptance or baseline';END IF;
 BEGIN UPDATE public.contract_schedules SET content='{}' WHERE id=(result->>'id')::uuid;RAISE EXCEPTION 'Completed review history rewritten';EXCEPTION WHEN check_violation THEN NULL;END;
 IF position('method:contract-delivery-v4-completed-reviews' in pg_get_functiondef('public.contract_delivery_hash(uuid)'::regprocedure))=0 THEN RAISE EXCEPTION 'Completed review calculation revision missing';END IF;
 `));
 it("refuses missing evidence, reversed and future dates or review actuals on staff work",()=>check(`${prepare}
 FOR tab IN SELECT unnest(ARRAY['evidence','reverse','future','work','missing','invalid']) LOOP
  state:=c;
  IF tab='evidence' THEN state:=jsonb_set(state,'{content,nodes,0,completedReview,evidence}','""');END IF;
  IF tab='reverse' THEN state:=jsonb_set(state,'{content,nodes,0,completedReview,startedOn}','"2026-09-09"');END IF;
  IF tab='future' THEN state:=jsonb_set(state,'{content,nodes,0,completedReview,finishedOn}','"3000-01-01"');END IF;
  IF tab='work' THEN state:=jsonb_set(state,'{content,nodes,0,kind}','"work"');END IF;
  IF tab='missing' THEN state:=state#-'{content,nodes,0,completedReview,finishedOn}';END IF;
  IF tab='invalid' THEN state:=jsonb_set(state,'{content,nodes,0,completedReview,finishedOn}','"2026-02-31"');END IF;
  BEGIN PERFORM public.record_contract_command(engagement,owner_id,state);RAISE EXCEPTION 'Invalid completed review accepted: %',tab;EXCEPTION WHEN invalid_parameter_value OR datetime_field_overflow THEN NULL;END;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.contract_schedules WHERE engagement_id=engagement) THEN RAISE EXCEPTION 'Rejected review left history';END IF;
 `));
});
