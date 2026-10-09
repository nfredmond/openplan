"""Exercise the candidate relationship migration inside rolled-back native transactions."""
import hashlib,json,re,subprocess
from pathlib import Path
here=Path(__file__).resolve().parent
root=here.parents[2]
config=json.loads(Path('/home/nathaniel/.local/state/openplan/gtfs-recovery-http-20261009.json').read_text())
assert config['container']=='supabase_db_openplan-restore-target-2026091050'
assert config['database']=='openplan_attempt_cli_6f9ac02409884be888c0833872cbb36b'
command=['docker','exec','-i',config['container'],'psql','-U','supabase_admin','-d',config['database'],'-X','-qAt','-v','ON_ERROR_STOP=1']
def run(sql):return subprocess.run(command,input=sql,text=True,capture_output=True,timeout=40)
source=(root/'openplan/supabase/migrations/20261016000027_run_project_workspace_foreign_keys.sql').read_text()
body=re.sub(r'^(BEGIN|COMMIT);\s*$','',source,flags=re.M)
checks=(here/'verify-integrity.sql').read_text()
cases=[('baseline',body,None),('harmless',body+'\n-- harmless comment',None),('missing-model-scope',body+'\nALTER TABLE public.model_runs DROP CONSTRAINT model_runs_project_workspace_fk;','foreign workspace accepted: model_runs'),('restored',body,None)]
results=[]
for name,sql,reason in cases:
 r=run("BEGIN; SET LOCAL statement_timeout='30s';\n"+sql+'\n'+checks+'\nROLLBACK;')
 if (r.returncode==0)!=(reason is None) or (reason and reason not in r.stderr):raise RuntimeError(name+'\n'+r.stderr)
 cleanup=run("SELECT count(*) FROM pg_constraint WHERE conname='projects_id_workspace_restore_key';")
 assert cleanup.returncode==0 and cleanup.stdout.strip()=='0'
 results.append({'case':name,'expectedPass':reason is None,'exitCode':r.returncode,'expectedFailure':reason,'rolledBack':True})
bad_rows = """DO $fixture$
DECLARE w uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); p uuid:=gen_random_uuid();
BEGIN
 INSERT INTO public.workspaces(id,name,slug) VALUES(w,'Synthetic initial workspace','restore-'||w),(other,'Synthetic moved workspace','restore-'||other);
 INSERT INTO public.projects(id,workspace_id,name) VALUES(p,w,'Synthetic legacy parent drift');
 INSERT INTO public.runs(workspace_id,project_id,query_text) VALUES(w,p,'Synthetic existing mismatch');
 UPDATE public.projects SET workspace_id=other WHERE id=p;
END $fixture$;"""
r=run("BEGIN;\n"+bad_rows+'\n'+body+'\nROLLBACK;')
assert r.returncode!=0 and 'runs_project_workspace_fk' in r.stderr,'Invalid existing attribution did not refuse migration'
cleanup=run("SELECT count(*) FROM pg_constraint WHERE conname='projects_id_workspace_restore_key';")
assert cleanup.returncode==0 and cleanup.stdout.strip()=='0'
results.append({'case':'invalid-existing-attribution','expectedPass':False,'exitCode':r.returncode,'expectedFailure':'runs_project_workspace_fk','rolledBack':True})
print(json.dumps({'migrationSha256':hashlib.sha256(source.encode()).hexdigest(),'checksSha256':hashlib.sha256(checks.encode()).hexdigest(),'cases':results},indent=2))
