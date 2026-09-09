import { describe,expect,it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
const setup=readFileSync("src/test/fixtures/contracts/setup.sql","utf8");
const prepare=`PERFORM public.record_contract_command(engagement,owner_id,c);PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','approve','requestId',gen_random_uuid(),'baselineId',baseline,'expectedVersion',1,'approvalEvidence','Synthetic approval'));`;
const schedule=`c:=jsonb_build_object('kind','schedule','requestId',gen_random_uuid(),'expectedVersion',0,'content',jsonb_build_object('assumptions','Synthetic working assignment','billingTreatment','unassessed','nodes',jsonb_build_array(jsonb_build_object('id',element,'kind','work','taskId',task,'title','Synthetic work','notBefore','2026-09-08','reserveThrough','2026-09-08','calendar',jsonb_build_object('weekdays',jsonb_build_array(2),'exceptions','[]'::jsonb),'staff',jsonb_build_array(jsonb_build_object('staffId',staff,'hoursPerDay','4.00'))))));`;
function check(body:string){const mutation=process.env.OPENPLAN_CONTRACT_TEST_SQL?readFileSync(process.env.OPENPLAN_CONTRACT_TEST_SQL,"utf8"):"";const output=execFileSync("docker",["exec","-i",resolveLocalDbContainer(),"psql","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1"],{input:`BEGIN;${mutation}\n${setup.replace('-- TEST_BODY',body+"\nRAISE NOTICE 'STAFF_ASSIGNMENT_ASSERTIONS_REACHED';")}\nROLLBACK;`,encoding:"utf8",stdio:["pipe","pipe","pipe"]});expect(output).toContain("ROLLBACK");}
describe.skipIf(!LIVE_RLS)("current staff and working assignments",()=>{
 it("removes working assignments when a node is removed without rewriting the approved baseline",()=>check(`${prepare}${schedule}
 original_hash:=(SELECT content_hash FROM public.contract_baselines WHERE id=baseline);PERFORM public.record_contract_command(engagement,owner_id,c);
 IF NOT EXISTS(SELECT 1 FROM public.contract_task_assignments WHERE engagement_id=engagement AND active) THEN RAISE EXCEPTION 'Initial working assignment absent';END IF;
 c:=c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',1,'content',(c->'content')||jsonb_build_object('nodes','[]'::jsonb));PERFORM public.record_contract_command(engagement,owner_id,c);
 IF EXISTS(SELECT 1 FROM public.contract_task_assignments WHERE engagement_id=engagement AND active) OR jsonb_array_length(public.read_contract_delivery(engagement,owner_id)->'assignments')<>0 THEN RAISE EXCEPTION 'Removed node left an active assignment';END IF;
 IF (SELECT content_hash FROM public.contract_baselines WHERE id=baseline)<>original_hash OR (SELECT count(*) FROM public.contract_schedules WHERE engagement_id=engagement)<>2 THEN RAISE EXCEPTION 'Working schedule rewrote history';END IF;
 `));
 it("refuses new work and accepted reviews for a departed member while allowing a documented return",()=>check(`${prepare}
 c:=jsonb_build_object('kind','work_update','requestId',gen_random_uuid(),'expectedVersion',0,'content',jsonb_build_object('taskId',task,'staffId',staff,'asOf','2026-09-08','hours','1.00','availableHoursPerDay','8.00','status','in_progress','evidence','Synthetic submission'));result:=public.record_contract_command(engagement,member_id,c);report:=(result->>'id')::uuid;
 DELETE FROM public.workspace_members WHERE workspace_id=workspace AND user_id=member_id;
 IF public.read_contract_management(engagement,owner_id)->'staff'->0->>'active'<>'false' THEN RAISE EXCEPTION 'Departed staff still available';END IF;
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',1));RAISE EXCEPTION 'Departed staff received new work';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 ${schedule}
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c);RAISE EXCEPTION 'Departed staff was scheduled';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 c:=jsonb_build_object('kind','work_review','requestId',gen_random_uuid(),'expectedVersion',1,'updateId',report,'state','accepted','valuationEvidence','','evidence','Synthetic attempted acceptance');
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c);RAISE EXCEPTION 'Departed staff update accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 result:=public.record_contract_command(engagement,owner_id,c||jsonb_build_object('state','returned','evidence','Synthetic PM returns departed staff work for reassignment and reconciliation'));
 IF NOT EXISTS(SELECT 1 FROM public.contract_work_updates u WHERE u.id=(result->>'id')::uuid AND u.state='returned' AND reviewed_update_id=report) THEN RAISE EXCEPTION 'Departed staff return unavailable';END IF;
 `));
 it("lets the scoped PM choose a new active colleague without unrelated private rates",()=>check(`${prepare}
 INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(workspace,outsider,'member');
 INSERT INTO public.contract_access_versions(engagement_id,workspace_id,user_id,version,role,active,evidence,created_by) VALUES(engagement,workspace,outsider,1,'pm',true,'Synthetic PM',owner_id);
 INSERT INTO public.invoicing_staff(id,workspace_id,name,active) VALUES(p,workspace,'Synthetic new colleague',true);
 state:=public.read_contract_management(engagement,outsider);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(state->'staff') person WHERE person->>'id'=p::text) OR jsonb_array_length(state->'rates')<>0 THEN RAISE EXCEPTION 'Scoped PM cannot choose a new colleague privately';END IF;
 INSERT INTO public.contract_capacity_versions(engagement_id,workspace_id,staff_id,version,content,created_by) VALUES(engagement,workspace,p,1,jsonb_build_object('staffId',p,'startsOn','2026-09-01','endsOn','2026-09-30','hoursPerDay','8.00','calendar',jsonb_build_object('name','Synthetic explicit calendar','weekdays',jsonb_build_array(1,2,3,4,5),'exceptions','[]'::jsonb),'evidence','Synthetic shared availability'),owner_id);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.read_contract_delivery(engagement,outsider)->'capacityVersions') cap WHERE cap->>'staff_id'=p::text) THEN RAISE EXCEPTION 'New colleague availability unavailable for comparison';END IF;
 INSERT INTO public.kb_documents(id,workspace_id,uploaded_by,title,source_kind,checksum,storage_ref,status) VALUES(element,workspace,outsider,'Synthetic PM proposal source','uploaded_txt',repeat('c',64),'storage://kb-documents/'||workspace||'/'||element||'/synthetic.txt','stored'),(foreign_deliverable,workspace,owner_id,'PRIVATE UNRELATED FINANCE SOURCE','uploaded_txt',repeat('d',64),'storage://kb-documents/'||workspace||'/synthetic-private.txt','stored');
 state:=public.read_contract_management(engagement,outsider);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(state->'documents') d WHERE d->>'id'=element::text) OR state->'documents' @> jsonb_build_array(jsonb_build_object('id',foreign_deliverable)) THEN RAISE EXCEPTION 'PM proposal source scope incorrect';END IF;
 ${schedule}
 c:=jsonb_set(c,'{content,nodes,0,staff,0,staffId}',to_jsonb(p::text));PERFORM public.record_contract_command(engagement,outsider,c);
 IF NOT EXISTS(SELECT 1 FROM public.contract_task_assignments WHERE engagement_id=engagement AND staff_id=p AND active) THEN RAISE EXCEPTION 'Scoped PM reassignment unavailable';END IF;
 `));
 it("releases reservations of closed assignments and stales dependent forecasts",()=>check(`${prepare}${schedule}
 INSERT INTO public.invoicing_engagements(id,workspace_id,client_id,project_id,title) VALUES(p,workspace,client,other_project,'PRIVATE SECOND ASSIGNMENT');
 INSERT INTO public.contract_schedules(engagement_id,workspace_id,version,content,created_by) VALUES(p,workspace,1,c->'content',owner_id);
 IF jsonb_array_length(public.read_contract_delivery(engagement,owner_id)->'outsideReservations')<>1 THEN RAISE EXCEPTION 'Active outside reservation absent';END IF;
 original_hash:=public.contract_delivery_hash(workspace);
 INSERT INTO public.contract_closeouts(engagement_id,workspace_id,version,state,input_hash,content,content_hash,created_by) VALUES(p,workspace,1,'closed',repeat('a',64),'{}',repeat('b',64),owner_id);
 IF jsonb_array_length(public.read_contract_delivery(engagement,owner_id)->'outsideReservations')<>0 THEN RAISE EXCEPTION 'Closed assignment still reserved capacity';END IF;
 IF public.contract_delivery_hash(workspace)=original_hash THEN RAISE EXCEPTION 'Closure did not stale reservation inputs';END IF;
 `));
 it("retains mutable source changes and refuses a cutoff that cannot reconstruct them",()=>check(`${prepare}
 original_hash:=(SELECT content_hash FROM public.contract_baselines WHERE id=baseline);
 SELECT count(*) INTO observed FROM public.contract_source_changes WHERE workspace_id=workspace;
 UPDATE public.invoicing_staff SET name='Synthetic renamed staff' WHERE id=staff;
 IF (SELECT count(*) FROM public.contract_source_changes WHERE workspace_id=workspace)<>observed+1 THEN RAISE EXCEPTION 'Staff change was not retained';END IF;
 SELECT count(*) INTO observed FROM public.contract_source_changes WHERE workspace_id=workspace;
 DELETE FROM public.workspace_members WHERE workspace_id=workspace AND user_id=member_id;
 IF (SELECT count(*) FROM public.contract_source_changes WHERE workspace_id=workspace)<=observed THEN RAISE EXCEPTION 'Departed membership was not retained';END IF;
 INSERT INTO public.project_risks(project_id,title,created_by) VALUES(project,'Synthetic later review risk',owner_id);
 IF jsonb_array_length(public.read_contract_management(engagement,owner_id,now()-interval '1 second')->'responses'->'records')<>0 THEN RAISE EXCEPTION 'Later project response entered cutoff';END IF;
 IF (public.read_contract_management(engagement,owner_id,now()-interval '1 second')->>'cutoffConflicts')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Mutable inputs entered an earlier cutoff';END IF;
 IF (public.read_contract_management(engagement,owner_id,now())->>'cutoffConflicts')::boolean THEN RAISE EXCEPTION 'Current transaction cutoff was refused';END IF;
 IF (SELECT content_hash FROM public.contract_baselines WHERE id=baseline)<>original_hash THEN RAISE EXCEPTION 'Cutoff guard rewrote original baseline';END IF;
 PERFORM set_config('request.jwt.claim.sub',member_id::text,true);SET LOCAL ROLE authenticated;
 BEGIN PERFORM 1 FROM public.contract_source_changes;RAISE EXCEPTION 'Private change timing exposed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 RESET ROLE;
 `));

});
