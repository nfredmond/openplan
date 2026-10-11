"""Exact retained CLI and Storage observer functions, rebound to the new cluster."""
import datetime,hashlib,importlib.util,json,os,subprocess,time,types
from pathlib import Path
from urllib.parse import quote
import requests
import scope as native_scope, properties as props
from bridge import bridge
OUT=Path(__file__).parent;PROOF=OUT.parent;APP=Path('/home/nathaniel/.local/state/openplan/gtfs-current-main-join-20261011/openplan')
s=types.SimpleNamespace(API='http://127.74.9.10:29941',HEAD=native_scope.HEAD,require=native_scope.require)
spec=importlib.util.spec_from_file_location('api_file_custody',PROOF/'probe_worker_file_backup.py');files=importlib.util.module_from_spec(spec);spec.loader.exec_module(files)
record={'state':'prepared-api-continuation','cli':[],'http':{},'serviceStops':[]}
def stamp():return datetime.datetime.now(datetime.timezone.utc).isoformat()

def save(): (OUT/'progress-private.json').write_text(json.dumps(record,indent=2)+'\n')

def private_json(path,value):path.write_text(json.dumps(value,indent=2)+'\n');path.chmod(0o600)

def verify_cli_observation(exit_code,expected,stdout,observations,http,job,terminal,expected_terminal):
    s.require(exit_code==expected,'expanded-cli-exit')
    s.require(not any(row.get('computationRefused') or row.get('directNetworkRefused') for row in observations),'expanded-cli-unexpected-work')
    s.require(all(row.get('status')==200 for row in http),'expanded-cli-native-rpc')
    candidates=[row for row in http if row.get('path','').endswith('scan_gtfs_ingest_candidates')]
    s.require(len(candidates)==1 and candidates[0]['candidateEmpty'],'expanded-cli-native-empty-queue')
    completions=[row for row in http if row.get('path','').endswith('complete_gtfs_ingest')]
    s.require(bool(completions) and all(row['dropped']==(expected==2) for row in completions),'expanded-cli-completion-delivery')
    s.require(job['settled']==(expected==0),'expanded-cli-job-state')
    s.require(terminal==expected_terminal if expected==0 else terminal['resolved'] is False and terminal['receipt'] is None,'expanded-cli-terminal')
    s.require(('1 retained jobs unconfirmed' if expected==2 else '0 retained jobs unconfirmed') in stdout,'expanded-cli-planner-status')

def cli(root,key,label,drop,fixture,expected_terminal):
    observations=OUT/(label+'-observations-private.jsonl');observations.touch(mode=0o600,exist_ok=False)
    loader=APP/'node_modules/@esbuild/linux-x64/bin/esbuild';loader_version=json.loads((APP/'node_modules/esbuild/package.json').read_text())['version']
    record['http'][label]=[]
    with bridge(key,drop,record['http'][label]) as url:
        config={'bridge':url,'observations':str(observations),'loader':str(loader),'loaderService':'--service='+loader_version,'loaderSha256':files.digest(loader),'workerRoot':str(root),'flockSha256':files.digest(Path('/usr/bin/flock')),'catSha256':files.digest(Path('/usr/bin/cat'))}
        configuration=OUT/(label+'-cli-configuration-private.json');private_json(configuration,config)
        env={**os.environ,'NEXT_PUBLIC_SUPABASE_URL':s.API,'SUPABASE_SERVICE_ROLE_KEY':key,'OPENPLAN_GTFS_INSTALLATION_ID':fixture['expectedBinding']['installationId'],'OPENPLAN_GTFS_PARSER_BUILD':s.HEAD,'OPENPLAN_GTFS_WORK_DIR':str(root),'OPENPLAN_EXPANDED_CLI_PROOF_CONFIG':str(configuration),'NODE_OPTIONS':'--max-old-space-size=768'}
        started=time.monotonic()
        result=subprocess.run(['/usr/bin/node','--conditions=react-server','--import',str(OUT/'cli-preload.mjs'),'--import',str(APP/'node_modules/tsx/dist/loader.mjs'),str(APP/'scripts/workers/gtfs-ingestion.ts'),'--once'],cwd=APP,env=env,capture_output=True,text=True,timeout=90)
        (OUT/(label+'-cli-private.log')).write_text(result.stdout+result.stderr)
    rows=[json.loads(line) for line in observations.read_text().splitlines()]
    target_root=root/hashlib.sha256(s.API.encode()).hexdigest();job=json.loads((target_root/('version-'+fixture['versionId'])/'pending.json').read_text())
    terminals=list(target_root.glob('version-'+fixture['versionId']+'/attempt-*/commands/command-terminal/pending.json'));s.require(len(terminals)==1,'expanded-cli-terminal-census');terminal=json.loads(terminals[0].read_text())
    verify_cli_observation(result.returncode,2 if drop else 0,result.stdout,rows,record['http'][label],job,terminal,expected_terminal)
    record['cli'].append({'case':label,'exitCode':result.returncode,'wallSeconds':round(time.monotonic()-started,3),'jobSettled':job['settled'],'terminalResolved':terminal['resolved'],'spawnedLoaderServices':sum(row.get('loaderOnly',False) for row in rows),'nativeLockHolders':sum(row.get('lockHolderOnly',False) for row in rows),'computationAttempts':0,'sourceNetworkAttempts':0,'nativeCandidateCount':0});save()

def storage_readback(database,physical,key,label,expected=None):
    objects=json.loads(props.sql(database,"SELECT coalesce(json_agg(json_build_object('bucket',bucket_id,'name',name) ORDER BY bucket_id,name),'[]') FROM storage.objects"))
    physical_records=files.inventory(physical);allowed={row['sha256']:row['bytes'] for row in physical_records.values()}
    session=requests.Session();session.trust_env=False;actual=[]
    for obj in objects:
        s.require(all(part not in ('..','.') for part in obj['name'].split('/')) and not obj['name'].startswith('/'),'expanded-storage-name')
        with session.get(s.API+'/storage/v1/object/'+quote(obj['bucket'],safe='')+'/'+quote(obj['name'],safe='/'),headers={'apikey':key,'Authorization':'Bearer '+key},stream=True,timeout=30) as response:
            record.setdefault('storageResponses',[]).append({'label':label,'status':response.status_code});save();s.require(response.status_code==200,'expanded-storage-download');sha=hashlib.sha256();count=0
            for part in response.iter_content(65536):count+=len(part);s.require(count<=max(allowed.values()),'expanded-storage-bound');sha.update(part)
        value=sha.hexdigest();s.require(allowed.get(value)==count,'expanded-storage-bytes');actual.append({**obj,'bytes':count,'sha256':value})
    s.require(len(actual)==len(physical_records)==10,'expanded-storage-object-census')
    s.require(sorted((r['sha256'],r['bytes']) for r in actual)==sorted((r['sha256'],r['bytes']) for r in physical_records.values()),'expanded-storage-physical-census')
    if expected is not None:s.require(actual==expected,'expanded-storage-restored-readback')
    private_json(OUT/(label+'-storage-readback-private.json'),actual);return actual
