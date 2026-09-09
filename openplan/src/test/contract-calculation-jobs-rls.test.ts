import { describe,expect,it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
const setup=readFileSync("src/test/fixtures/contracts/setup.sql","utf8");
const prepare=`PERFORM public.record_contract_command(engagement,owner_id,c);PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','approve','requestId',gen_random_uuid(),'baselineId',baseline,'expectedVersion',1,'approvalEvidence','Synthetic approval'));c:=jsonb_build_object('kind','forecast','requestId',gen_random_uuid(),'expectedInputHash',public.contract_delivery_hash(workspace),'asOf','2026-09-08','horizonEnd','2026-10-01','coverageComplete',true,'coverageEvidence','Synthetic coverage','reviewEvidence','Synthetic review');`;
function check(body:string){const mutation=process.env.OPENPLAN_CONTRACT_TEST_SQL?readFileSync(process.env.OPENPLAN_CONTRACT_TEST_SQL,"utf8"):"";const output=execFileSync("docker",["exec","-i",resolveLocalDbContainer(),"psql","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1"],{input:`BEGIN;${mutation}\n${setup.replace('-- TEST_BODY',body+"\nRAISE NOTICE 'CALCULATION_ASSERTIONS_REACHED';")}\nROLLBACK;`,encoding:"utf8",stdio:["pipe","pipe","pipe"]});expect(output).toContain("ROLLBACK");}
describe.skipIf(!LIVE_RLS)("durable contract calculation custody",()=>{
 it("recovers expired leases and atomically saves exactly one reviewed forecast",()=>check(`${prepare}
 result:=public.enqueue_contract_calculation(engagement,owner_id,c);report:=(result->>'jobId')::uuid;
 IF public.enqueue_contract_calculation(engagement,owner_id,c)<>result THEN RAISE EXCEPTION 'Queue retry duplicated';END IF;
 BEGIN PERFORM public.enqueue_contract_calculation(engagement,owner_id,c||jsonb_build_object('reviewEvidence','Changed'));RAISE EXCEPTION 'Queue retry changed';EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
 result:=public.claim_contract_calculation(p);IF result->>'id' IS DISTINCT FROM report::text OR public.claim_contract_calculation(element) IS NOT NULL THEN RAISE EXCEPTION 'Claim not exclusive';END IF;
 IF NOT public.renew_contract_calculation(report,p) OR public.renew_contract_calculation(report,element) THEN RAISE EXCEPTION 'Lease identity not enforced';END IF;
 UPDATE public.contract_calculation_jobs SET lease_until=now()-interval '1 minute' WHERE id=report;
 IF public.renew_contract_calculation(report,p) THEN RAISE EXCEPTION 'Expired lease revived';END IF;
 result:=public.claim_contract_calculation(element);IF result->>'id' IS DISTINCT FROM report::text OR (result->>'attempts')::integer<>2 THEN RAISE EXCEPTION 'Interrupted calculation not reclaimed';END IF;
 state:=c||jsonb_build_object('_request',c,'_inputHash',public.contract_delivery_hash(workspace),'_inputs',jsonb_build_object('synthetic',true),'_result',jsonb_build_object('finish','2026-09-13'));
 BEGIN PERFORM public.finish_contract_calculation(report,p,state);RAISE EXCEPTION 'Old worker committed';EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
 BEGIN PERFORM public.finish_contract_calculation(report,element,state||jsonb_build_object('_request',c||jsonb_build_object('reviewEvidence','Changed')));RAISE EXCEPTION 'Normalized request replaced';EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
 PERFORM public.finish_contract_calculation(report,element,state);
 IF (SELECT status FROM public.contract_calculation_jobs WHERE id=report)<>'succeeded' OR (SELECT count(*) FROM public.contract_forecasts WHERE engagement_id=engagement)<>1 OR (SELECT j.result FROM public.contract_calculation_jobs j WHERE id=report) IS NULL THEN RAISE EXCEPTION 'Completion was not atomic';END IF;
 BEGIN PERFORM public.finish_contract_calculation(report,element,state);RAISE EXCEPTION 'Completed job committed twice';EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
 IF public.enqueue_contract_calculation(engagement,owner_id,c)->>'status'<>'succeeded' THEN RAISE EXCEPTION 'Completed retry lost';END IF;
 `));
 it("refuses stale inputs and revoked actors and hides payloads from unrelated staff",()=>check(`${prepare}
 BEGIN PERFORM public.enqueue_contract_calculation(engagement,member_id,c);RAISE EXCEPTION 'Staff queued forecast';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.enqueue_contract_calculation(engagement,owner_id,c||jsonb_build_object('expectedInputHash',repeat('0',64)));RAISE EXCEPTION 'Stale browser queued';EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
 result:=public.enqueue_contract_calculation(engagement,owner_id,c);report:=(result->>'jobId')::uuid;PERFORM public.claim_contract_calculation(p);
 state:=c||jsonb_build_object('_request',c,'_inputHash',public.contract_delivery_hash(workspace),'_inputs','{}'::jsonb,'_result','{}'::jsonb);
 UPDATE public.invoicing_staff SET active=false WHERE id=staff;
 BEGIN PERFORM public.finish_contract_calculation(report,p,state);RAISE EXCEPTION 'Stale queued calculation committed';EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
 IF EXISTS(SELECT 1 FROM public.contract_forecasts WHERE engagement_id=engagement) OR (SELECT status FROM public.contract_calculation_jobs WHERE id=report)<>'running' THEN RAISE EXCEPTION 'Failed commit partially saved';END IF;
 UPDATE public.workspace_members SET role='owner' WHERE workspace_id=workspace AND user_id=member_id;
 UPDATE public.workspace_members SET role='member' WHERE workspace_id=workspace AND user_id=owner_id;
 BEGIN PERFORM public.finish_contract_calculation(report,p,state);RAISE EXCEPTION 'Revoked requester committed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM public.fail_contract_calculation(report,p);
 BEGIN PERFORM public.retry_contract_calculation(report,engagement,owner_id);RAISE EXCEPTION 'Revoked requester retried';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 UPDATE public.workspace_members SET role='owner' WHERE workspace_id=workspace AND user_id=owner_id;
 IF public.retry_contract_calculation(report,engagement,owner_id)->>'status'<>'queued' THEN RAISE EXCEPTION 'Authorized retry unavailable';END IF;
 PERFORM set_config('request.jwt.claim.sub',outsider::text,true);EXECUTE 'SET LOCAL ROLE authenticated';SELECT count(id) INTO n FROM public.contract_calculation_jobs;IF n<>0 THEN RAISE EXCEPTION 'Outside calculation metadata leaked';END IF;
 BEGIN PERFORM command FROM public.contract_calculation_jobs;RAISE EXCEPTION 'Private job request readable';EXCEPTION WHEN insufficient_privilege THEN NULL;END;EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);EXECUTE 'SET LOCAL ROLE authenticated';SELECT count(id) INTO n FROM public.contract_calculation_jobs;IF n<>1 THEN RAISE EXCEPTION 'Own calculation metadata missing';END IF;
 BEGIN PERFORM command FROM public.contract_calculation_jobs;RAISE EXCEPTION 'Original private payload exposed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;EXECUTE 'RESET ROLE';
 `));
});
