import json,subprocess
from pathlib import Path
p=Path('/home/nathaniel/.local/state/openplan/recovery-integration-acceptance-8611f4af')
s=json.loads((p/'state.json').read_text())
assert s['database']=='openplan_acceptance_0c03584249c04ac990c9214566bf2fc0'
cmd=['docker','exec','-i',s['container'],'psql','-U','supabase_admin','-d',s['database'],'-X','-qAt','-v','ON_ERROR_STOP=1']
def sql(text):
 r=subprocess.run(cmd,input=text,text=True,capture_output=True,timeout=60)
 if r.returncode: raise RuntimeError(r.stderr)
 return r.stdout.strip()
assert sql("SELECT count(*) FROM pg_class WHERE relnamespace='auth'::regnamespace;")=='0'
sql('ALTER SCHEMA auth OWNER TO supabase_admin;')
with (p/'acceptance-source.dump').open('rb') as f:
 r=subprocess.run(['docker','exec','-i',s['container'],'pg_restore','--list'],stdin=f,capture_output=True,check=True)
lines=r.stdout.decode().splitlines()
removed=[l for l in lines if ' SCHEMA - auth ' in l or ' SCHEMA - _realtime ' in l]
assert len(removed)==2
ordered=[l for l in lines if l not in removed]
projects=[l for l in ordered if ' TABLE DATA public projects ' in l]
assert len(projects)==1
ordered.remove(projects[0])
first_data=next(i for i,l in enumerate(ordered) if ' TABLE DATA ' in l)
ordered.insert(first_data,projects[0])
(p/'resume.list').write_text('\n'.join(ordered)+'\n')
remote='/tmp/openplan-acceptance-0c035842-resume.list'
subprocess.run(['docker','cp',str(p/'resume.list'),s['container']+':'+remote],check=True,capture_output=True)
dump_remote='/tmp/openplan-acceptance-0c035842-source.dump'
subprocess.run(['docker','cp',str(p/'acceptance-source.dump'),s['container']+':'+dump_remote],check=True,capture_output=True)
try:
 r=subprocess.run(['docker','exec',s['container'],'pg_restore','-U','supabase_admin','-d',s['database'],'--exit-on-error','--single-transaction','--use-list='+remote,dump_remote],capture_output=True,timeout=180)
 if r.returncode:
  (p/'resume-error.log').write_bytes(r.stderr)
  raise RuntimeError('Restore failed; transaction rolled back and private error retained')
finally:
 subprocess.run(['docker','exec',s['container'],'rm',remote,dump_remote],check=True,capture_output=True)
s['stage']='restored'
(p/'state.json').write_text(json.dumps(s,indent=2)+'\n')
repo=Path('/home/nathaniel/.local/state/openplan/v1-recovery-integration-20261009')
for i in (24,25,26):
 f=next((repo/'openplan/supabase/migrations').glob('202610160000'+str(i)+'_*.sql'))
 sql(f.read_text())
 sql("INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('"+f.name.split('_')[0]+"','"+f.stem[15:]+"',ARRAY[]::text[]) ON CONFLICT(version) DO NOTHING;")
s['stage']='ready-for-services'
s['catalog']=json.loads(sql("SELECT json_build_object('models',(SELECT count(*) FROM public.models),'projects',(SELECT count(*) FROM public.projects),'users',(SELECT count(*) FROM auth.users));"))
(p/'state.json').write_text(json.dumps(s,indent=2)+'\n')
print(json.dumps(s))
