"""Exercise scoped work entry, queue completeness, and closed-assignment controls.

These controls do not establish visual acceptance or external email delivery.
"""
from pathlib import Path
import json,os,subprocess
root=Path(__file__).resolve().parents[2];results=[]
unit=['src/test/my-work-page.test.tsx','src/test/my-work-board.test.tsx','src/test/contract-pending-my-work.test.ts','src/test/contract-participant-work.test.tsx','src/test/contract-review-layout.test.tsx']
def run(name,tests,env,reason=None):
 p=subprocess.run(['npm','exec','--','vitest','run',*tests],cwd=root,env=env,capture_output=True,text=True);out=p.stdout+p.stderr;Path('/tmp/openplan-m11-'+name+'.log').write_text(out)
 assert (p.returncode==0 if reason is None else p.returncode!=0 and reason in out),name+'\n'+out[-4000:]
 results.append({'name':name,'outcome':'survived' if reason is None else 'killed','reason':reason});print(name,results[-1]['outcome'],flush=True)
 (root.parent/'docs/reviews/2026-09-08-m11-delivery/work-queue-controls.json').write_text(json.dumps(results,indent=2)+'\n')
for name,file,old,new,reason in [
 ('harmless-queue-comment','src/lib/invoicing/contracts/participant-work.ts','/** Reads only','/** Explicit assignments. Reads only',None),
 ('hide-unknown-participant-work','src/components/my-work/contract-participant-work.tsx','!work.complete?<p role=','false?<p role=','renders the scoped invoice entry'),
 ('omit-forecast-parent-link','src/components/invoicing/contracts/delivery-management.tsx','<ForecastTable result={f.content.result} engagementId={state.engagement.id}/>','<ForecastTable result={f.content.result}/>','retained forecast warnings link'),
 ('skip-external-entry','src/app/(app)/my-work/page.tsx','if(!participantWork.complete||participantWork.rows.length)','if(false)','loads explicitly shared assignments'),
 ('skip-member-external-entry','src/app/(app)/my-work/page.tsx','participantWork={participantWork}','', 'retains scoped consultant work'),
 ('participant-service-client','src/app/(app)/my-work/page.tsx','loadParticipantWork(supabase)','loadParticipantWork(createServiceRoleClient())','loads explicitly shared assignments'),
 ('participant-partial-list','src/lib/invoicing/contracts/participant-work.ts','rows:result.complete?result.rows:[]','rows:result.rows','reads every capped participant page'),
 ('participant-no-order','src/lib/invoicing/contracts/participant-work.ts','.order("id")','','reads every capped participant page'),
 ('participant-destination','src/components/my-work/contract-participant-work.tsx','?tab=received','?tab=remaining','renders the scoped invoice entry'),
 ('ignore-contract-read-failure','src/components/my-work/my-work-board.tsx',', "contract_work_reviews", "contract_pending_reviews"','', 'does not claim an empty contract review section'),
 ('hide-remaining-review','src/lib/my-work/sources.ts','sourceId:"contract_work_reviews",block:"needs_review"','sourceId:"contract_work_reviews",block:"undated"','routes submitted remaining-work reviews'),
 ('misroute-accounting-review','src/lib/my-work/sources.ts','kind==="accounting"?"accounting"','kind==="accounting"?"remaining"','reads scoped retained versions'),
 ('inactive-source-read','src/lib/my-work/sources.ts','table: "contract_active_tasks_my_work"','table: "contract_task_assignments"','reads active contract tasks'),
 ('omit-accounting-navigation','src/components/invoicing/contracts/contract-management.tsx',',accounting:"Accounting"','','opens the accounting reconciliation form'),
 ('consultant-dead-end','src/components/invoicing/contracts/contract-management.tsx','state.role!=="consultant"&&<Link className="underline" href={`/projects/','true&&<Link className="underline" href={`/projects/','gives external consultants'),
]:
 path=root/file;original=path.read_text();assert old in original,name
 try:path.write_text(original.replace(old,new));run(name,unit,os.environ,reason)
 finally:path.write_text(original)
sql=(root/'supabase/migrations/20260926000001_contract_participant_and_accounting_work.sql').read_text()
for name,old,new,reason in [
 ('harmless-queue-sql','-- Narrow caller','-- Caller-bound visibility.\n-- Narrow caller',None),
 ('unscoped-participant-sql',"SELECT public.contract_actor_role(p_engagement_id,auth.uid())='consultant';",'SELECT true;', 'Participant grant or own return count incorrect'),
 ('other-participant-return','AND i.submitted_by=auth.uid()','', 'Participant grant or own return count incorrect'),
 ('old-return-resurfaces','AND NOT EXISTS(SELECT 1 FROM public.contract_received_invoices newer WHERE newer.invoice_id=i.invoice_id AND newer.version>i.version)) AS returned_invoices',') AS returned_invoices','Old returned invoice resurfaced'),
 ('private-accounting-status','WHEN public.contract_can_finance(v.engagement_id)','WHEN true','PM learned private accounting source state'),
 ('old-accounting-review','ORDER BY r.version DESC LIMIT 1','ORDER BY r.version ASC LIMIT 1','Old unresolved accounting row resurfaced'),
 ('ignore-open-discrepancy',"reviewed.state IS DISTINCT FROM 'reconciled'",'false','Reopened source discrepancy missing'),
 ('ignore-new-source-version','OR EXISTS(SELECT 1 FROM public.contract_actual_versions newer WHERE newer.entry_id=actual.entry_id AND newer.version>actual.version)','', 'Changed reconciled source missing from queue'),
 ('show-inactive-assignment','WHERE a.active AND public.contract_open_for_work','WHERE public.contract_open_for_work','Inactive staff assignment shown'),
 ('show-closed-assignment',"coalesce((SELECT c.state<>'closed' FROM public.contract_closeouts c WHERE c.engagement_id=p_engagement_id ORDER BY c.version DESC LIMIT 1),true)",'true','Closed staff assignment remained active'),
 ('old-closeout-controls-active','ORDER BY c.version DESC LIMIT 1','ORDER BY c.version ASC LIMIT 1','Reopened staff assignment not restored'),
 ('foreign-open-status','WHEN public.contract_actor_role(p_engagement_id,auth.uid()) IS NULL','WHEN false','Foreign assignment status leaked'),
]:
 assert old in sql,name;scratch=Path('/tmp/openplan-m11-queue-control.sql');scratch.write_text(sql.replace(old,new));env={**os.environ,'OPENPLAN_RLS_LIVE_TEST':'1','OPENPLAN_CONTRACT_TEST_SQL':str(scratch)}
 run(name,['src/test/contract-pending-reviews-rls.test.ts','src/test/contract-closeout-rls.test.ts','-t','scoped participant|staff My Work'],env,reason)
