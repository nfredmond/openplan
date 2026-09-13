"""Fault the installed retry-code boundary on the retained restored stack only.

The live test checks function bodies before making a potentially looping HTTP
request. These faults therefore must fail at that preflight, without creating
40001 retry backends. Baseline and harmless control exercise actual PostgREST.
Run after the full isolation suite finishes; both use this named database.
"""
import hashlib
import json
import os
import subprocess
from pathlib import Path
root=Path(__file__).resolve().parent
app=root.parents[2]/'openplan'
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/conflict-http-mutations')
private.mkdir(mode=0o700,exist_ok=True)
container='supabase_db_openplan-restore-target-2731143'
workdir='/home/nathaniel/.local/state/openplan/openplan-restore-drill.enw48S/openplan-restore-target-2731143'
cmd=['docker','exec','-i',container,'psql','-X','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1']
def sql(s):return subprocess.run(cmd,input=s,text=True,capture_output=True,check=True).stdout
names=['write_engagement_response','require_engagement_review_intent']
def definition(n):return sql(f"SELECT pg_get_functiondef(oid) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='{n}';")
original={n:definition(n) for n in names}
assert all("PT409" in s and "40001" not in s for s in original.values())
env={**os.environ,'OPENPLAN_RLS_LIVE_TEST':'1','OPENPLAN_SUPABASE_WORKDIR':workdir}
results=[]
try:
 cases=[('baseline',None,None),('harmless-comment',names[0],original[names[0]].replace('BEGIN','BEGIN\n-- Harmless HTTP conflict control.',1))]
 cases += [(n+'-retry-code',n,original[n].replace('PT409','40001')) for n in names]
 for name,function,source in cases:
  if function:
   assert source!=original[function]
   sql(source+';')
  report=private/(name+'.json')
  run=subprocess.run(['node','--env-file-if-exists=.env.local','node_modules/vitest/vitest.mjs','run','src/test/rls-isolation.test.ts','-t','returns response and contribution conflicts promptly','--reporter=json','--outputFile='+str(report)],cwd=app,env=env,capture_output=True,text=True,timeout=180)
  (private/(name+'.log')).write_text(run.stdout+'\n'+run.stderr)
  d=json.loads(report.read_text());failures=[t for f in d['testResults'] for t in f['assertionResults'] if t['status']=='failed']
  fault=name.endswith('-retry-code')
  matched=run.returncode==0 and d['numPassedTests']==1 if not fault else run.returncode!=0 and len(failures)==1 and 'Business conflicts must not invoke PostgREST transaction retries' in '\n'.join(failures[0]['failureMessages'])
  results.append({'name':name,'outcome':'survived' if run.returncode==0 else 'killed','matched':matched,'passed':d['numPassedTests'],'failedTests':[t['fullName'] for t in failures],'failureBoundary':'installed function preflight before HTTP' if fault else None})
  (root/'conflict-http-mutations.json').write_text(json.dumps(results,indent=2)+'\n')
  if function:sql(original[function]+';')
  print(name,results[-1]['outcome'],matched,flush=True)
  assert matched,results[-1]
finally:
 for name,source in original.items():
  sql(source+';')
  assert definition(name)==source
 (root/'conflict-http-restoration.json').write_text(json.dumps({n:hashlib.sha256(definition(n).encode()).hexdigest() for n in names},indent=2)+'\n')
