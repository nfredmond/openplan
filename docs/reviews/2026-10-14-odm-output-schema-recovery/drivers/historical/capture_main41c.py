import hashlib,importlib.util,json,os,re,subprocess,time
from pathlib import Path
from urllib.parse import urlsplit
os.umask(0o077)
repo=Path('/home/nathaniel/.local/state/openplan/odm-output-schema-recovery-20261014');base=Path(__file__).parent;out=base/'capture-main41c-01';out.mkdir(mode=0o700)
fixture=base.parent/'odm-private-dispatch-producer-20261011/rpc-cli-09'
spec=importlib.util.spec_from_file_location('owned_rpc',repo/'docs/reviews/2026-10-12-odm-private-dispatch-reader/native_rpc_recovery.py');h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
pg=(fixture/'create-private-database-private.log').read_text().strip();rest=(fixture/'baseline-create-rest-private.log').read_text().strip()
def inspect(identity):return json.loads(subprocess.check_output(['docker','inspect',identity]))[0]
pv=inspect(pg);rv=inspect(rest)
for identity,v,image,memory in [(pg,pv,h.PG_IMAGE,1073741824),(rest,rv,h.REST_IMAGE,134217728)]:
 assert v['Id']==identity and v['Image']==image and v['Config']['Labels']['openplan.purpose']==h.PURPOSE
 assert v['HostConfig']['Memory']==v['HostConfig']['MemorySwap']==memory and not v['HostConfig']['PortBindings'] and not v['State']['Running']
network=next(iter(pv['NetworkSettings']['Networks']));net=json.loads(subprocess.check_output(['docker','network','inspect',network]))[0];assert net['Internal'] and net['Labels']['openplan.purpose']==h.PURPOSE
uri=urlsplit(dict(x.split('=',1) for x in rv['Config']['Env'] if '=' in x)['PGRST_DB_URI']);database=uri.path[1:];assert re.fullmatch('rpc_dispatch_[0-9a-f]{32}',database)
main='41cbd5a856c4da0824b408ac3ebabb459e205e3f';files=sorted((repo/'openplan/supabase/migrations').glob('*.sql'));expected=[p.name.split('_',1)[0] for p in files]
assert subprocess.check_output(['git','diff',main,'HEAD','--','openplan/supabase/migrations'],cwd=repo)==b''
def sql(query,label):
 p=subprocess.run(['docker','exec','-i',pg,'psql','-XqAt','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1'],input=query.encode(),capture_output=True,timeout=35);(out/(label+'-private.log')).write_bytes(p.stdout+p.stderr);assert p.returncode==0,'Owned inventory query failed: '+label;return p.stdout.decode().strip()
try:
 subprocess.run(['docker','start',pg],check=True,stdout=subprocess.DEVNULL)
 for _ in range(120):
  if subprocess.run(['docker','exec',pg,'pg_isready','-U','supabase_admin'],capture_output=True).returncode==0:break
  time.sleep(.25)
 else:raise TimeoutError('Owned inventory database readiness')
 versions=json.loads(sql('SELECT json_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations;','history'));missing=sorted(set(expected)-set(versions));extra=sorted(set(versions)-set(expected));assert missing==['20261017000002','20261017000005','20261017000006'] and not extra,'Retained schema must differ from current main only at the three identified migrations'
 useful=base.parent/'odm-useful-output-native-20261013/processing-05';r=json.loads(next((useful/'runtime').glob('original-dispatch-*/receipt.json')).read_bytes());job=r['applicationJob'];where='workspace_id='+h.quote(job['workspace_id'])+' AND user_id='+h.quote(job['created_by']);assert sql('SELECT role FROM public.workspace_members WHERE '+where+';','actor')=='member'
 assert sql('SELECT payload_sha256 FROM openplan_odm_private.original_dispatches WHERE job_id='+h.quote(job['id'])+';','original')==r['payloadSha256']
 dump=out/'source-before-upgrade.dump';log=out/'dump-private.log'
 with dump.open('xb') as target,log.open('wb') as errors:
  p=subprocess.run(['docker','exec',pg,'pg_dump','-U','supabase_admin','-d',database,'--format=custom'],stdout=target,stderr=errors,timeout=120);assert p.returncode==0,'Owned source capture failed';target.flush();os.fsync(target.fileno())
 digest=hashlib.sha256()
 with dump.open('rb') as stream:
  while chunk:=stream.read(1048576):digest.update(chunk)
 result={'schemaSourceMain':main,'sourceHistoryCount':len(versions),'expectedHistoryCount':len(expected),'missingMigrations':missing,'extraMigrations':extra,'sourceDump':{'bytes':dump.stat().st_size,'sha256':digest.hexdigest()},'migrationBindings':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in files},'originalPayloadSha256':r['payloadSha256'],'sourceActorRole':'member','scope':'same_cluster_populated_fixture_capture','hostedCapture':False}
 (out/'result.json').write_text(json.dumps(result,indent=2)+'\n');print({k:result[k] for k in ['sourceHistoryCount','expectedHistoryCount','missingMigrations','sourceDump']},flush=True)
finally:
 if inspect(pg)['State']['Running']:subprocess.run(['docker','stop','--time','120',pg],check=True,stdout=subprocess.DEVNULL)
 v=inspect(pg);assert not v['State']['Running'] and not v['State']['OOMKilled'];(out/'stopped.json').write_text(json.dumps({'id':pg,'running':False,'oomKilled':False,'memory':v['HostConfig']['Memory'],'memorySwap':v['HostConfig']['MemorySwap']})+'\n')
 group=Path('/sys/fs/cgroup')/Path('/proc/self/cgroup').read_text().split('0::',1)[1].strip().lstrip('/');(out/'resources.json').write_text(json.dumps({k:(group/k).read_text().strip() for k in ['memory.max','memory.peak','memory.swap.max','memory.swap.peak','memory.events']},indent=2)+'\n')
