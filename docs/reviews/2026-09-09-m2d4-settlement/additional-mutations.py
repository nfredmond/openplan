import json,os,subprocess
from pathlib import Path
root=Path('/home/nathaniel/.local/state/openplan/m2d4-settlement-2026-09-09/openplan');out=Path('/home/nathaniel/.local/state/openplan/m2d4-settlement-evidence-2026-09-09');sql=(root/'supabase/migrations/20261004000001_work_program_closeout_reconciliation.sql').read_text();original=sql[sql.index('CREATE FUNCTION'):].replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION')
probes=[('currency control','-- The same source read','-- The shared source read',True),('successor currency',"AND b.content_json->>'currency'=r.snapshot->'baseline'->'content_json'->>'currency'",'',False),('successor starts later',"AND b.content_json->>'periodStart'>r.snapshot->'baseline'->'content_json'->>'periodStart'",'',False),('payment currency',"OR actual->>'currency' IS DISTINCT FROM baseline->'content_json'->>'currency'",'',False)]
# A comment inside the function source is the harmless control.
probes[0]=('currency control','-- Lock before comparing','-- Serialize before comparing',True)
probes.append(('reopening releases approved funds prematurely',"AND newer.state='approved' ",'',False))
results=[]
for i,(name,old,new,control) in enumerate(probes):
 assert old in original; path=out/'extra-mutation.sql';path.write_text(original.replace(old,new));env=os.environ|{'OPENPLAN_RLS_LIVE_TEST':'1','OPENPLAN_SUPABASE_WORKDIR':'/home/nathaniel/.local/state/openplan/m2d4-settlement-verification','M2D4_SQL_REPLACEMENT':str(path)}
 r=subprocess.run(['npm','exec','--','vitest','run','src/test/work-program-closeout-rls.test.ts'],cwd=root,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT);(out/f'extra-mutation-{i}.log').write_text(r.stdout);results.append({'name':name,'exitCode':r.returncode,'expected':'survived' if control else 'killed','result':'survived' if r.returncode==0 else 'killed'});print(results[-1],flush=True)
(out/'extra-mutations.json').write_text(json.dumps(results,indent=2)+'\n');assert all(r['result']==r['expected'] for r in results)
