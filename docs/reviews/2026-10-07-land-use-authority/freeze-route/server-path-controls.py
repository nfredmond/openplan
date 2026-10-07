import pathlib,subprocess,hashlib,json,os
app=pathlib.Path('/home/nathaniel/.local/state/openplan/land-use-plan-context-20261007/openplan');out=pathlib.Path('/tmp/openplan-freeze-server-path-controls-v1');out.mkdir(exist_ok=False)
p=app/'supabase/migrations/20261016000005_land_use_plan_freeze_server_path.sql';original=p.read_bytes();rows=[]
def run(name,old=None,new=None,target=None):
 try:
  if old:
   source=original.decode();assert source.count(old)==1;(p).write_text(source.replace(old,new))
  elif name=='harmless':p.write_bytes(original+b'\n-- Harmless SQL verification comment.\n')
  r=subprocess.run(['npm','exec','--','vitest','run','src/test/land-use-plan-freeze-persistence-rls.test.ts','--maxWorkers=1'],cwd=app,env={**os.environ,'NODE_OPTIONS':'--max-old-space-size=6144','OPENPLAN_RLS_LIVE_TEST':'1','OPENPLAN_FREEZE_MIGRATION_PROBE':'1','OPENPLAN_SUPABASE_WORKDIR':'/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050'},text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=45)
  (out/(name+'.log')).write_text(r.stdout)
  matched=r.returncode==0 if not target else r.returncode!=0 and target in r.stdout and 'accepted' in r.stdout
  rows.append({'case':name,'exitCode':r.returncode,'matched':matched,'expected':target or 'pass'});print(name,matched,flush=True)
  if not matched:raise RuntimeError(name)
 finally:p.write_bytes(original)
try:
 run('baseline');run('harmless')
 run('insert-bypass',"TG_OP = 'INSERT' AND NEW.state <> 'working'",'false','direct authenticated frozen insert refused')
 run('update-bypass',"TG_OP = 'UPDATE' AND OLD.state = 'working' AND NEW.state <> 'working'",'false','direct authenticated freeze update refused')
 run('jwt-role',"current_user NOT IN ('service_role', 'postgres')","auth.role() NOT IN ('service_role', 'postgres')",'forged JWT role cannot freeze directly')
 run('definer-bypass','SECURITY INVOKER','SECURITY DEFINER','direct authenticated freeze update refused')
finally:
 (out/'report.json').write_text(json.dumps({'results':rows,'restored':p.read_bytes()==original,'sourceSha256':hashlib.sha256(original).hexdigest()},indent=2)+'\n')
