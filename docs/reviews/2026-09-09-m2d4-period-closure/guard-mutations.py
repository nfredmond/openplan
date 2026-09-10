from pathlib import Path
import subprocess,json,os,re
root=Path('/home/nathaniel/.local/state/openplan/m2d4-period-closure-2026-09-09/openplan');out=Path('/home/nathaniel/.local/state/openplan/m2d4-period-closure-evidence-2026-09-09')
migration=root/'supabase/migrations/20261005000001_work_program_period_closure.sql';census=root/'src/test/rls-isolation.test.ts'
cases=[('harmless SQL comment',migration,lambda s:s+'\n-- harmless comment\n',['src/test/migrations/inventory.test.ts'],True),('unregistered table',migration,lambda s:s+'\nCREATE TABLE public.synthetic_inventory_mutation (id uuid);\n',['src/test/migrations/inventory.test.ts'],False),('missing policy',migration,lambda s:re.sub(r'CREATE POLICY period_closure_private_read.*?;', '',s,count=1,flags=re.S),['src/test/migrations/inventory.test.ts'],False),('missing live closure coverage',census,lambda s:s.replace('  "work_program_period_closures",\n',''),['src/test/rls-isolation.test.ts','-t','every workspace_id'],False)]
results=[]
for i,(name,path,edit,args,survive) in enumerate(cases):
 original=path.read_text()
 try:
  path.write_text(edit(original));r=subprocess.run(['node','--env-file-if-exists=.env.local','node_modules/vitest/vitest.mjs','run',*args],cwd=root,env={**os.environ,'OPENPLAN_RLS_LIVE_TEST':'1','OPENPLAN_SUPABASE_WORKDIR':'/home/nathaniel/.local/state/openplan/m2d4-period-closure-verification'},text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 finally:path.write_text(original)
 (out/f'guard-mutation-{i}.log').write_text(r.stdout);result={'name':name,'exit':r.returncode,'expected':'survived' if survive else 'detected','matched':(r.returncode==0)==survive};results.append(result);print(result,flush=True);(out/'guard-mutations.json').write_text(json.dumps(results,indent=2)+'\n')
 if not result['matched']:raise SystemExit(1)
