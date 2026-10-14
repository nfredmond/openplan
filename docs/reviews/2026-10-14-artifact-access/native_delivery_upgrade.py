"""Upgrade selected409 through pinned main/prerequisites, then restore guard custody."""
import argparse,hashlib,importlib.util,json,os,subprocess,time,uuid
from pathlib import Path
from urllib.parse import urlsplit,quote
PG='a79d62deecea7fd1d1099b35863ca3de50ef7f44618c3c130c9f5b34b024bed3'
REST='3c6255798df56cb37d42b9aa226123919409cbf5d50ce57c97c9000ecb76950f'
MAIN='122cfbbaa9235a4491b30fef733f7aa9bdb58465'
PREREQUISITES=[('11b6c3632f6cf5852633d59c70b7e11ae03915a3','20261017000009_owp_program_type.sql'),('6a921772cc82c75937dca0bac755e65dc33ee1a8','20261017000010_workspace_storage_quota.sql')]

def run(repo,out,variant='baseline'):
 os.umask(0o077);out.mkdir(mode=0o700,parents=True)
 spec=importlib.util.spec_from_file_location('guard',repo/'docs/reviews/2026-10-14-aerial-held-custody/native_guard.py');g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
 original=json.loads(next((g.PROFILE/'upgraded-runtime').glob('original-dispatch-*/receipt.json')).read_text())['applicationJob']
 inspect=lambda name:json.loads(subprocess.check_output(['docker','inspect',name]))[0]
 pg,rest=inspect(PG),inspect(REST)
 assert not pg['State']['Running'] and not rest['State']['Running']
 assert pg['Image']=='sha256:ca7871b587ca2c401ac0f325df6249c9aa0d25647ded34631158efc51176767f' and pg['Config']['Labels']['openplan.purpose']=='odm-private-dispatch-rpc-cli-20261012'
 assert pg['HostConfig']['Memory']==pg['HostConfig']['MemorySwap']==1073741824 and not pg['HostConfig']['PortBindings']
 network=next(iter(pg['NetworkSettings']['Networks']));env=dict(x.split('=',1) for x in rest['Config']['Env'] if '=' in x);uri=urlsplit(env['PGRST_DB_URI']);assert uri.path=='/'+g.SOURCE
 selected=subprocess.check_output(['git','ls-tree','-r','--name-only',MAIN,'openplan/supabase/migrations'],cwd=repo,text=True).splitlines()
 paths=[p for p in selected if p.endswith('.sql')];assert len(paths)==411
 main={Path(p).name:subprocess.check_output(['git','show',MAIN+':'+p],cwd=repo) for p in paths}
 prerequisites={name:subprocess.check_output(['git','show',sha+':openplan/supabase/migrations/'+name],cwd=repo) for sha,name in PREREQUISITES}
 candidate=repo/g.MIGRATION;candidate_bytes=candidate.read_bytes();delivery=repo/'openplan/supabase/migrations/20261017000012_aerial_delivery_authority.sql';delivery_bytes=delivery.read_bytes();bindings={name:hashlib.sha256(raw).hexdigest() for name,raw in {**main,**prerequisites,candidate.name:candidate_bytes,delivery.name:delivery_bytes}.items()}
 project=out/'cli-project';migrations=project/'supabase/migrations';migrations.mkdir(mode=0o700,parents=True)
 (project/'supabase/config.toml').write_bytes((repo/'openplan/supabase/config.toml').read_bytes())
 for name,raw in main.items():(migrations/name).write_bytes(raw)
 database='odm_held_upgrade_'+uuid.uuid4().hex;restored='odm_held_restore_'+uuid.uuid4().hex;job=str(uuid.uuid4());identifier=str(uuid.uuid4());sequence=0;started=False
 q=lambda v:"'"+str(v).replace("'","''")+"'"
 def sql(query,target=database,expected=0):
  nonlocal sequence
  sequence+=1;r=subprocess.run(['docker','exec','-i',PG,'psql','-XqAt','-U','postgres','-d',target,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],input=query,text=True,capture_output=True,timeout=30)
  (out/(str(sequence).zfill(3)+'-sql-private.log')).write_text(r.stdout+r.stderr)
  if expected is not None:assert r.returncode==expected,'Owned upgrade SQL succeeds'
  return r
 def history(target=database):return json.loads(sql('SELECT json_agg(version ORDER BY version)::text FROM supabase_migrations.schema_migrations;',target).stdout)
 def cli(label):
  nonlocal sequence
  sequence+=1;address=inspect(PG)['NetworkSettings']['Networks'][network]['IPAddress'];url='postgresql://postgres:'+quote(uri.password,safe='')+'@'+address+':5432/'+database+'?sslmode=disable'
  with (out/(str(sequence).zfill(3)+'-'+label+'-private.log')).open('wb') as log:
   try:
    r=subprocess.run([str(repo/'openplan/node_modules/.bin/supabase'),'migration','up','--db-url',url,'--workdir',str(project),'--include-all','--yes'],cwd=repo/'openplan',stdout=log,stderr=log,timeout=120)
   except subprocess.TimeoutExpired:raise TimeoutError('Owned migration CLI deadline: '+label) from None
  assert r.returncode==0,'Owned migration CLI succeeds: '+label
 def capture(target,label):
  path=out/(label+'.dump')
  with path.open('xb') as stream,(out/(label+'-dump-private.log')).open('wb') as log:
   r=subprocess.run(['docker','exec',PG,'pg_dump','-U','supabase_admin','-d',target,'--format=custom'],stdout=stream,stderr=log,timeout=120);assert r.returncode==0,'Owned held custody capture succeeds';stream.flush();os.fsync(stream.fileno())
  return {'path':path,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
 def custody(target=database):return sql('SELECT to_jsonb(c)::text FROM public.aerial_artifact_custody c WHERE id='+q(identifier)+';',target).stdout.strip()
 try:
  subprocess.run(['docker','start',PG],check=True,stdout=subprocess.DEVNULL);started=True
  for _ in range(180):
   if subprocess.run(['docker','exec',PG,'pg_isready','-U','postgres'],capture_output=True).returncode==0:break
   time.sleep(1)
  else:raise TimeoutError('Owned upgrade PostgreSQL readiness')
  assert sql('SELECT count(*) FROM pg_stat_activity WHERE datname='+q(g.SOURCE)+';','postgres').stdout.strip()=='0'
  sql('CREATE DATABASE '+database+' TEMPLATE '+g.SOURCE+';','postgres')
  before=history();assert len(before)==409 and set(before).issubset({n.split('_')[0] for n in main})
  sql('INSERT INTO public.aerial_processing_jobs(id,workspace_id,mission_id,created_by,request_id,status,imagery_url) VALUES ('+','.join(q(v) for v in [job,original['workspace_id'],original['mission_id'],original['created_by'],'upgrade-'+uuid.uuid4().hex,'succeeded','https://example.invalid/input.zip'])+');')
  sql('INSERT INTO public.aerial_artifact_custody(id,workspace_id,mission_id,processing_job_id,kind,ordinal,state,source_host,source_expires_at,storage_bucket,storage_path,byte_size,checksum_sha256,held_at) VALUES ('+','.join(q(v) for v in [identifier,original['workspace_id'],original['mission_id'],job,'orthomosaic',0,'held','example.invalid','2099-01-01T00:00:00Z','aerial-artifacts','proof/upgrade-original.tif',3,hashlib.sha256(bytes([1,2,3])).hexdigest(),'2026-10-14T12:00:00Z'])+');')
  saved=custody();cli('main-upgrade');assert history()==sorted(n.split('_')[0] for n in main),'Pinned main upgrade installs the exact411 migration history'
  for name,raw in prerequisites.items():(migrations/name).write_bytes(raw)
  cli('prerequisite-upgrade');assert history()==sorted(n.split('_')[0] for n in {**main,**prerequisites}),'Prerequisite upgrade installs exact9/10 before11'
  backup=capture(database,'fresh-before-guard')
  (migrations/candidate.name).write_bytes(candidate_bytes)
  cli('held-guard-upgrade');assert len(history())==414,'Intended preceding schema installs guard11'
  before_delivery=capture(database,'fresh-before-delivery')
  if variant!='missing-delivery':
   raw=delivery_bytes
   if variant=='member-delivery-allowed':raw=raw.replace(b'TO service_role;',b'TO service_role, authenticated;')
   if variant=='delivery-definer':raw=raw.replace(b'SECURITY INVOKER',b'SECURITY DEFINER')
   if variant=='delivery-search-path':raw=raw.replace(b'SET search_path = pg_catalog',b'SET search_path = pg_catalog, public')
   if variant=='missing-delivery-body':raw=b'-- Deliberately omitted delivery authority body.\n'
   (migrations/delivery.name).write_bytes(raw+(b'\n-- Harmless delivery proof comment.\n' if variant=='harmless' else b''))
  cli('delivery-upgrade');expected=sorted(n.split('_')[0] for n in bindings)
  assert history()==expected,'Candidate delivery upgrade installs exact415 migration history'
  assert custody()==saved,'Candidate upgrade preserves every original held row fact'
  cli('candidate-no-op');assert history()==expected and custody()==saved,'Candidate no-op preserves history and held row'
  after=capture(database,'candidate-after-upgrade')
  sql('CREATE DATABASE '+restored+" TEMPLATE template0 OWNER postgres ENCODING 'UTF8';",'postgres')
  with after['path'].open('rb') as stream,(out/'restore-private.log').open('wb') as log:
   r=subprocess.run(['docker','exec','-i',PG,'pg_restore','-U','supabase_admin','-d',restored,'--exit-on-error','--single-transaction'],stdin=stream,stdout=log,stderr=log,timeout=120);assert r.returncode==0,'Candidate held custody dump restores'
  assert history(restored)==expected and custody(restored)==saved,'Restored candidate preserves exact history and held facts'
  error=sql("UPDATE public.aerial_artifact_custody SET storage_path='proof/changed.tif' WHERE id="+q(identifier)+';',restored,expected=None)
  assert error.returncode==3 and '23514: Original held aerial custody cannot be replaced' in error.stderr,'Restored guard rejects held fact replacement'
  assert custody(restored)==saved,'Restored rejection preserves every original row fact'
  if variant=='member-update-allowed':
   sql('CREATE POLICY held_restore_broken_update ON public.aerial_artifact_custody FOR UPDATE TO authenticated USING (true) WITH CHECK (true);',restored)
  claims=q(json.dumps({'role':'authenticated','sub':original['created_by']}));setup='SET ROLE authenticated; SET request.jwt.claims='+claims+'; '
  assert sql(setup+'SELECT count(*) FROM public.aerial_artifact_custody WHERE id='+q(identifier)+';',restored).stdout.strip()=='1','Restored member fixture sees held original'
  assert sql(setup+'WITH changed AS (UPDATE public.aerial_artifact_custody SET attempt_count=999 WHERE id='+q(identifier)+' RETURNING id) SELECT count(*) FROM changed;',restored).stdout.strip()=='0','Restored visible member remains unable to write'
  assert custody(restored)==saved,'Restored member refusal preserves original facts'
  function="public.read_aerial_delivery_authority(text,text,text,text,text,jsonb)"
  exists=sql("SELECT to_regprocedure('"+function+"') IS NOT NULL;",restored).stdout.strip()
  assert exists=='t','Restored delivery authority exists'
  privileges=sql("SELECT json_build_array(has_function_privilege('service_role','"+function+"','EXECUTE'),has_function_privilege('authenticated','"+function+"','EXECUTE'),has_function_privilege('anon','"+function+"','EXECUTE'))::text;",restored).stdout.strip()
  assert json.loads(privileges)==[True,False,False],'Restored delivery authority stays service only'
  assert sql("SELECT NOT prosecdef AND proconfig=ARRAY['search_path=pg_catalog'] FROM pg_proc WHERE oid='"+function+"'::regprocedure;",restored).stdout.strip()=='t','Restored delivery authority stays invoker with pinned search path'

  report={'selectedMain':MAIN,'prerequisiteCommits':dict((name,sha) for sha,name in PREREQUISITES),'variant':variant,'historyBefore':409,'historyMain':411,'historyPrerequisites':413,'historyBeforeDelivery':414,'historyCandidate':415,'retainedDatabases':[database,restored],'freshBackup':{k:v for k,v in backup.items() if k!='path'},'beforeDeliveryCapture':{k:v for k,v in before_delivery.items() if k!='path'},'restoredCapture':{k:v for k,v in after.items() if k!='path'},'restoredDeliveryAuthority':True,'originalRowPreserved':True,'restoredGuard':True,'restoredMemberVisibleRows':1,'scope':'same-cluster representative database fixture and logical restore through exact9/10/11/12;10 source remains a pinned branch prerequisite; no hosted backup/restore, Storage restore, login, global-role or separate-host acceptance'}
  (out/'result.json').write_text(json.dumps(report,indent=2)+'\n');(out/'bindings.json').write_text(json.dumps(bindings,indent=2)+'\n');print(report)
 finally:
  assert candidate.read_bytes()==candidate_bytes and delivery.read_bytes()==delivery_bytes,'Upgrade fixture never mutates candidate sources'
  if started:subprocess.run(['docker','stop','--time','120',PG],check=True,stdout=subprocess.DEVNULL)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--variant',choices=['baseline','harmless','missing-delivery','missing-delivery-body','member-delivery-allowed','delivery-definer','delivery-search-path','restored'],default='baseline');a=p.parse_args();run(a.repo.resolve(),a.out.resolve(),a.variant)
