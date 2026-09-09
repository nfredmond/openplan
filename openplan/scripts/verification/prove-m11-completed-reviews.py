"""Evidenced actual review controls; does not establish external reviewer authority."""
from pathlib import Path
import os,json,subprocess
root=Path(__file__).resolve().parents[2];results=[]
def run(name,tests,env,reason=None):
 p=subprocess.run(['npm','exec','--','vitest','run',*tests],cwd=root,env=env,capture_output=True,text=True);out=p.stdout+p.stderr;Path('/tmp/openplan-m11-'+name+'.log').write_text(out)
 assert (p.returncode==0 if reason is None else p.returncode!=0 and reason in out),name+'\n'+out[-3000:]
 results.append({'name':name,'outcome':'survived' if reason is None else 'killed','reason':reason});print(name,results[-1]['outcome'],flush=True)
 (root.parent/'docs/reviews/2026-09-08-m11-delivery/completed-review-controls.json').write_text(json.dumps(results,indent=2)+'\n')
for name,file,old,new,reason in [
 ('harmless-review-comment','lib/invoicing/contracts/delivery.ts','/** Compute only','/** Retained assumptions. Compute only',None),
 ('ignore-recorded-review','lib/invoicing/contracts/delivery.ts','if(node.completedReview){','if(false&&node.completedReview){','retains evidenced review actuals'),
 ('future-review-supported','lib/invoicing/contracts/delivery.ts','if(actual.finishedOn>asOf)','if(false)','keeps actual dates'),
 ('conflicting-review-supported','lib/invoicing/contracts/delivery.ts','if(!supported||conflict)','if(!supported)','keeps actual dates'),
 ('skip-review-evidence-check','lib/invoicing/contracts/delivery.ts','||!node.completedReview.evidence.trim()','', 'rejects reversed dates'),
 ('staff-review-actuals','lib/invoicing/contracts/delivery.ts','node.kind==="work"||node.completedReview.startedOn','node.completedReview.startedOn','rejects reversed dates'),
 ('completed-work-start-after-finish','lib/invoicing/contracts/delivery.ts','result.actualFinish?(result.actualStart??result.actualFinish):start','start','retains evidenced review actuals'),
 ('hide-review-export','lib/invoicing/contracts/export.ts','if(d.scheduleVersions.some(s=>s.content.nodes.some(n=>n.completedReview)))','if(false)','exports actual review evidence'),
 ('lost-review-form-evidence','components/invoicing/contracts/delivery-management.tsx','completedReview:{...n.completedReview!,evidence}','completedReview:{...n.completedReview!,evidence:""}','reaches actual review inputs'),
]:
 path=root/'src'/file;original=path.read_text();assert old in original,name
 try:path.write_text(original.replace(old,new));run(name,['src/test/contract-completed-review.test.tsx'],os.environ,reason)
 finally:path.write_text(original)
sql=(root/'supabase/migrations/20260928000001_contract_completed_review_dates.sql').read_text();sql='\n'.join(line for line in sql.splitlines() if not line.startswith('CREATE TRIGGER'))
for name,old,new,reason in [
 ('harmless-completed-review-sql','-- Actual outside','-- Exact dates.\n-- Actual outside',None),
 ('missing-review-evidence-sql',"OR coalesce(length(trim(actual->>'evidence')),0)=0",'', 'Invalid completed review accepted: evidence'),
 ('reversed-review-dates-sql',"(actual->>'startedOn')::date>(actual->>'finishedOn')::date",'false', 'Invalid completed review accepted: reverse'),
 ('future-review-dates-sql',"OR (actual->>'finishedOn')::date>NEW.created_at::date",'', 'Invalid completed review accepted: future'),
 ('work-review-actuals-sql',"node->>'kind' NOT IN ('client_review','agency_review','public_review')",'false','Invalid completed review accepted: work'),
 ('old-review-calculation-hash','method:contract-delivery-v4-completed-reviews','method:contract-delivery-v3-billing-direction','Completed review calculation revision missing'),
]:
 assert old in sql,name;scratch=Path('/tmp/openplan-m11-completed-review-control.sql');scratch.write_text(sql.replace(old,new));run(name,['src/test/contract-completed-review-rls.test.ts'],{**os.environ,'OPENPLAN_RLS_LIVE_TEST':'1','OPENPLAN_CONTRACT_TEST_SQL':str(scratch)},reason)
