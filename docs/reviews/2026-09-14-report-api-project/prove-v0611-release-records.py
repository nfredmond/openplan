"""Exercise the v0.61.1 release ledger with a surviving control and targeted faults."""
import hashlib,json,subprocess,time
from pathlib import Path
root=Path(__file__).resolve().parents[3];app=root/'openplan';review=Path(__file__).resolve().parent
ledger=app/'src/test/migrations/release-ordering.test.ts';changelog=root/'CHANGELOG.md'
original={p:p.read_bytes() for p in [ledger,changelog]}
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913')/('v0611-release-records-'+str(time.time_ns()));private.mkdir(mode=0o700)
results=[]
cases=[('baseline',None,None,None,None),('harmless-comment',ledger,'const RELEASES:','// Harmless release control.\nconst RELEASES:',None),('wrong-migration-count',ledger,'    tag: "0.61.1",\n    lastMigration: "20261014000024_engagement_report_decision_history.sql",\n    migrationsAtRelease: 343,\n  },','    tag: "0.61.1",\n    lastMigration: "20261014000024_engagement_report_decision_history.sql",\n    migrationsAtRelease: 342,\n  },','no migration has been inserted at or below a shipped high-water mark'),('missing-last-migration',ledger,'    tag: "0.61.1",\n    lastMigration: "20261014000024_engagement_report_decision_history.sql",\n    migrationsAtRelease: 343,\n  },','    tag: "0.61.1",\n    lastMigration: "20261014000024_missing_history.sql",\n    migrationsAtRelease: 343,\n  },',"every release's recorded last migration exists on disk"),('missing-release-section',changelog,'## 0.61.1 —','## SYNTHETIC-absent —',None)]
try:
 for name,target,old,new,expected in cases:
  for p,b in original.items():p.write_bytes(b)
  if target:
   text=target.read_text();assert text.count(old)==1,(name,text.count(old));target.write_text(text.replace(old,new))
  report=private/(name+'.json')
  run=subprocess.run(['npm','exec','--','vitest','run','src/test/migrations/release-ordering.test.ts','--reporter=json','--outputFile='+str(report)],cwd=app,text=True,capture_output=True,timeout=60)
  (private/(name+'.log')).write_text(run.stdout+run.stderr)
  data=json.loads(report.read_text());failed=[t['fullName'] for f in data['testResults'] for t in f['assertionResults'] if t['status']=='failed']
  positive=name in ['baseline','harmless-comment']
  ok=run.returncode==0 and data['numPassedTests']>0 if positive else run.returncode!=0 and bool(failed) and (any(expected in t for t in failed) if expected else any('CHANGELOG' in t for t in failed))
  results.append({'case':name,'passedTests':data['numPassedTests'],'failedTests':failed,'exit':run.returncode,'expectedOutcome':ok});print(name,ok,flush=True)
  if not ok:break
finally:
 for p,b in original.items():p.write_bytes(b)
 (review/'v0611-release-records.json').write_text(json.dumps({'privateEvidence':str(private),'sources':{str(p.relative_to(root)):hashlib.sha256(b).hexdigest() for p,b in original.items()},'results':results,'limits':'Release metadata and operator migration accounting only. Does not prove installed upgrade, database isolation or browser behavior; those have separate runtime evidence.'},indent=2)+'\n')
assert len(results)==len(cases) and all(r['expectedOutcome'] for r in results)
