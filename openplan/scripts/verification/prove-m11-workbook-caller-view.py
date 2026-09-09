"""Bounded controls for typed handoffs and caller-scoped participant reads.

Does not establish browser delivery, original-document authenticity, or human acceptance.
"""
from pathlib import Path
import os,json,subprocess
root=Path(__file__).resolve().parents[2];results=[]
def run(name,tests,env,reason):
 p=subprocess.run(['npm','exec','--','vitest','run',*tests],cwd=root,env=env,capture_output=True,text=True)
 out=p.stdout+p.stderr;Path('/tmp/openplan-m11-'+name+'.log').write_text(out)
 assert (p.returncode==0 if reason is None else p.returncode!=0 and reason in out),name+'\n'+out[-3000:]
 results.append({'name':name,'outcome':'survived' if reason is None else 'killed','reason':reason});print(name,results[-1]['outcome'],flush=True)
 (root.parent/'docs/reviews/2026-09-08-m11-delivery/workbook-caller-controls.json').write_text(json.dumps(results,indent=2)+'\n')
p=root/'src/lib/invoicing/contracts/export.ts';original=p.read_text()
for name,old,new,reason in [
 ('harmless-workbook-comment',' const typedColumns=',' // Column meanings are retained.\n const typedColumns=',None),
 ('coerce-external-identifiers','isAmount(index,row) &&','true &&','keeps one accounting row'),
 ('lose-budget-numeric-type','"Known hours","Internal cost","Gross fee"','"Known hours","Gross fee"', 'keeps one accounting row'),
 ('money-format-revision','?"#,##0.00;[Red](#,##0.00)":"0"','?"#,##0.00;[Red](#,##0.00)":"0.00"','keeps one accounting row'),
 ('truncate-note-details','parts.forEach((part,index)=>','parts.slice(0,1).forEach((part,index)=>','keeps one accounting row'),
 ('wrong-detail-record','details.push([row[1],','details.push([row[0],','keeps one accounting row'),
 ('lost-detail-link','if(typedColumns&&table.name===','if(false&&table.name===','keeps one accounting row'),
]:
 assert old in original,name
 try:p.write_text(original.replace(old,new));run(name,['src/test/contract-accounting-handoff.test.ts'],os.environ,reason)
 finally:p.write_text(original)
sql=(root/'supabase/migrations/20260927000001_contract_participant_caller_view.sql').read_text()
for name,old,new,reason in [
 ('harmless-caller-comment','-- Keep the public','-- Explicit grants.\n-- Keep the public',None),
 ('owner-view-regression','security_invoker=true','security_invoker=false','Participant view bypasses caller privileges'),
 ('anonymous-function-grant','TO authenticated;','TO authenticated,anon;','Anonymous participant function access'),
 ('foreign-participant-row','WHERE public.contract_is_participant(e.id)','WHERE true','Participant grant or own return count incorrect'),
 ('other-invoice-return-count','AND i.submitted_by=auth.uid()','', 'Participant grant or own return count incorrect'),
]:
 assert old in sql,name;scratch=Path('/tmp/openplan-m11-caller-control.sql');scratch.write_text(sql.replace(old,new))
 run(name,['src/test/contract-pending-reviews-rls.test.ts','-t','participant view|consultant'],{**os.environ,'OPENPLAN_RLS_LIVE_TEST':'1','OPENPLAN_CONTRACT_TEST_SQL':str(scratch)},reason)
