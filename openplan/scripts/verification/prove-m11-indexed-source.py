"""Exercise ready-file evidence without changing retained business records."""
from pathlib import Path
import json,os,subprocess
root=Path(__file__).resolve().parents[2]
sql=(root/'supabase/migrations/20260921000001_contract_indexed_source_files.sql').read_text()
results=[]
for name,changed,expected in [('harmless-indexed-source',sql+'\n-- Extraction does not remove the original.\n',None),('reject-ready-original',sql.replace("status IN ('stored','ready')","status='stored'"),'Retain an original source file'),('admit-foreign-indexed-source',sql.replace('AND workspace_id=e.workspace_id AND status','AND status'),'Foreign indexed source admitted')]:
 assert changed!=sql
 path=Path('/tmp/openplan-m11-indexed-source-control.sql');path.write_text(changed)
 env={**os.environ,'OPENPLAN_RLS_LIVE_TEST':'1','OPENPLAN_SUPABASE_WORKDIR':'/home/nathaniel/.local/state/openplan/m11-contract-verification','OPENPLAN_CONTRACT_TEST_SQL':str(path)}
 result=subprocess.run(['npm','test','--','--run','src/test/contract-closeout-rls.test.ts'],cwd=root,env=env,capture_output=True,text=True)
 log=result.stdout+result.stderr;Path('/tmp/openplan-m11-'+name+'.log').write_text(log)
 assert (result.returncode==0 if expected is None else result.returncode!=0 and expected in log),name+'\n'+log[-5000:]
 results.append({'name':name,'outcome':'survived' if expected is None else 'killed','expected':expected})
 print(name,results[-1]['outcome'],flush=True)
 (root.parent/'docs/reviews/2026-09-08-m11-delivery/indexed-source-controls.json').write_text(json.dumps(results,indent=2)+'\n')
