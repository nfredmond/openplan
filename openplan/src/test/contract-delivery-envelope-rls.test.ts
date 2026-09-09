import {describe,it,expect} from "vitest";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {LIVE_RLS} from "./local-supabase-env";
import {resolveLocalDbContainer} from "./helpers/live-catalog";
const setup=readFileSync("src/test/fixtures/contracts/setup.sql","utf8");
const approved=`PERFORM public.record_contract_command(engagement,owner_id,c);PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','approve','requestId',gen_random_uuid(),'expectedVersion',1,'baselineId',baseline,'approvalEvidence','Synthetic envelope test'));`;
const request=`state:=jsonb_build_object('kind','forecast','requestId',gen_random_uuid(),'expectedInputHash',public.contract_delivery_hash(workspace),'asOf','2026-09-08','horizonEnd','2026-09-30','coverageComplete',false,'coverageEvidence','Synthetic','reviewEvidence','Synthetic envelope verification');c:=state||jsonb_build_object('_request',state,'_inputHash',public.contract_delivery_hash(workspace),'_inputs',jsonb_build_object('synthetic',true),'_result',jsonb_build_object('finish',NULL,'formatVersion',3));`;
function check(body:string){
 const mutation=process.env.OPENPLAN_CONTRACT_TEST_SQL?readFileSync(process.env.OPENPLAN_CONTRACT_TEST_SQL,"utf8"):"";
 const output=execFileSync("docker",["exec","-i",resolveLocalDbContainer(),"psql","-X","-U","postgres","-v","ON_ERROR_STOP=1"],{input:`BEGIN;${mutation}\n${setup.replace('-- TEST_BODY',approved+request+body)}\nROLLBACK;`,encoding:"utf8",stdio:["pipe","pipe","pipe"],timeout:45_000});expect(output).toContain("ROLLBACK");
}
describe.skipIf(!LIVE_RLS)("calculated forecast evidence envelope",()=>{
 it("retains calculated evidence above the old limit and replays its exact original request",()=>check(`
 c:=jsonb_set(c,'{_inputs}',jsonb_build_object('synthetic',true,'sourceText',repeat('s',8100000)));
 result:=public.record_contract_command(engagement,owner_id,c);again:=public.record_contract_command(engagement,owner_id,c);
 IF result IS DISTINCT FROM again OR (SELECT count(*) FROM public.contract_forecasts WHERE engagement_id=engagement)<>1 THEN RAISE EXCEPTION 'Envelope retry duplicated evidence';END IF;
 IF (SELECT length(content->'inputs'->>'sourceText') FROM public.contract_forecasts WHERE engagement_id=engagement)<>8100000 THEN RAISE EXCEPTION 'Envelope truncated source evidence';END IF;
 `),45_000);
 it("keeps the original submitted request and other delivery commands within 8 MB",()=>check(`
 state:=state||jsonb_build_object('sourceText',repeat('s',8100000));c:=c||jsonb_build_object('_request',state);
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c);RAISE EXCEPTION 'Oversized original request accepted';EXCEPTION WHEN SQLSTATE '22023' THEN IF SQLERRM NOT LIKE 'Delivery evidence exceeds%' THEN RAISE;END IF;END;
 c:=jsonb_build_object('kind','capacity','requestId',gen_random_uuid(),'_request','{}'::jsonb,'sourceText',repeat('s',8100000));
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c);RAISE EXCEPTION 'Oversized capacity request accepted';EXCEPTION WHEN SQLSTATE '22023' THEN IF SQLERRM NOT LIKE 'Delivery evidence exceeds%' THEN RAISE;END IF;END;
 IF EXISTS(SELECT 1 FROM public.contract_forecasts WHERE engagement_id=engagement) THEN RAISE EXCEPTION 'Refused request left a forecast';END IF;
 `),45_000);
 it("refuses a normalized forecast beyond 96 MB without retaining a partial result",()=>check(`
 c:=jsonb_set(c,'{_inputs}',jsonb_build_object('synthetic',true,'sourceText',repeat('s',96000000)));
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c);RAISE EXCEPTION 'Oversized normalized forecast accepted';EXCEPTION WHEN SQLSTATE '22023' THEN IF SQLERRM NOT LIKE 'Delivery evidence exceeds%' THEN RAISE;END IF;END;
 IF EXISTS(SELECT 1 FROM public.contract_forecasts WHERE engagement_id=engagement) THEN RAISE EXCEPTION 'Refused forecast left partial evidence';END IF;
 `),45_000);
});
