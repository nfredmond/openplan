"""Prove candidate-clone preflight refusals without connecting fake targets."""
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch
import hashlib,io,json,subprocess,sys,traceback
here=Path(__file__).resolve().parent;root=here.parents[2];script=here/'prepare_browser_database.py';source=script.read_text();out=Path(sys.argv[1]).resolve();out.mkdir(mode=0o700,parents=True,exist_ok=False)
versions=sorted(p.name.split('_')[0] for p in (root/'openplan/supabase/migrations').glob('*.sql'))
source_database='openplan_attempt_cli_'+'a'*32
variants=[('baseline',None),('harmless',None),('wrong-container',"assert container=="),('wrong-database',"assert re.fullmatch"),('wrong-ledger',"SELECT version FROM supabase_migrations"),('busy-source',"SELECT count(*) FROM pg_stat_activity"),('oversized-source',"SELECT pg_database_size"),('different-auth-schema',"assert auth_schema(source['database'])==schema"),('empty-auth-ledger',"assert source_auth and all"),('malformed-auth-version',"assert source_auth and all"),('unexpected-existing-auth-version',"assert set(existing)<=set(source_auth)"),('different-clone-schema',"assert auth_schema(database)==schema"),('incomplete-clone-auth-ledger',"assert sql(database,'SELECT version FROM auth.schema_migrations"),('changed-source-auth-schema',"assert auth_schema(database)==schema and auth_schema('postgres')==schema"),('changed-template-auth-schema',"assert auth_schema(database)==schema and auth_schema('postgres')==schema"),('changed-clone-auth-records',"assert sql(database,auth_rows)==source_auth_rows"),('changed-template-auth-records',"assert sql(database,auth_rows)==source_auth_rows"),('changed-source-gtfs',"assert sql(source['database'],\"SELECT md5"),('wrong-auth-role',"assert auth_uri.username"),('missing-auth-password',"assert auth_uri.username"),('wrong-auth-host',"assert auth_uri.hostname"),('auth-writer-denied',"SELECT has_table_privilege"),('restored',None)]
records=[]
for name,assertion in variants:
 directory=out/name;directory.mkdir(mode=0o700);config=directory/'source.json';config.write_text(json.dumps({'container':'other-container' if name=='wrong-container' else 'supabase_db_openplan-restore-target-2026091050','database':'postgres' if name=='wrong-database' else source_database})+'\n')
 calls=[];counts={};created=None
 def run(command,**kwargs):
  global created
  if command[:2]==['docker','inspect']:
   role='other_role' if name=='wrong-auth-role' else 'supabase_auth_admin';host='other-host' if name=='wrong-auth-host' else 'supabase_db_openplan-restore-target-2026091050';password='' if name=='missing-auth-password' else ':synthetic-proof-password'
   text=json.dumps([{'Config':{'Env':[f'GOTRUE_DB_DATABASE_URL=postgresql://{role}{password}@{host}/postgres']}}]);return subprocess.CompletedProcess(command,0,text,'')
  calls.append({'operation':command[3] if command[:2]==['docker','exec'] else command[0],'database':command[command.index('-d')+1]})
  database=command[command.index('-d')+1];statement=kwargs.get('input','');key=(database,statement or 'schema');counts[key]=counts.get(key,0)+1
  if 'pg_dump' in command:
   text='CREATE TABLE auth.fixture(id uuid);'
   if name=='different-auth-schema' and database==source_database:text+=' changed'
   if name=='different-clone-schema' and database not in ['postgres',source_database]:text+=' changed'
   if name=='changed-source-auth-schema' and database=='postgres' and counts[key]>1:text+=' changed'
   if name=='changed-template-auth-schema' and database==source_database and counts[key]>1:text+=' changed'
  elif 'supabase_migrations.schema_migrations' in statement:text='\n'.join(versions[:-1] if name=='wrong-ledger' else versions)
  elif 'pg_stat_activity' in statement:text='1' if name=='busy-source' else '0'
  elif 'pg_database_size' in statement:text=str(2*1024**3 if name=='oversized-source' else 1024)
  elif 'SELECT version FROM auth.schema_migrations' in statement:
   if database=='postgres':text='' if name=='empty-auth-ledger' else 'invalid' if name=='malformed-auth-version' else '20200101\n20210101'
   elif database==source_database:text='19990101' if name=='unexpected-existing-auth-version' else '20200101'
   else:text='20200101' if name=='incomplete-clone-auth-ledger' else '20200101\n20210101'
  elif statement.startswith('CREATE DATABASE'):created=statement.split()[2];text=''
  elif statement.startswith('INSERT INTO auth.schema_migrations'):text=''
  elif 'SELECT has_table_privilege' in statement:text='f' if name=='auth-writer-denied' else 't'
  elif "jsonb_build_object('users'" in statement:
   text='auth records unchanged'
   if name=='changed-clone-auth-records' and database not in ['postgres',source_database]:text='changed'
   if name=='changed-template-auth-records' and database==source_database and counts[key]>1:text='changed'
  elif statement.startswith('SELECT md5'):
   text='GTFS records unchanged'
   if name=='changed-source-gtfs' and counts[key]>1:text='changed'
  else:raise RuntimeError('Unrecognized simulated preflight statement')
  return subprocess.CompletedProcess(command,0,text,'')
 observed=None
 try:
  with patch.object(sys,'argv',[str(script),str(config),str(directory/'candidate')]),patch.object(subprocess,'run',run),redirect_stdout(io.StringIO()):
   exec(compile(source+ ('\n# Harmless preflight comment.\n' if name=='harmless' else ''),str(script),'exec'),{'__file__':str(script),'__name__':'__main__'})
 except AssertionError as error:
  frame=traceback.extract_tb(error.__traceback__)[-1];observed=source.splitlines()[frame.lineno-1]
  assert assertion and assertion in observed,(name,observed)
 else:assert assertion is None,(name,'broken preflight survived')
 for filename in ['database.json','preparation.json']:
  artifact=directory/'candidate'/filename
  if artifact.exists():
   simulated=json.loads(artifact.read_text());simulated['simulationOnly']=True;artifact.write_text(json.dumps(simulated,indent=2)+'\n');artifact.rename(artifact.with_name('simulated-'+filename))
 records.append({'variant':name,'result':'expected assertion failure' if assertion else 'pass','assertion':observed,'simulatedCalls':len(calls),'cloneStatementReached':created is not None});print(name,records[-1]['result'],flush=True)
(out/'result.json').write_text(json.dumps({'records':records,'sourceSha256':hashlib.sha256(script.read_bytes()).hexdigest(),'runnerSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'boundary':'Controlled CLI/schema/row metadata and fake subprocess transport. No fake target is contacted. Native clone, schema/record equality, Auth login and application journeys require separate real evidence.'},indent=2)+'\n')
