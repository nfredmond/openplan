import pathlib,subprocess,hashlib,json,os
app=pathlib.Path('/home/nathaniel/.local/state/openplan/land-use-plan-context-20261007/openplan');out=pathlib.Path('/tmp/openplan-retained-area-controls-v1');out.mkdir(exist_ok=False)
p=app/'supabase/migrations/20261016000006_land_use_plan_retained_study_area.sql';original=p.read_bytes();rows=[]
def run(name,old=None,new=None,target=None):
 try:
  if old:
   source=original.decode();assert source.count(old)==1,(name,source.count(old));p.write_text(source.replace(old,new))
  elif name=='harmless':p.write_bytes(original+b'\n-- Harmless retained-area control.\n')
  r=subprocess.run(['npm','exec','--','vitest','run','src/test/land-use-plan-context-persistence-rls.test.ts','--maxWorkers=1'],cwd=app,env={**os.environ,'NODE_OPTIONS':'--max-old-space-size=6144','OPENPLAN_RLS_LIVE_TEST':'1','OPENPLAN_CONTEXT_RETAINED_MIGRATION_PROBE':'1','OPENPLAN_SUPABASE_WORKDIR':'/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050'},text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=45)
  (out/(name+'.log')).write_text(r.stdout)
  matched=r.returncode==0 if not target else r.returncode!=0 and target in r.stdout
  rows.append({'case':name,'exitCode':r.returncode,'matched':matched,'expected':target or 'pass'});print(name,matched,flush=True)
  if not matched:raise RuntimeError(name)
 finally:p.write_bytes(original)
try:
 run('baseline');run('harmless')
 run('retained-gate',"command_json#>>'{place,mode}' = 'retained'",'false','cannot retain an absent study area: accepted')
 run('retained-place',"p_prepared_context->'place' IS DISTINCT FROM plan_row.plan_context->'place'",'false','retained area substitution refused: accepted')
 run('geography-label',"geography_label = retained#>>'{place,label}'","geography_label = geography_label",'plan geography agrees with retained context')
 run('geography-geometry',"geography_geojson = retained#>'{place,geometry}'","geography_geojson = geography_geojson",'plan geography agrees with retained context')
finally:
 (out/'report.json').write_text(json.dumps({'results':rows,'restored':p.read_bytes()==original,'sourceSha256':hashlib.sha256(original).hexdigest()},indent=2)+'\n')
