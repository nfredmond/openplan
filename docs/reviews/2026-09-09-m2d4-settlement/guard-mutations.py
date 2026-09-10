import json,subprocess,re
from pathlib import Path
root=Path('/home/nathaniel/.local/state/openplan/m2d4-settlement-2026-09-09/openplan');out=Path('/home/nathaniel/.local/state/openplan/m2d4-settlement-evidence-2026-09-09')
checks=['src/test/migrations/inventory.test.ts','src/test/create-forms-inline-ratchet.test.ts','src/test/package-scripts-resolve.test.ts','src/test/work-program-closeout-review.test.tsx']
form=root/'src/test/create-forms-inline-ratchet.test.ts';line=next(l for l in form.read_text().splitlines(True) if 'closeout-panel.tsx' in l)
probes=[('harmless comment',form,'const NOT_A_GUIDED_FLOW:','// A revisitable source workspace.\nconst NOT_A_GUIDED_FLOW:',True),('missing source table',root/'supabase/migrations/20261004000001_work_program_closeout_reconciliation.sql','CREATE TABLE public.work_program_closeout_records','CREATE TEMP TABLE public.work_program_closeout_records',False),('undeclared inline editor',form,line,'',False),('live suite omitted',root/'package.json','src/test/work-program-closeout-rls.test.ts ','',False),('private navigation exposed',root/'src/components/programs/work-program/reporting-panel.tsx','data?.canManage && <><a href="#closeout-review"','true && <><a href="#closeout-review"',False)]
results=[]
for i,(name,path,old,new,control) in enumerate(probes):
 original=path.read_text();assert old in original
 try:
  path.write_text(original.replace(old,new));r=subprocess.run(['npm','exec','--','vitest','run',*checks],cwd=root,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT);(out/f'guard-mutation-{i}.log').write_text(r.stdout)
 finally:path.write_text(original)
 results.append({'name':name,'exitCode':r.returncode,'expected':'survived' if control else 'killed','result':'survived' if r.returncode==0 else 'killed'});print(results[-1],flush=True)
(out/'guard-mutations.json').write_text(json.dumps(results,indent=2)+'\n');assert all(r['expected']==r['result'] for r in results)
