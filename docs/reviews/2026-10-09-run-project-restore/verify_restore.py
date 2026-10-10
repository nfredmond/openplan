"""Reproduce default restore failure, then restore the migrated nonempty archive."""
import hashlib,json,os,subprocess,uuid
from pathlib import Path
here=Path(__file__).resolve().parent
repo=here.parents[2]
os.umask(0o077)
container='supabase_db_openplan-restore-target-2026091050'
original=Path('/home/nathaniel/.local/state/openplan/recovery-integration-acceptance-8611f4af/acceptance-source.dump')
assert original.is_file()
ident=uuid.uuid4().hex
out=Path('/home/nathaniel/.local/state/openplan')/('project-restore-'+ident)
out.mkdir(mode=0o700)
source='openplan_project_restore_source_'+ident
target='openplan_project_restore_target_'+ident
state={'source':source,'target':target,'stage':'planned'}
def save(): (out/'state.json').write_text(json.dumps(state,indent=2)+'\n')
def run(args,**kw):return subprocess.run(args,capture_output=True,timeout=120,**kw)
def sql(db,q):
 r=run(['docker','exec','-i',container,'psql','-U','supabase_admin','-d',db,'-X','-qAt','-v','ON_ERROR_STOP=1'],input=q,text=True)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
def restore(db,file,listfile=None):
 args=['docker','exec',container,'pg_restore','-U','supabase_admin','-d',db,'--exit-on-error','--single-transaction']
 if listfile:args+=['--use-list='+listfile]
 return run(args+[file])
save()
sql('postgres','CREATE DATABASE '+source+' TEMPLATE template0;')
sql('postgres','CREATE DATABASE '+target+' TEMPLATE template0;')
state['stage']='created';save()
remote='/tmp/openplan-project-restore-'+ident
subprocess.run(['docker','cp',str(original),container+':'+remote+'.dump'],check=True,capture_output=True)
remote_files=[remote+'.dump']
try:
 r=restore(source,remote+'.dump')
 assert r.returncode!=0 and b'model_runs_project_workspace_match' in r.stderr,'Expected original restore-order failure'
 assert sql(source,"SELECT to_regclass('public.model_runs') IS NULL;")=='t','Failed restore left tables'
 state['stage']='baseline-failure-confirmed';save()
 toc=run(['docker','exec',container,'pg_restore','--list',remote+'.dump'])
 assert toc.returncode==0
 lines=toc.stdout.decode().splitlines()
 projects=[l for l in lines if ' TABLE DATA public projects ' in l];assert len(projects)==1
 lines.remove(projects[0]);lines.insert(next(i for i,l in enumerate(lines) if ' TABLE DATA ' in l),projects[0])
 (out/'ordered.list').write_text('\n'.join(lines)+'\n')
 subprocess.run(['docker','cp',str(out/'ordered.list'),container+':'+remote+'.list'],check=True,capture_output=True);remote_files.append(remote+'.list')
 r=restore(source,remote+'.dump',remote+'.list')
 if r.returncode:raise RuntimeError(r.stderr.decode()[:2000])
 state['stage']='original-loaded-for-upgrade';save()
 for i in (24,25,26,27):
  migration=next((repo/'openplan/supabase/migrations').glob('202610160000'+str(i)+'_*.sql'))
  sql(source,migration.read_text())
 state['stage']='migrated';save()
 upgraded=out/'migrated.dump'
 with upgraded.open('wb') as f:
  r=subprocess.run(['docker','exec',container,'pg_dump','-U','supabase_admin','-d',source,'--format=custom'],stdout=f,stderr=subprocess.PIPE,timeout=120)
  if r.returncode:raise RuntimeError(r.stderr.decode()[:2000])
 subprocess.run(['docker','cp',str(upgraded),container+':'+remote+'.fixed'],check=True,capture_output=True);remote_files.append(remote+'.fixed')
 r=restore(target,remote+'.fixed')
 if r.returncode:raise RuntimeError(r.stderr.decode()[:2000])
 state['stage']='default-restore-succeeded';save()
 tables=json.loads(sql(source,"SELECT json_agg(t) FROM (SELECT n.nspname AS schema,c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth','storage') AND c.relkind='r' AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e') ORDER BY n.nspname,c.relname) t;"))
 def quote(v):return '"'+v.replace('"','""')+'"'
 queries=[]
 for t in tables:
  relation=quote(t['schema'])+'.'+quote(t['name'])
  queries.append("SELECT json_build_object('table','"+t['schema']+'.'+t['name']+"','rows',count(*),'hash',md5(coalesce(string_agg(to_jsonb(r)::text,E'\\n' ORDER BY to_jsonb(r)::text),''))) FROM "+relation+' r;')
 q='\n'.join(queries)
 before=sql(source,q);after=sql(target,q)
 assert before==after,'Migrated records differ after default restore'
 constraints="SELECT jsonb_agg(jsonb_build_array(conrelid::regclass::text,conname,contype,convalidated,pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_constraint WHERE conname='projects_id_workspace_restore_key' OR conname IN ('runs_project_workspace_fk','model_runs_project_workspace_fk','county_runs_project_workspace_fk','stage_gate_decisions_project_workspace_fk');"
 assert sql(source,constraints)==sql(target,constraints),'Relationship definitions differ'
 assert sql(target,"SELECT count(*) FROM pg_constraint WHERE conname IN ('runs_project_workspace_fk','model_runs_project_workspace_fk','county_runs_project_workspace_fk','stage_gate_decisions_project_workspace_fk') AND convalidated;")=='4'
 checks=(here/'verify-integrity.sql').read_text()
 sql(target,'BEGIN;\n'+checks+'\nROLLBACK;')
 assert sql(target,q)==after,'Restored integrity controls changed records'
 result={'source':source,'target':target,'originalFailure':'model_runs_project_workspace_match','failedRestoreRolledBack':True,'defaultRestoreAfterMigration':True,'tablesCompared':len(tables),'rowsCompared':sum(json.loads(l)['rows'] for l in before.splitlines()),'recordsMatch':True,'validatedForeignKeys':4,'restoredIntegrityChecksPass':True,'controlsRolledBack':True,'migrationSha256':hashlib.sha256(migration.read_bytes()).hexdigest()}
 (out/'result.json').write_text(json.dumps(result,indent=2)+'\n')
 state['stage']='verified';save()
 print(json.dumps(result,indent=2))
finally:
 subprocess.run(['docker','exec',container,'rm',*remote_files],check=True,capture_output=True)
