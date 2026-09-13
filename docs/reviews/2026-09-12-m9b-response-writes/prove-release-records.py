"""Check candidate migration accounting against harmless and broken records."""
import json,subprocess
from pathlib import Path
root=Path(__file__).resolve().parent;app=root.parents[2]/'openplan'
p=app/'src/test/migrations/release-ordering.test.ts';original=p.read_text()
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/release-record-mutations');private.mkdir(mode=0o700,exist_ok=True)
results=[]
try:
 for name,source,fault in [('baseline',original,False),('harmless-comment',original+'\n// Harmless release record control.\n',False),('wrong-candidate-migration-count',original.replace('migrationsAtRelease: 326','migrationsAtRelease: 325'),True)]:
  p.write_text(source);report=private/(name+'.json');run=subprocess.run(['npm','exec','--','vitest','run','src/test/migrations/release-ordering.test.ts','--reporter=json','--outputFile='+str(report)],cwd=app,capture_output=True,text=True,timeout=60)
  d=json.loads(report.read_text());failed=[t['fullName'] for f in d['testResults'] for t in f['assertionResults'] if t['status']=='failed'];matched=run.returncode==0 and d['numPassedTests']>0 if not fault else run.returncode!=0 and any('no migration has been inserted at or below' in t for t in failed)
  results.append({'name':name,'matched':matched,'outcome':'survived' if run.returncode==0 else 'killed','passed':d['numPassedTests'],'failed':failed});(root/'release-record-mutations.json').write_text(json.dumps(results,indent=2)+'\n');print(name,matched,flush=True);assert matched,results[-1]
finally:p.write_text(original)
