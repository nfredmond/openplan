import { describe,expect,it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
const setup=readFileSync("src/test/fixtures/contracts/setup.sql","utf8");
const baseline=`PERFORM public.record_contract_command(engagement,owner_id,c);PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','approve','requestId',gen_random_uuid(),'baselineId',baseline,'expectedVersion',1,'approvalEvidence','Synthetic approval'));`;
const deliver=`c:=jsonb_build_object('kind','deliverable_event','requestId',gen_random_uuid(),'expectedVersion',0,'deliverableId',deliverable,'state','submitted','date','2026-09-08','documentId',document,'authority','Synthetic author','evidence','Synthetic artifact submitted');`;
const close=`state:=jsonb_build_object('kind','closeout','requestId',gen_random_uuid(),'expectedVersion',0,'title','Synthetic closeout','asOf','2026-09-08','coverageComplete',false,'coverageEvidence','Synthetic unresolved coverage','workAccepted',false,'workAuthority','Unassessed','financialSettled',false,'financeAuthority','Unassessed','obligations',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'title','Synthetic ongoing obligation','status','open','owner','Synthetic agency','basis','Synthetic condition','dueOn',NULL)),'evidence','Synthetic closeout review');c:=state||jsonb_build_object('_request',state,'_inputHash',public.contract_closeout_hash(engagement),'_position',jsonb_build_object('workAccepted',false,'financialSettled',false),'_package',jsonb_build_object('formatVersion',1,'synthetic',true));`;
const financial=`INSERT INTO public.client_invoices(id,workspace_id,engagement_id,client_id,invoice_number,status,invoice_date,sent_date,subtotal_amount,total_amount,retention_amount,currency_code) VALUES(p,workspace,engagement,client,'SYNTH-01','sent','2026-09-01','2026-09-01',100,90,10,'USD');state:=jsonb_build_object('kind','settlement','requestId',gen_random_uuid(),'expectedVersion',0,'content',jsonb_build_object('eventId',entry,'sourceKey','SYNTH-POST-01','direction','outgoing','invoiceId',p,'invoiceVersion',(SELECT updated_at FROM public.client_invoices WHERE id=p),'date','2026-09-08','kind','payment','amount','25.01','currency','USD','state','recorded','documentId',document,'sourceReference','Synthetic accounting posting','correctionEvidence','','legacyActualId',NULL));c:=state||jsonb_build_object('_request',state,'_inputHash',public.contract_closeout_hash(engagement),'_position','[]'::jsonb);`;
function check(body:string){const mutation=process.env.OPENPLAN_CONTRACT_TEST_SQL?readFileSync(process.env.OPENPLAN_CONTRACT_TEST_SQL,"utf8"):"";const output=execFileSync("docker",["exec","-i",resolveLocalDbContainer(),"psql","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1"],{input:`BEGIN;${mutation}\n${setup.replace('-- TEST_BODY',body+"\nRAISE NOTICE 'CLOSEOUT_ASSERTIONS_REACHED';")}\nROLLBACK;`,encoding:"utf8",stdio:["pipe","pipe","pipe"]});expect(output).toContain("ROLLBACK");}
describe.skipIf(!LIVE_RLS)("contract settlement and closeout custody",()=>{
 it("accepts indexed retained originals for settlement and deliverable submission without admitting foreign files",()=>check(`${baseline}
 UPDATE public.kb_documents SET status='ready' WHERE id=document;
 ${financial}PERFORM public.record_contract_command(engagement,owner_id,c);
 IF NOT EXISTS(SELECT 1 FROM public.contract_settlement_events WHERE event_id=entry AND source_receipt->>'id'=document::text) THEN RAISE EXCEPTION 'Indexed settlement source not retained';END IF;
 ${deliver}PERFORM public.record_contract_command(engagement,member_id,c);
 IF NOT EXISTS(SELECT 1 FROM public.contract_deliverable_events WHERE deliverable_id=deliverable AND source_receipt->>'id'=document::text) THEN RAISE EXCEPTION 'Indexed submission source not retained';END IF;
 INSERT INTO public.workspaces(id,name,slug) VALUES(foreign_deliverable,'Synthetic foreign file owner',foreign_deliverable::text);
 INSERT INTO public.kb_documents(id,workspace_id,uploaded_by,title,source_kind,checksum,storage_ref,status) VALUES(element,foreign_deliverable,outsider,'Synthetic private original','uploaded_txt',repeat('c',64),'storage://kb-documents/'||foreign_deliverable||'/'||element||'/private.txt','ready');
 c:=c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',1,'documentId',element,'state','returned');
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c);RAISE EXCEPTION 'Foreign indexed source admitted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 `));
 it("separates submission, return, resubmission and authorized acceptance without rewriting the artifact",()=>check(`${baseline}${deliver}
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c||jsonb_build_object('state','accepted'));RAISE EXCEPTION 'Unsubmitted deliverable accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 result:=public.record_contract_command(engagement,member_id,c);
 BEGIN PERFORM public.record_contract_command(engagement,member_id,c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',1,'state','accepted'));RAISE EXCEPTION 'Staff accepted their own deliverable';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM public.record_contract_command(engagement,owner_id,c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',1,'state','returned'));
 PERFORM public.record_contract_command(engagement,member_id,c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',2,'state','resubmitted'));
 PERFORM public.record_contract_command(engagement,owner_id,c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',3,'state','accepted'));
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',3,'state','accepted'));RAISE EXCEPTION 'Stale acceptance allowed';EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c||jsonb_build_object('requestId',gen_random_uuid(),'deliverableId',foreign_deliverable));RAISE EXCEPTION 'Foreign deliverable accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN UPDATE public.kb_documents SET checksum=repeat('b',64) WHERE id=document;RAISE EXCEPTION 'Accepted artifact replaced';EXCEPTION WHEN check_violation THEN NULL;END;
 IF (SELECT count(*) FROM public.contract_deliverable_events WHERE engagement_id=engagement)<>4 THEN RAISE EXCEPTION 'Delivery history lost';END IF;
 `));
 it("records retry-safe financial sources without another cost and refuses duplicates or changed invoices",()=>check(`${baseline}${financial}
 BEGIN PERFORM public.record_contract_command(engagement,member_id,c);RAISE EXCEPTION 'Staff posted financial event';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 result:=public.record_contract_command(engagement,owner_id,c);again:=public.record_contract_command(engagement,owner_id,c);IF again<>result THEN RAISE EXCEPTION 'Financial retry changed';END IF;
 IF EXISTS(SELECT 1 FROM public.contract_actual_versions WHERE engagement_id=engagement) THEN RAISE EXCEPTION 'Settlement created another cost';END IF;
 BEGIN PERFORM public.record_contract_command(engagement,member_id,c||jsonb_build_object('requestId',gen_random_uuid(),'_request',state||jsonb_build_object('requestId',gen_random_uuid())));RAISE EXCEPTION 'Staff posted financial event';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 state:=state||jsonb_build_object('requestId',gen_random_uuid(),'content',(state->'content')||jsonb_build_object('eventId',gen_random_uuid()));c:=state||jsonb_build_object('_request',state,'_inputHash',public.contract_closeout_hash(engagement),'_position','[]'::jsonb);
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c);RAISE EXCEPTION 'Duplicate financial source accepted';EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
 state:=state||jsonb_build_object('requestId',gen_random_uuid(),'content',(state->'content')||jsonb_build_object('sourceKey','SYNTH-02','invoiceVersion','2000-01-01T00:00:00Z'));c:=state||jsonb_build_object('_request',state,'_inputHash',public.contract_closeout_hash(engagement),'_position','[]'::jsonb);
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c);RAISE EXCEPTION 'Changed invoice accepted';EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
 `));
 it("retains an unresolved closeout, freezes edits and reopens by a traceable immutable revision",()=>check(`${baseline}${close}
 result:=public.record_contract_command(engagement,owner_id,c);report:=(result->>'id')::uuid;original_hash:=(SELECT content_hash FROM public.contract_closeouts WHERE id=report);
 again:=public.record_contract_command(engagement,owner_id,c);IF result<>again THEN RAISE EXCEPTION 'Closeout retry changed';END IF;
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','estimate','requestId',gen_random_uuid(),'expectedVersion',0,'taskId',task,'asOf','2026-09-08','hours','0','cost','0','basis','Synthetic'));RAISE EXCEPTION 'Closed assignment changed';EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
 BEGIN INSERT INTO public.invoicing_time_entries(workspace_id,staff_id,engagement_id,entry_date,hours,created_by) VALUES(workspace,staff,engagement,'2026-09-08',1,owner_id);RAISE EXCEPTION 'Closed raw financial source changed';EXCEPTION WHEN check_violation THEN NULL;END;
 BEGIN UPDATE public.contract_closeouts SET content='{}' WHERE id=report;RAISE EXCEPTION 'Closeout history rewritten';EXCEPTION WHEN check_violation THEN NULL;END;
 c:=jsonb_build_object('kind','reopen','requestId',gen_random_uuid(),'expectedVersion',1,'closeoutId',report,'evidence','Synthetic obligation requires additional work');
 BEGIN PERFORM public.record_contract_command(engagement,member_id,c);RAISE EXCEPTION 'Staff reopened financial closeout';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM public.record_contract_command(engagement,owner_id,c);
 IF (SELECT previous_id FROM public.contract_closeouts WHERE engagement_id=engagement AND version=2) IS DISTINCT FROM report OR (SELECT content_hash FROM public.contract_closeouts WHERE id=report)<>original_hash THEN RAISE EXCEPTION 'Reopening lost prior custody';END IF;
 `));
 it("requires each reopened obligation to survive or receive new satisfaction evidence",()=>check(`${baseline}${close}
 result:=public.record_contract_command(engagement,owner_id,c);report:=(result->>'id')::uuid;
 PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','reopen','requestId',gen_random_uuid(),'expectedVersion',1,'closeoutId',report,'evidence','Synthetic reopen for review'));
 state:=state||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',2);
 c:=state||jsonb_build_object('_request',state,'_inputHash',public.contract_closeout_hash(engagement),'_position',jsonb_build_object('workAccepted',false,'financialSettled',false),'_package',jsonb_build_object('formatVersion',3,'synthetic',true));
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c||jsonb_build_object('obligations','[]'::jsonb,'_request',state||jsonb_build_object('obligations','[]'::jsonb)));RAISE EXCEPTION 'Prior obligation silently lost';EXCEPTION WHEN check_violation THEN NULL;END;
 again:=jsonb_set(state,'{obligations,0,status}','"satisfied"');
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c||again||jsonb_build_object('_request',again));RAISE EXCEPTION 'Obligation satisfied without new evidence';EXCEPTION WHEN check_violation THEN NULL;END;
 again:=jsonb_set(state,'{obligations}',jsonb_build_array(state->'obligations'->0,state->'obligations'->0));
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c||again||jsonb_build_object('_request',again));RAISE EXCEPTION 'Duplicate obligation identity admitted';EXCEPTION WHEN check_violation THEN NULL;END;
 result:=public.record_contract_command(engagement,owner_id,c);
 IF (SELECT content->'request'->'obligations' FROM public.contract_closeouts WHERE id=(result->>'id')::uuid) IS DISTINCT FROM state->'obligations' THEN RAISE EXCEPTION 'Carried obligation changed';END IF;
 `));
 it("refuses unsupported closeout claims, stale inputs and outsider reads from populated evidence streams",()=>check(`${baseline}${financial}PERFORM public.record_contract_command(engagement,owner_id,c);${deliver}PERFORM public.record_contract_command(engagement,member_id,c);${close}
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c||jsonb_build_object('workAccepted',true));RAISE EXCEPTION 'Unsupported work acceptance claimed';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.record_contract_command(engagement,owner_id,c||jsonb_build_object('_inputHash',repeat('0',64)));RAISE EXCEPTION 'Stale closeout accepted';EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
 PERFORM public.record_contract_command(engagement,owner_id,c);
 PERFORM set_config('request.jwt.claim.sub',outsider::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 FOREACH tab IN ARRAY ARRAY['contract_settlement_events','contract_deliverable_events','contract_closeouts'] LOOP EXECUTE format('SELECT count(*) FROM public.%I',tab) INTO n;IF n<>0 THEN RAISE EXCEPTION 'Outside closeout evidence leaked: %',tab;END IF;END LOOP;EXECUTE 'RESET ROLE';
 `));
 it("issues rate-safe PM snapshots and restricts finance packages across rows and export queue",()=>check(`${baseline}
 INSERT INTO public.contract_access_versions(engagement_id,workspace_id,user_id,role,active,version,evidence,created_by) VALUES(engagement,workspace,member_id,'pm',true,1,'Synthetic designated PM',owner_id);
 PERFORM public.record_contract_command(engagement,owner_id,jsonb_build_object('kind','rate','requestId',gen_random_uuid(),'rateId',cost_rate,'staffId',staff,'basis','cost','startsOn','2026-01-01','endsOn','2026-12-31','hourlyRate','123.45','sourceReference','PRIVATE FINANCE RATE'));
 c:=jsonb_build_object('kind','snapshot','requestId',gen_random_uuid(),'title','Synthetic finance snapshot','asOf','2026-09-08','sourceCutoff',now(),'coverageComplete',false,'coverageEvidence','Synthetic');
 result:=public.record_contract_command(engagement,owner_id,c);report:=(result->>'snapshotId')::uuid;
 BEGIN PERFORM public.enqueue_contract_snapshot(report,'pdf',member_id);RAISE EXCEPTION 'PM queued private finance report';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 result:=public.record_contract_command(engagement,member_id,c||jsonb_build_object('requestId',gen_random_uuid(),'title','Synthetic PM snapshot'));invoice:=(result->>'snapshotId')::uuid;
 IF (SELECT snapshot::text FROM public.contract_snapshots WHERE id=invoice) LIKE '%PRIVATE FINANCE RATE%' THEN RAISE EXCEPTION 'PM report leaked private rates';END IF;
 PERFORM public.enqueue_contract_snapshot(invoice,'pdf',member_id);
 PERFORM set_config('request.jwt.claim.sub',member_id::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 IF EXISTS(SELECT 1 FROM public.contract_snapshots WHERE id=report) OR NOT EXISTS(SELECT 1 FROM public.contract_snapshots WHERE id=invoice) THEN RAISE EXCEPTION 'PM report audience filter failed';END IF;EXECUTE 'RESET ROLE';
 SELECT id INTO entry FROM public.kb_documents WHERE contract_snapshot_id=invoice;
 IF NOT public.can_read_management_object(workspace::text||'/'||entry::text||'/synthetic.pdf') THEN RAISE EXCEPTION 'PM report storage access missing';END IF;
 SELECT id INTO ow_entry FROM public.kb_ocr_jobs WHERE document_id=entry;
 UPDATE public.kb_ocr_jobs SET status='running',lease_token=cost_rate,lease_until=now()+interval '1 minute' WHERE id=ow_entry;
 INSERT INTO public.contract_access_versions(engagement_id,workspace_id,user_id,role,active,version,evidence,created_by) VALUES(engagement,workspace,member_id,'pm',false,2,'Synthetic access revoked',owner_id);
 BEGIN PERFORM public.finish_work_program_export(ow_entry,cost_rate,repeat('d',64),100,'storage://kb-documents/'||workspace||'/'||entry||'/'||repeat('d',64)||'.pdf','synthetic');RAISE EXCEPTION 'Revoked PM export published';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 IF public.can_read_management_object(workspace::text||'/'||entry::text||'/synthetic.pdf') THEN RAISE EXCEPTION 'Revoked PM read private report storage';END IF;

 `));
 it("rejects mismatched history workspace and foreign closeout predecessors",()=>check(`${baseline}
 INSERT INTO public.workspaces(id,name,slug) VALUES(p,'Synthetic other workspace',p::text);
 BEGIN INSERT INTO public.contract_settlement_events(event_id,source_key,engagement_id,workspace_id,version,content,source_receipt,created_by) VALUES(entry,'Synthetic',engagement,p,1,'{}','{}',owner_id);RAISE EXCEPTION 'Wrong workspace history accepted';EXCEPTION WHEN check_violation THEN NULL;END;
 BEGIN INSERT INTO public.contract_closeouts(engagement_id,workspace_id,version,state,previous_id,input_hash,content,content_hash,created_by) VALUES(engagement,workspace,1,'reopened',gen_random_uuid(),repeat('a',64),'{}',repeat('a',64),owner_id);RAISE EXCEPTION 'Foreign closeout predecessor accepted';EXCEPTION WHEN check_violation THEN NULL;END;
 `));
});
