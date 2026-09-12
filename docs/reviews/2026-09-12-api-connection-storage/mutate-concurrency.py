from pathlib import Path
import json,subprocess,os
root=Path(__file__).resolve().parents[3]/'openplan'
e=Path('/home/nathaniel/.local/state/openplan/api-provider-research-2026-09-12')
cmd=['docker','exec','-i','supabase_db_openplan-restore-target-2026091050','psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At']
original=subprocess.check_output(cmd,input="SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='assert_workspace_provider_api_manager' AND pronamespace='public'::regnamespace;",text=True)
assert original.count('FOR SHARE;')==1
records=[]
try:
 for name,definition,target in [('harmless-comment','-- Harmless manager comment\n'+original,None),('membership-lock',original.replace('FOR SHARE;',';'),'serializes membership')]:
  subprocess.run(cmd,input=definition,text=True,capture_output=True,check=True)
  report=e/f'concurrency-mutation-{name}.json'
  env={**os.environ,'OPENPLAN_RLS_LIVE_TEST':'1','OPENPLAN_SUPABASE_WORKDIR':'/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050'}
  run=subprocess.run(['npm','exec','--','vitest','run','src/test/provider-api-connections-concurrency.test.ts','--reporter=default','--reporter=json','--outputFile',str(report)],cwd=root,env=env,text=True,capture_output=True,timeout=60)
  (e/f'concurrency-mutation-{name}.log').write_text(run.stdout+run.stderr)
  data=json.loads(report.read_text());failures=[a['fullName'] for s in data['testResults'] for a in s['assertionResults'] if a['status']=='failed']
  if target is None: assert run.returncode==0 and data['numPassedTests']==4,(name,data)
  else: assert run.returncode!=0 and any(target in f for f in failures),(name,failures)
  records.append({'mutation':name,'outcome':'survived' if target is None else 'failed','failedTests':failures})
  print(name,records[-1]['outcome'],flush=True)
finally:
 subprocess.run(cmd,input=original,text=True,capture_output=True,check=True)
(e/'concurrency-mutations.json').write_text(json.dumps({'mutations':records,'target':'Named disposable restore stack; original function restored in finally. No other local RLS campaign ran concurrently.'},indent=2)+'\n')
