import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
const setup=readFileSync("src/test/fixtures/contracts/setup.sql","utf8");
const master=`
 UPDATE public.invoicing_engagements SET engagement_kind='on_call' WHERE id=engagement;
 state:=c;
 c:=jsonb_build_object('kind','master_terms','requestId',gen_random_uuid(),'expectedVersion',0,'termsId',cost_rate,'currency','USD','ceiling','1500.00','startsOn','2026-01-01','endsOn','2026-12-31','terms','Synthetic shared authorization, not actual authority','sourceDocumentId',document);
 result:=public.record_contract_command(engagement,owner_id,c);
 again:=public.record_contract_command(engagement,owner_id,c);
 IF result<>again THEN RAISE EXCEPTION 'Master retry changed';END IF;
 PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','approve_master_terms','requestId',gen_random_uuid(),'expectedVersion',1,'termsId',cost_rate,'approvalEvidence','Synthetic documented approval'));
 INSERT INTO public.invoicing_engagements(id,workspace_id,client_id,project_id,title,parent_engagement_id,engagement_kind) VALUES(p,workspace,client,project,'Synthetic task order one',engagement,'task_order'),(element,workspace,client,project,'Synthetic task order two',engagement,'task_order');
 c:=state||jsonb_build_object('content',(state->'content')||jsonb_build_object('authorization',jsonb_build_object('startsOn','2026-01-01','endsOn','2026-12-31','beneficiary','Synthetic agency','costBasis','Synthetic documented basis')));
 PERFORM public.record_contract_command(p,owner_id,c);
 PERFORM public.record_contract_command(p,owner_id,jsonb_build_object('kind','approve','requestId',gen_random_uuid(),'baselineId',baseline,'expectedVersion',1,'approvalEvidence','Synthetic task authorization'));
 c:=c||jsonb_build_object('baselineId',billing_rate,'requestId',gen_random_uuid(),'content',(c->'content')||jsonb_build_object('tasks',jsonb_build_array((c->'content'->'tasks'->0)||jsonb_build_object('id',gen_random_uuid()),(c->'content'->'tasks'->1)||jsonb_build_object('id',gen_random_uuid()))));
 PERFORM public.record_contract_command(element,owner_id,c);
`;
function check(body:string) {
 if(!process.env.CI&&!process.env.OPENPLAN_SUPABASE_WORKDIR?.includes("m11-contract-verification"))throw new Error("Explicit disposable m11-contract-verification stack required");
 const mutation=process.env.OPENPLAN_CONTRACT_TEST_SQL?readFileSync(process.env.OPENPLAN_CONTRACT_TEST_SQL,"utf8"):"";
 const output=execFileSync("docker",["exec","-i",resolveLocalDbContainer(),"psql","-X","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1","-At"],{encoding:"utf8",input:`BEGIN;${mutation}\n${setup.replace("-- TEST_BODY",body)} SELECT 'MASTER_ASSERTIONS_REACHED'; ROLLBACK;`,stdio:["pipe","pipe","pipe"]});
 expect(output).toContain("MASTER_ASSERTIONS_REACHED");
}
(LIVE_RLS?describe:describe.skip)("master authorization database custody",()=>{
 it("keeps proposed ceilings separate and rejects cumulative task-order excess",()=>check(`${master}
 BEGIN PERFORM public.record_contract_command(element,owner_id,jsonb_build_object('kind','approve','requestId',gen_random_uuid(),'baselineId',billing_rate,'expectedVersion',1,'approvalEvidence','Synthetic')); RAISE EXCEPTION 'Shared ceiling exceeded'; EXCEPTION WHEN check_violation THEN NULL; END;
 PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','master_terms','requestId',gen_random_uuid(),'expectedVersion',1,'termsId',ow_entry,'currency','USD','ceiling','2500.00','startsOn','2026-01-01','endsOn','2026-12-31','terms','Proposed increase only','sourceDocumentId',document));
 BEGIN PERFORM public.record_contract_command(element,owner_id,jsonb_build_object('kind','approve','requestId',gen_random_uuid(),'baselineId',billing_rate,'expectedVersion',1,'approvalEvidence','Synthetic')); RAISE EXCEPTION 'Proposal increased authority'; EXCEPTION WHEN check_violation THEN NULL; END;
 PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','approve_master_terms','requestId',gen_random_uuid(),'expectedVersion',2,'termsId',ow_entry,'approvalEvidence','Synthetic approved increase'));
 PERFORM public.record_contract_command(element,owner_id,jsonb_build_object('kind','approve','requestId',gen_random_uuid(),'baselineId',billing_rate,'expectedVersion',1,'approvalEvidence','Synthetic'));
 IF (SELECT count(*) FROM public.contract_baselines cb WHERE cb.state='approved' AND engagement_id IN(p,element))<>2 THEN RAISE EXCEPTION 'Valid task orders not approved'; END IF;
 `));
 it("rejects term violations, unknown fee and cross-currency authorization",()=>check(`${master.replace("'1500.00'", "'2500.00'")}
 FOR tab IN SELECT unnest(ARRAY['period','fee','currency']) LOOP
  c:=c||jsonb_build_object('requestId',gen_random_uuid(),'baselineId',gen_random_uuid(),'expectedVersion',(SELECT max(version) FROM public.contract_baselines WHERE engagement_id=element),'content',(c->'content')||CASE tab WHEN 'period' THEN jsonb_build_object('authorization',jsonb_build_object('startsOn','2026-01-01','endsOn','2027-01-01')) WHEN 'fee' THEN jsonb_build_object('fee',NULL) ELSE jsonb_build_object('currency','CAD') END);
  BEGIN
   PERFORM public.record_contract_command(element,owner_id,c);
   PERFORM public.record_contract_command(element,owner_id,jsonb_build_object('kind','approve','requestId',gen_random_uuid(),'baselineId',c->>'baselineId','expectedVersion',(c->>'expectedVersion')::integer+1,'approvalEvidence','Synthetic'));
   RAISE EXCEPTION 'Invalid authorization accepted: %',tab;
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 END LOOP;
 `));
 it("retains evidence and denies members, actor spoofing and rewritten approvals",()=>check(`${master}
 BEGIN UPDATE public.contract_master_terms SET ceiling=9999 WHERE id=cost_rate; RAISE EXCEPTION 'Approved terms rewritten';EXCEPTION WHEN check_violation THEN NULL;END;
 BEGIN UPDATE public.kb_documents SET checksum=repeat('b',64) WHERE id=document; RAISE EXCEPTION 'Master source replaced';EXCEPTION WHEN check_violation THEN NULL;END;
 BEGIN PERFORM public.record_contract_command(engagement,member_id,jsonb_build_object('kind','master_terms','requestId',gen_random_uuid()));RAISE EXCEPTION 'Member wrote terms';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM set_config('request.jwt.claim.sub',member_id::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 IF EXISTS(SELECT 1 FROM public.contract_master_terms WHERE engagement_id=engagement) THEN RAISE EXCEPTION 'Private master terms leaked'; END IF;
 BEGIN PERFORM public.record_contract_command_v046(engagement,owner_id,c);RAISE EXCEPTION 'Legacy command spoofed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 EXECUTE 'RESET ROLE';
 state:=public.read_contract_management(engagement,owner_id);
 IF state->'masterTerms'->0->>'ceiling'<>'1500.00' THEN RAISE EXCEPTION 'Exact terms missing from read';END IF;
 `));
});
