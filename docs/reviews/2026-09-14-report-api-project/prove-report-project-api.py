import json,subprocess,hashlib,time
from pathlib import Path
root=Path(__file__).resolve().parents[3];app=root/'openplan'
route=app/'src/app/api/reports/[reportId]/route.ts';api=app/'src/lib/reports/api.ts';original={p:p.read_bytes() for p in [route,api]}
base=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context')/('report-project-api-mutations-'+str(time.time_ns()));base.mkdir(mode=0o700)
marker='const { data: project, error: projectError } = access.report.project_id'
cases=[('baseline',None,None,None,None),('harmless',route,marker,'// Harmless report-read control.\n    '+marker,None),('unconditional-project-read',route,marker,marker.replace('access.report.project_id','true'),'GET reads a consultation report'),('never-read-project',route,marker,marker.replace('access.report.project_id','false'),'GET returns report detail payload'),('swallow-project-error',route,'if (projectError) {','if (false && projectError) {','GET retains the named project'),('missing-project-projection',api,'"id, workspace_id, project_id, land_use_plan_id, title, status, report_type, generated_at, latest_artifact_url, latest_artifact_kind, metadata_json"','"id, workspace_id, land_use_plan_id, title, status, report_type, generated_at, latest_artifact_url, latest_artifact_kind, metadata_json"','GET reads a consultation report')]
results=[]
try:
 for name,p,old,new,expected in cases:
  for f,b in original.items():f.write_bytes(b)
  if p:
   s=p.read_text();assert s.count(old)==1;(p).write_text(s.replace(old,new))
  out=base/(name+'.json');run=subprocess.run(['npm','exec','--','vitest','run','src/test/report-detail-route.test.ts','--reporter=json','--outputFile='+str(out)],cwd=app,capture_output=True,text=True,timeout=60)
  (base/(name+'.log')).write_text(run.stdout+run.stderr);s=json.loads(out.read_text());failed=[t['fullName'] for f in s['testResults'] for t in f['assertionResults'] if t['status']=='failed'];ok=(run.returncode==0 and s['numPassedTests']==17) if expected is None else (run.returncode!=0 and any(expected in t for t in failed));results.append({'case':name,'passed':s['numPassedTests'],'failed':failed,'expectedOutcome':ok});print(name,ok,flush=True)
  if not ok:break
finally:
 for p,b in original.items():p.write_bytes(b)
 (base/'results.json').write_text(json.dumps({'sources':{str(p.relative_to(root)):hashlib.sha256(b).hexdigest() for p,b in original.items()},'cases':results,'limits':'Real handler and shared access resolver with mocked database queries. Projections asserted; native API, real RLS and UI checked separately.'},indent=2)+'\n')
 print(base,flush=True)
assert len(results)==len(cases) and all(r['expectedOutcome'] for r in results)
