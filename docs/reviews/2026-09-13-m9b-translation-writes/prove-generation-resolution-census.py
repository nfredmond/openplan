"""The installed table must disappear from coverage when its probe is removed."""
from pathlib import Path
import hashlib,json,os,subprocess,time
review=Path(__file__).resolve().parent;app=review.parents[2]/'openplan';source=app/'src/test/rls-isolation.test.ts';original=source.read_text()
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913')/('resolution-census-'+str(time.time_ns()));private.mkdir(mode=0o700)
needle='  "engagement_translation_generation_resolutions",';assert original.count(needle)==2
broken=original.replace(needle,'',1)
cases=[('baseline',original,True),('harmless',original+'\n// Harmless resolution census control.\n',True),('missing-resolution-probe',broken,False)]
results=[]
try:
 for name,body,expected in cases:
  assert source.read_text()==original;source.write_text(body);target=private/(name+'.json')
  try:
   run=subprocess.run(['npm','exec','--','vitest','run','src/test/rls-isolation.test.ts','-t','every workspace_id table is probed','--reporter=json','--outputFile='+str(target)],cwd=app,env={**os.environ,'OPENPLAN_RLS_LIVE_TEST':'1','OPENPLAN_SUPABASE_WORKDIR':'/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050'},text=True,capture_output=True,timeout=30)
  finally:source.write_text(original)
  (private/(name+'.log')).write_text(run.stdout+run.stderr);report=json.loads(target.read_text());failed=[a for s in report['testResults'] for a in s['assertionResults'] if a['status']=='failed']
  correct=run.returncode==0 and report['numPassedTests']==1 if expected else run.returncode!=0 and len(failed)==1 and 'every workspace_id table is probed' in failed[0]['fullName'] and 'engagement_translation_generation_resolutions' in ''.join(failed[0]['failureMessages'])
  results.append({'case':name,'outcome':'survived' if run.returncode==0 else 'killed','expectedOutcome':correct});print(name,results[-1]['outcome'],flush=True);assert correct,(name,failed)
finally:
 assert source.read_text()==original
 (review/'generation-resolution-census-controls.json').write_text(json.dumps({'sourceSha256':hashlib.sha256(original.encode()).hexdigest(),'privateEvidence':str(private),'results':results,'limits':'Actual installed database table inventory. Proves coverage omission detection; dedicated native tests separately exercise receipt privacy. Does not prove every future fixture is sufficient or that removing a package script entry is detected.'},indent=2)+'\n')
