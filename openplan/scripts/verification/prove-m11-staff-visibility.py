"""Exercise staff payroll projection and source-register controls in the owned test checkout."""
from pathlib import Path
import json, os, subprocess
root=Path(__file__).resolve().parents[2]
source=root/'supabase/migrations/20260924000001_contract_staff_import_visibility.sql'
original=source.read_text();results=[]
for name,old,new,reason in [
 ('harmless-staff-comment','-- Staff can read','-- Staff retain review status.\n-- Staff can read',None),
 ('hide-imported-time',"AND v.command->>'category'='labor' AND v.created_at<=p_cutoff","AND own.command IS NOT NULL AND v.command->>'category'='labor' AND v.created_at<=p_cutoff",'Imported own draft visibility'),
 ('leak-finance-notes',"'description','Time recorded for you by finance'","'description',v.command->>'description'",'Imported payroll private fields leaked'),
 ('leak-other-staff',"AND s.user_id=p_actor_id AND v.command->>'category'='labor'","AND v.command->>'category'='labor'",'Imported own current approved time missing'),
 ('allow-finance-draft-edit',"'member_can_correct',v.created_by=p_actor_id AND v.command->>'status'='draft'","'member_can_correct',v.command->>'status'='draft'",'Imported own draft visibility'),
 ('lose-task-attribution',"'taskId',a->'taskId'","'taskId',NULL",'Own time attribution missing'),
]:
 assert old in original,name
 changed=original.replace(old,new);scratch=Path('/tmp/openplan-m11-staff-control.sql');scratch.write_text(changed)
 run=subprocess.run(['npm','exec','--','vitest','run','src/test/contract-agency-reconciliation-rls.test.ts','-t','finance-imported'],cwd=root,env={**os.environ,'OPENPLAN_RLS_LIVE_TEST':'1','OPENPLAN_CONTRACT_TEST_SQL':str(scratch)},capture_output=True,text=True)
 out=run.stdout+run.stderr;Path('/tmp/openplan-m11-'+name+'.log').write_text(out)
 assert (run.returncode==0 if reason is None else run.returncode!=0 and reason in out),name+'\n'+out[-2500:]
 results.append({'name':name,'outcome':'survived' if reason is None else 'killed','reason':reason});print(name,results[-1]['outcome'],flush=True)
path=root/'src/components/invoicing/contracts/contract-management.tsx';original=path.read_text()
for name,old,new in [
 ('enable-imported-draft-button','||v.member_can_correct===false',''),
 ('drop-source-dates','{v.command.entryDate} · {v.command.description}','{v.command.description}'),
 ('reverse-source-order','a.command.entryDate.localeCompare(b.command.entryDate)','b.command.entryDate.localeCompare(a.command.entryDate)'),
]:
 assert old in original,name
 try:
  path.write_text(original.replace(old,new))
  run=subprocess.run(['npm','exec','--','vitest','run','src/test/contract-review-layout.test.tsx','-t','imported drafts'],cwd=root,capture_output=True,text=True)
  out=run.stdout+run.stderr;Path('/tmp/openplan-m11-'+name+'.log').write_text(out)
  assert run.returncode!=0 and 'keeps imported drafts read-only' in out,name+'\n'+out[-2500:]
  results.append({'name':name,'outcome':'killed','reason':'Staff source register behavior'});print(name,'killed',flush=True)
 finally:path.write_text(original)
(root.parent/'docs/reviews/2026-09-08-m11-delivery/staff-visibility-controls.json').write_text(json.dumps(results,indent=2)+'\n')
