"""Keep the role scan aware of the public queue's indirect workspace write."""
from pathlib import Path
import subprocess,json,hashlib,time
review=Path(__file__).resolve().parent;app=review.parents[2]/'openplan';test=app/'src/test/workspace-write-role-gate-guard.test.ts';original=test.read_text()
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/public-role-scan')/time.strftime('%Y%m%dT%H%M%S');private.mkdir(parents=True)
line='  "engage/[shareToken]/items/[itemId]/translate/route.ts":\n    "public share-token translation queue; SQL checks current publication and exact source, and the anonymous caller has no workspace role",\n'
assert original.count(line)==1
cases=[('baseline',original,None),('harmless-comment',original+'\n// Harmless indirect-write scan control.\n',None),('invisible-queue-write',original.replace('|queuePublicTranslationGeneration\\s*\\(',''),'keeps the allowlist honest'),('unaccounted-anonymous-write',original.replace(line,''),'gates or explicitly exempts each one')]
results=[]
try:
 for name,body,expected in cases:
  output=private/(name+'.json');test.write_text(body)
  try:run=subprocess.run(['npm','exec','--','vitest','run',str(test),'--reporter=json','--outputFile='+str(output)],cwd=app,capture_output=True,text=True,timeout=30)
  finally:test.write_text(original)
  (private/(name+'.log')).write_text(run.stdout+run.stderr);report=json.loads(output.read_text());failed=[a['fullName'] for suite in report['testResults'] for a in suite['assertionResults'] if a['status']=='failed']
  correct=run.returncode==0 and report['numPassedTests']==4 if expected is None else run.returncode!=0 and any(expected in f for f in failed)
  results.append({'case':name,'outcome':'survived' if run.returncode==0 else 'killed','expectedOutcome':correct,'failedTests':failed});assert correct,(name,failed)
finally:
 assert test.read_text()==original
 (review/'public-route-role-scan-controls.json').write_text(json.dumps({'testSha256':hashlib.sha256(original.encode()).hexdigest(),'privateEvidence':str(private),'results':results,'limits':'Static named-call scan. This extension covers the present public queue helper but cannot infer arbitrary aliases, other indirect writes or runtime authorization. Native SQL and route behavior have separate controls.'},indent=2)+'\n')
