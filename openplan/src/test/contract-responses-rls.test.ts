import { describe,expect,it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
const setup=readFileSync("src/test/fixtures/contracts/setup.sql","utf8");
const prepare=`PERFORM public.record_contract_command(engagement,owner_id,c);PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','approve','requestId',gen_random_uuid(),'baselineId',baseline,'expectedVersion',1,'approvalEvidence','Synthetic approval'));INSERT INTO public.project_issues(id,project_id,title) VALUES(element,project,'Synthetic added work');INSERT INTO public.contract_forecasts(id,engagement_id,workspace_id,version,input_hash,content,created_by) VALUES(p,engagement,workspace,1,public.contract_delivery_hash(workspace),jsonb_build_object('result',jsonb_build_object('finish','2026-09-13')),owner_id);state:=jsonb_build_object('kind','response','requestId',gen_random_uuid(),'forecastId',p,'recordType','issue','recordId',element,'recordUpdatedAt',(SELECT updated_at FROM public.project_issues WHERE id=element),'recordHash',(SELECT encode(extensions.digest(to_jsonb(source)::text,'sha256'),'hex') FROM public.project_issues source WHERE id=element),'schedule',jsonb_build_object('assumptions','Synthetic revised sequencing','billingTreatment','unassessed','nodes','[]'::jsonb),'workAssumptions',jsonb_build_array(jsonb_build_object('synthetic','PM scenario only')),'evidence','Synthetic response');c:=state||jsonb_build_object('_request',state,'_inputHash',public.contract_delivery_hash(workspace),'_comparison',jsonb_build_object('request',state,'before',jsonb_build_object('finish','2026-09-13'),'after',jsonb_build_object('finish','2026-09-18')));`;
function check(body:string){const mutation=process.env.OPENPLAN_CONTRACT_TEST_SQL?readFileSync(process.env.OPENPLAN_CONTRACT_TEST_SQL,"utf8"):"";const output=execFileSync("docker",["exec","-i",resolveLocalDbContainer(),"psql","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1"],{input:`BEGIN;${mutation}\n${setup.replace('-- TEST_BODY',body+"\nRAISE NOTICE 'RESPONSE_ASSERTIONS_REACHED';")}\nROLLBACK;`,encoding:"utf8",stdio:["pipe","pipe","pipe"]});expect(output).toContain("ROLLBACK");}
describe.skipIf(!LIVE_RLS)("contract response source custody",()=>{
 it("retains an exact comparison and applies only its working schedule",()=>check(`${prepare}
 result:=public.record_contract_command(engagement,owner_id,c);report:=(result->>'id')::uuid;
 IF public.record_contract_command(engagement,owner_id,c)<>result THEN RAISE EXCEPTION 'Response retry changed';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.contract_management_responses WHERE id=report AND content->'sourceRecord'->>'title'='Synthetic added work') THEN RAISE EXCEPTION 'Exact project response record missing';END IF;
 original_hash:=(SELECT content_hash FROM public.contract_baselines WHERE id=baseline);
 c:=jsonb_build_object('kind','apply_response','requestId',gen_random_uuid(),'responseId',report,'expectedVersion',0,'evidence','Synthetic PM working decision');PERFORM public.record_contract_command(engagement,owner_id,c);
 IF (SELECT count(*) FROM public.contract_response_applications WHERE response_id=report)<>1 OR (SELECT count(*) FROM public.contract_schedules WHERE engagement_id=engagement)<>1 THEN RAISE EXCEPTION 'Working response was not applied';END IF;
 IF EXISTS(SELECT 1 FROM public.contract_work_updates WHERE engagement_id=engagement) THEN RAISE EXCEPTION 'PM assumptions became accepted staff work';END IF;
 IF (SELECT content_hash FROM public.contract_baselines WHERE id=baseline)<>original_hash THEN RAISE EXCEPTION 'Response changed contractual approval';END IF;
 BEGIN UPDATE public.contract_management_responses SET content='{}' WHERE id=report;RAISE EXCEPTION 'Response history rewritten';EXCEPTION WHEN check_violation THEN NULL;END;
 PERFORM set_config('request.jwt.claim.sub',outsider::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 FOREACH tab IN ARRAY ARRAY['contract_management_responses','contract_response_applications'] LOOP EXECUTE format('SELECT count(*) FROM public.%I',tab) INTO n;IF n<>0 THEN RAISE EXCEPTION 'Outside response evidence leaked: %',tab;END IF;END LOOP;EXECUTE 'RESET ROLE';
 `));
 it("refuses stale forecast inputs, changed project records and staff execution",()=>check(`${prepare}
 BEGIN PERFORM public.record_contract_command(engagement,member_id,c);RAISE EXCEPTION 'Staff recorded PM response';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c||jsonb_build_object('_inputHash',repeat('0',64)));RAISE EXCEPTION 'Stale response accepted';EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
 result:=public.record_contract_command(engagement,owner_id,c);report:=(result->>'id')::uuid;
 UPDATE public.project_issues SET title='Synthetic changed decision',updated_at=now()+interval '1 second' WHERE id=element;
 c:=jsonb_build_object('kind','apply_response','requestId',gen_random_uuid(),'responseId',report,'expectedVersion',0,'evidence','Synthetic stale response');
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c);RAISE EXCEPTION 'Changed project decision applied';EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
 `));
});
