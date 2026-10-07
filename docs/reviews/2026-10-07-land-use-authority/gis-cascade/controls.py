from pathlib import Path
import json,os,subprocess,tempfile,hashlib
app=Path(__file__).resolve().parents[4]/'openplan'
if os.environ.get('OPENPLAN_GIS_CONTROLS')!='1':raise SystemExit('Requires owned idle checkout and explicit OPENPLAN_GIS_CONTROLS=1')
source=app/'supabase/migrations/20261016000011_workspace_gis_cascade_guards.sql';original=source.read_bytes()
out=Path(tempfile.mkdtemp(prefix='openplan-gis-cascade-controls-'));print(out,flush=True);(out/'migration.original').write_bytes(original)
cases=[('baseline',None,None,None,None,True),('harmless','-- Preserve finalized GIS records','-- Retain finalized GIS records',None,None,True)]
def add(name,old,new,target,message):cases.append((name,old,new,target,message,False))
add('version-workspace-cascade','JOIN public.workspaces workspace ON workspace.id = layer.workspace_id','', 'freeze-persistence workspace=true','Finalized workspace GIS versions are immutable')
add('version-update-refusal',"IF OLD.ingest_status = 'ready' THEN", "IF OLD.ingest_status = 'ready' AND TG_OP = 'DELETE' THEN",'gis-cascade workspace=false','direct ready version update: accepted')
add('version-delete-refusal',"IF TG_OP = 'DELETE' AND NOT EXISTS (", "IF TG_OP = 'DELETE' OR NOT EXISTS (",'gis-cascade workspace=false','direct ready version delete: accepted')
add('feature-workspace-cascade','    JOIN public.workspaces workspace ON workspace.id = layer.workspace_id\n    WHERE version.id', '    WHERE version.id','gis-cascade workspace=true','Features of a finalized workspace GIS version are immutable')
add('feature-layer-cascade','    JOIN public.workspace_gis_layers layer ON layer.id = version.layer_id\n    JOIN public.workspaces workspace ON workspace.id = layer.workspace_id', '    JOIN public.workspaces workspace ON workspace.id = version.workspace_id','gis-cascade workspace=false','Features of a finalized workspace GIS version are immutable')
add('feature-source-version',"IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (", "IF TG_OP = 'DELETE' AND EXISTS (",'gis-cascade workspace=false','move out of ready version: accepted')
add('feature-delete-refusal',"IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (", "IF TG_OP = 'UPDATE' AND EXISTS (",'gis-cascade workspace=false','direct ready feature delete: accepted')
add('feature-insert-refusal',"IF TG_OP IN ('INSERT', 'UPDATE') AND EXISTS (", "IF TG_OP = 'UPDATE' AND EXISTS (",'gis-cascade workspace=false','insert into ready version: accepted')
add('feature-target-version',"IF TG_OP IN ('INSERT', 'UPDATE') AND EXISTS (", "IF TG_OP = 'INSERT' AND EXISTS (",'gis-cascade workspace=false','move into ready version: accepted')
# Keep the existing-property check while removing the original-version check.
add('feature-move-only',"WHERE id = OLD.version_id AND ingest_status = 'ready'", "WHERE id = OLD.version_id AND ingest_status = 'ready' AND (TG_OP='DELETE' OR NEW.version_id=OLD.version_id)",'gis-cascade workspace=false','move out of ready version: accepted')
results=[]
try:
 for name,old,new,target,message,passing in cases:
  source.write_bytes(original)
  if old:
   s=original.decode();assert old in s,name;source.write_text(s.replace(old,new,1))
  report=out/(name+'.json');cmd=['npm','exec','--','vitest','run','--maxWorkers=1','src/test/land-use-plan-cascade-rls.test.ts','--reporter=json','--outputFile='+str(report)]
  if target:cmd+=['-t',target]
  env={**os.environ,'OPENPLAN_RLS_LIVE_TEST':'1','OPENPLAN_SUPABASE_WORKDIR':'/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050','OPENPLAN_CASCADE_MIGRATION_PROBE':'0','OPENPLAN_GIS_CASCADE_MIGRATION_PROBE':'1','NODE_OPTIONS':'--max-old-space-size=6144'}
  run=subprocess.run(cmd,cwd=app,env=env,capture_output=True,text=True,timeout=90);(out/(name+'.log')).write_text(run.stdout+run.stderr)
  d=json.loads(report.read_text());failed=[{'test':a['fullName'],'messages':a.get('failureMessages',[])} for t in d.get('testResults',[]) for a in t.get('assertionResults',[]) if a['status']=='failed']
  correct=(run.returncode==0 and d['numPassedTests']==8) if passing else (run.returncode!=0 and bool(failed) and message in json.dumps(failed))
  results.append({'name':name,'expected':'pass' if passing else message,'exit':run.returncode,'passed':d['numPassedTests'],'failed':failed,'correct':correct});(out/'results.json').write_text(json.dumps(results,indent=2));print(name,'expected' if correct else 'INVESTIGATE',flush=True)
finally:
 source.write_bytes(original);(out/'restored.json').write_text(json.dumps({'before':hashlib.sha256(original).hexdigest(),'after':hashlib.sha256(source.read_bytes()).hexdigest()},indent=2))
print('complete',out,flush=True)
