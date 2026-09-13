"""Demonstrate that the live restart probe accepts a no-op and rejects lost output."""
from pathlib import Path
import hashlib,json,subprocess,time
review=Path(__file__).resolve().parent;app=review.parents[2]/'openplan'
worker=app/'src/lib/engagement/translation-generation-worker.ts';original=worker.read_text()
base=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/translation-worker-live-controls')/time.strftime('%Y%m%dT%H%M%S');base.mkdir(parents=True)
report_path=review/'translation-worker-live-results.json'
results=[];baseline=None
old='pending.phase === "completed" ? pending.delivery :';assert original.count(old)==1
cases=[('baseline',original,True),('harmless-comment',original+'\n// Harmless real worker control.\n',True),('discard-recovered-output',original.replace(old,'false ? pending.delivery :'),False)]
try:
 for name,body,expected in cases:
  assert worker.read_text()==original;worker.write_text(body)
  try:r=subprocess.run(['python3',str(review/'prove-translation-worker-live.py')],capture_output=True,text=True,timeout=90)
  finally:worker.write_text(original)
  (base/(name+'.log')).write_text(r.stdout+r.stderr)
  if expected:
   assert r.returncode==0,(name,r.stdout,r.stderr)
   record=json.loads(report_path.read_text());assert record['workerSha256']==hashlib.sha256(body.encode()).hexdigest()
   (base/(name+'.json')).write_text(json.dumps(record,indent=2)+'\n')
   if name=='baseline':baseline=record
  else:assert r.returncode!=0 and 'Worker recovery must succeed' in r.stderr,(name,r.stdout,r.stderr)
  results.append({'case':name,'outcome':'survived' if r.returncode==0 else 'killed','expectedOutcome':True,'expectedFailure':None if expected else 'Worker recovery must succeed'})
  print(name,results[-1]['outcome'],'expected',flush=True)
finally:
 assert worker.read_text()==original
 if baseline is not None:report_path.write_text(json.dumps(baseline,indent=2)+'\n')
(review/'translation-worker-live-controls.json').write_text(json.dumps({'workerSha256':hashlib.sha256(original.encode()).hexdigest(),'privateEvidence':str(base),'results':results,'limits':'Real worker process termination and local HTTP/SQL, synthetic intercepted provider transport. No real provider or UI acceptance.'},indent=2)+'\n')
