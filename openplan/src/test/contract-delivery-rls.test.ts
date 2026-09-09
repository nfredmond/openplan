import { describe,expect,it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
const setup=readFileSync("src/test/fixtures/contracts/setup.sql","utf8");
const baseline=`PERFORM public.record_contract_command(engagement,owner_id,c);PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','approve','requestId',gen_random_uuid(),'baselineId',baseline,'expectedVersion',1,'approvalEvidence','Synthetic approval'));`;
const update=`c:=jsonb_build_object('kind','work_update','requestId',gen_random_uuid(),'expectedVersion',0,'content',jsonb_build_object('taskId',task,'staffId',staff,'asOf','2026-09-08','hours','8.01','availableHoursPerDay','8.00','status','in_progress','actualStart','2026-09-01','actualFinish',NULL,'blockers','','evidence','Synthetic remaining work'));result:=public.record_contract_command(engagement,member_id,c);`;
function check(body:string){const mutation=process.env.OPENPLAN_CONTRACT_TEST_SQL?readFileSync(process.env.OPENPLAN_CONTRACT_TEST_SQL,"utf8"):"";const output=execFileSync("docker",["exec","-i",resolveLocalDbContainer(),"psql","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1"],{input:`BEGIN;${mutation}\n${setup.replace('-- TEST_BODY',body+"\nRAISE NOTICE 'DELIVERY_ASSERTIONS_REACHED';")}\nROLLBACK;`,encoding:"utf8",stdio:["pipe","pipe","pipe"]});expect(output).toContain("ROLLBACK");}
describe.skipIf(!LIVE_RLS)("contract reviewed delivery authority",()=>{
 it("binds staff submissions, exact-version PM decisions and immutable review history",()=>check(`${baseline}${update}
 again:=public.record_contract_command(engagement,member_id,c);IF again<>result THEN RAISE EXCEPTION 'Work retry changed';END IF;
 BEGIN PERFORM public.record_contract_command(engagement,outsider,c||jsonb_build_object('requestId',gen_random_uuid()));RAISE EXCEPTION 'Outsider submitted staff work';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 state:=jsonb_build_object('kind','work_review','requestId',gen_random_uuid(),'expectedVersion',1,'updateId',result->>'id','state','accepted','remainingCost','100.01','remainingGrossBilling','200.02','valuationEvidence','Synthetic explicit valuation','evidence','Synthetic PM approval');
 BEGIN PERFORM public.record_contract_command(engagement,member_id,state);RAISE EXCEPTION 'Staff approved their update';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM public.record_contract_command(engagement,owner_id,state);
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,state||jsonb_build_object('requestId',gen_random_uuid()));RAISE EXCEPTION 'Stale work review accepted';EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
 state:=public.read_contract_management(engagement,member_id);
 IF state->'delivery'->'workUpdates'->1 ? 'remaining_cost' THEN RAISE EXCEPTION 'Staff saw private valuation';END IF;
 IF state->'delivery'->'workUpdates'->1->>'state'<>'accepted' THEN RAISE EXCEPTION 'Reviewed work missing';END IF;
 BEGIN UPDATE public.contract_work_updates SET evidence='Rewritten' WHERE id=(result->>'id')::uuid;RAISE EXCEPTION 'Reviewed history rewritten';EXCEPTION WHEN check_violation THEN NULL;END;
 PERFORM set_config('request.jwt.claim.sub',member_id::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 BEGIN PERFORM remaining_cost FROM public.contract_work_updates;RAISE EXCEPTION 'Direct valuation leaked';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 EXECUTE 'RESET ROLE';
 `));
 it("retains forecast inputs, rejects concurrent input changes and makes exact retries safe",()=>check(`${baseline}${update}
 original_hash:=public.contract_delivery_hash(workspace);
 state:=jsonb_build_object('kind','forecast','requestId',gen_random_uuid(),'asOf','2026-09-08','horizonEnd','2026-09-30','coverageComplete',false,'coverageEvidence','Synthetic unknown source coverage','reviewEvidence','Synthetic reviewed diagnostic');
 c:=state||jsonb_build_object('_request',state,'_inputHash',original_hash,'_inputs',jsonb_build_object('synthetic',true),'_result',jsonb_build_object('finish',NULL,'formatVersion',1));
 result:=public.record_contract_command(engagement,owner_id,c);
 UPDATE public.invoicing_staff SET active=false WHERE id=staff;
 IF original_hash=public.contract_delivery_hash(workspace) THEN RAISE EXCEPTION 'Departed staff did not stale forecast';END IF;
 again:=public.record_contract_command(engagement,owner_id,c);IF result<>again THEN RAISE EXCEPTION 'Exact forecast retry changed';END IF;
 state:=state||jsonb_build_object('requestId',gen_random_uuid());c:=c||state||jsonb_build_object('_request',state);
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c);RAISE EXCEPTION 'Concurrent forecast changes accepted';EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
 BEGIN UPDATE public.contract_forecasts SET input_hash='replacement' WHERE id=(result->>'id')::uuid;RAISE EXCEPTION 'Forecast history rewritten';EXCEPTION WHEN check_violation THEN NULL;END;
 PERFORM set_config('request.jwt.claim.sub',outsider::text,true);EXECUTE 'SET LOCAL ROLE authenticated';IF EXISTS(SELECT 1 FROM public.contract_forecasts) THEN RAISE EXCEPTION 'Outsider saw forecast';END IF;EXECUTE 'RESET ROLE';
 `));
 it("enforces staff and task relationships for schedules and shared capacity",()=>check(`${baseline}
 c:=jsonb_build_object('kind','capacity','requestId',gen_random_uuid(),'expectedVersion',0,'content',jsonb_build_object('staffId',staff,'startsOn','2026-09-01','endsOn','2026-10-01','hoursPerDay','8.00','calendar',jsonb_build_object('name','Synthetic','weekdays',jsonb_build_array(1,2,3,4,5),'exceptions','[]'::jsonb),'evidence','Synthetic shared availability'));
 PERFORM public.record_contract_command(engagement,owner_id,c);
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c||jsonb_build_object('requestId',gen_random_uuid()));RAISE EXCEPTION 'Stale capacity accepted';EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c||jsonb_build_object('requestId',gen_random_uuid(),'content',(c->'content')||jsonb_build_object('staffId',outsider)));RAISE EXCEPTION 'Foreign capacity accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 c:=jsonb_build_object('kind','schedule','requestId',gen_random_uuid(),'expectedVersion',0,'content',jsonb_build_object('assumptions','Synthetic sequencing','billingTreatment','unassessed','nodes',jsonb_build_array(jsonb_build_object('id',p,'taskId',task,'staff',jsonb_build_array(jsonb_build_object('staffId',staff))))));
 result:=public.record_contract_command(engagement,owner_id,c);
 IF public.read_contract_management(engagement,owner_id)->'delivery'->'scheduleVersions'->0->>'id'<>result->>'id' THEN RAISE EXCEPTION 'Schedule missing from read';END IF;
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',1,'content',(c->'content')||jsonb_build_object('nodes',jsonb_build_array(jsonb_build_object('id',p,'taskId',outsider,'staff','[]'::jsonb)))));RAISE EXCEPTION 'Foreign schedule task accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 `));
 it("exposes shared reservations without private assignment details and denies outsiders every delivery stream",()=>check(`${baseline}${update}
 INSERT INTO public.invoicing_engagements(id,workspace_id,client_id,project_id,title) VALUES(p,workspace,client,other_project,'PRIVATE OTHER ASSIGNMENT');
 INSERT INTO public.contract_schedules(engagement_id,workspace_id,version,content,created_by) VALUES(p,workspace,1,jsonb_build_object('assumptions','PRIVATE CLIENT NARRATIVE','nodes',jsonb_build_array(jsonb_build_object('id',element,'taskId',task2,'notBefore','2026-09-08','reserveThrough','2026-09-08','calendar',jsonb_build_object('weekdays',jsonb_build_array(2),'exceptions','[]'::jsonb),'staff',jsonb_build_array(jsonb_build_object('staffId',staff,'hoursPerDay','4.01'))))),owner_id);
 INSERT INTO public.contract_capacity_versions(engagement_id,workspace_id,staff_id,version,content,created_by) VALUES(p,workspace,staff,1,jsonb_build_object('staffId',staff,'startsOn','2026-09-01','endsOn','2026-09-30','hoursPerDay','8.00','evidence','PRIVATE CAPACITY NARRATIVE'),owner_id);
 state:=public.read_contract_delivery(engagement,owner_id);
 IF state->'outsideReservations'->0->>'hours'<>'4.01' OR jsonb_array_length(state->'outsideReservations')<>1 THEN RAISE EXCEPTION 'Shared reservation hours missing';END IF;
 IF state::text LIKE '%PRIVATE%' OR state::text LIKE '%'||p::text||'%' THEN RAISE EXCEPTION 'Confidential assignment details leaked';END IF;
 INSERT INTO public.contract_forecasts(engagement_id,workspace_id,version,input_hash,content,created_by) VALUES(engagement,workspace,1,public.contract_delivery_hash(workspace),'{}',owner_id);
 original_hash:=public.contract_delivery_hash(workspace);
 INSERT INTO public.invoicing_time_entries(workspace_id,staff_id,engagement_id,entry_date,hours,created_by) VALUES(workspace,staff,engagement,'2026-09-08',1,owner_id);
 IF public.contract_delivery_hash(workspace)=original_hash THEN RAISE EXCEPTION 'Unreconciled physical time did not stale forecast';END IF;
 PERFORM set_config('request.jwt.claim.sub',outsider::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 FOREACH tab IN ARRAY ARRAY['contract_schedules','contract_capacity_versions','contract_work_updates','contract_forecasts'] LOOP EXECUTE format('SELECT count(*) FROM public.%I',tab) INTO n;IF n<>0 THEN RAISE EXCEPTION 'Outside delivery stream leaked: %',tab;END IF;END LOOP;
 EXECUTE 'RESET ROLE';
 `));

});
