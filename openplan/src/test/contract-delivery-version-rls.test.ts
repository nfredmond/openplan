import {describe,it,expect} from "vitest";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {LIVE_RLS} from "./local-supabase-env";
import {resolveLocalDbContainer} from "./helpers/live-catalog";
const setup=readFileSync("src/test/fixtures/contracts/setup.sql","utf8");
function check(body:string){
 const mutation=process.env.OPENPLAN_CONTRACT_TEST_SQL?readFileSync(process.env.OPENPLAN_CONTRACT_TEST_SQL,"utf8"):"";
 const output=execFileSync("docker",["exec","-i",resolveLocalDbContainer(),"psql","-X","-U","postgres","-v","ON_ERROR_STOP=1"],{input:`BEGIN;${mutation}\n${setup.replace('-- TEST_BODY',body)}\nROLLBACK;`,encoding:"utf8",stdio:["pipe","pipe","pipe"]});expect(output).toContain("ROLLBACK");
}
describe.skipIf(!LIVE_RLS)("contract delivery read custody",()=>{
 it("returns the authorized current hash alone and denies other actors and direct authenticated execution",()=>check(`
 result:=public.read_contract_delivery_version(engagement,owner_id);
 IF result IS DISTINCT FROM jsonb_build_object('inputHash',public.contract_delivery_hash(workspace)) THEN RAISE EXCEPTION 'Version read is not the exact current hash alone';END IF;
 UPDATE public.invoicing_staff SET active=false WHERE id=staff;
 again:=public.read_contract_delivery_version(engagement,owner_id);
 IF again=result THEN RAISE EXCEPTION 'Source change did not change the version read';END IF;
 BEGIN PERFORM public.read_contract_delivery_version(engagement,outsider);RAISE EXCEPTION 'Outsider read delivery version';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.read_contract_delivery_version(engagement,member_id);RAISE EXCEPTION 'Member read management version';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.read_contract_delivery_version(engagement,NULL);RAISE EXCEPTION 'Missing actor read delivery version';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 BEGIN PERFORM public.read_contract_delivery_version(engagement,owner_id);RAISE EXCEPTION 'Authenticated caller used service RPC';EXCEPTION WHEN insufficient_privilege THEN NULL;END;EXECUTE 'RESET ROLE';
 `));
 it("retains identical delivery history in the outer management read, including original forecast inputs",()=>check(`
 PERFORM public.record_contract_command(engagement,owner_id,c);
 PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','approve','requestId',gen_random_uuid(),'baselineId',baseline,'expectedVersion',1,'approvalEvidence','Synthetic reader custody'));
 state:=jsonb_build_object('kind','forecast','requestId',gen_random_uuid(),'asOf','2026-09-08','horizonEnd','2026-09-30','coverageComplete',false,'coverageEvidence','Synthetic','reviewEvidence','Synthetic');
 c:=state||jsonb_build_object('_request',state,'_inputHash',public.contract_delivery_hash(workspace),'_inputs',jsonb_build_object('synthetic','full retained evidence'),'_result',jsonb_build_object('finish',NULL,'formatVersion',3));
 PERFORM public.record_contract_command(engagement,owner_id,c);
 result:=public.read_contract_management(engagement,owner_id);
 IF result->'delivery' IS DISTINCT FROM public.read_contract_delivery(engagement,owner_id) THEN RAISE EXCEPTION 'Management delivery history changed';END IF;
 IF result->'delivery'->'forecasts'->0->'content'->'inputs' IS DISTINCT FROM c->'_inputs' THEN RAISE EXCEPTION 'Retained inputs missing from management history';END IF;
 result:=public.read_contract_management(engagement,member_id);
 IF result->'delivery' IS DISTINCT FROM public.read_contract_delivery(engagement,member_id) THEN RAISE EXCEPTION 'Member delivery projection changed';END IF;
 `));
});
