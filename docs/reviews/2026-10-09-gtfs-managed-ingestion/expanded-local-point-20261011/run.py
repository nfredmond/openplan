"""Expanded owned local point: installed CLI, database, Storage and GTFS roots."""
import copy,datetime,hashlib,importlib.util,json,os,re,secrets,shutil,subprocess,time,sys
from pathlib import Path
from urllib.parse import quote
import requests
import scope as s,properties as props,services
from bridge import bridge
OUT=Path(__file__).parent;PROOF=OUT.parent;APP=Path('/home/nathaniel/.local/state/openplan/gtfs-light-mode-join-20261011/openplan')
ROOTS={'configured':PROOF/'browser-full-restore-02/recovered-private/worker-private','replacement':PROOF/'browser-full-restore-02/recovered-private/replacement-worker-private','capacity':PROOF/'capacity-20261011-01/worker-private'}
TOOL=PROOF/'worker-backup-tool-20261011/restic';TOOL_SHA='20d4142678d0d95ec11a4759def1b73fd9190abc9ca19e4b62d067c0b387e639'
ORIGINAL_CONFIG=PROOF/'browser-full-restore-02/fresh-services-private.json'
UNITS=('openplan-gtfs-light-mode-preview-20261011-01.service','openplan-gtfs-cta-capacity-20261011-01.service','openplan-gtfs-counter-full-archive-20261011-01.service','openplan-gtfs-worker-file-replay-20261011-01.service','openplan-gtfs-coordinated-restore-20261011-03.service')
record={'state':'prepared','sourceHead':s.HEAD,'cli':[],'http':{},'commands':[],'serviceStops':[]};active=[];original_stopped=False

def load_module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
files=load_module('expanded_files',PROOF/'probe_worker_file_backup.py')
sys.path.append(str(PROOF/'transit-coordinated-restore-20261011-03'))
prior=load_module('expanded_native_image',PROOF/'transit-coordinated-restore-20261011-03/run.py');prior.OUT=OUT

def stamp():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def save(): (OUT/'progress-private.json').write_text(json.dumps(record,indent=2)+'\n')
def event(state):record['state']=state;record['updatedAt']=stamp();save();print(json.dumps({'state':state}),flush=True)
def private_json(path,value):path.write_text(json.dumps(value,indent=2)+'\n');path.chmod(0o600)
def run_command(args,label,stdin=None,stdout=None,env=None,timeout=180):
    started=time.monotonic();result=subprocess.run(args,stdin=stdin,stdout=stdout if stdout is not None else subprocess.PIPE,stderr=subprocess.PIPE,env=env,timeout=timeout)
    (OUT/(label+'-private.log')).write_bytes((result.stdout or b'')+result.stderr)
    record['commands'].append({'name':label,'exitCode':result.returncode,'wallSeconds':round(time.monotonic()-started,3)});save();s.require(result.returncode==0,'expanded-command-'+label);return result.stdout

def no_sessions(database):s.require(int(props.sql(database,"SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'"))==0,'expanded-existing-sessions')
def jobs(database):
    foreign=int(props.sql(database,'SELECT count(*) FROM pg_foreign_table'))
    scheduled=int(props.sql(database,'SELECT count(*) FROM cron.job')) if props.sql(database,"SELECT to_regclass('cron.job') IS NOT NULL")=='t' else 0
    outgoing=int(props.sql(database,'SELECT count(*) FROM net.http_request_queue')) if props.sql(database,"SELECT to_regclass('net.http_request_queue') IS NOT NULL")=='t' else 0
    return foreign,scheduled,outgoing

def restore(database,path,properties,commands,binding,label):
    existing=json.loads(props.sql('postgres','SELECT json_agg(datname) FROM pg_database'))
    run_command(props.creation_args(database,properties,existing),label+'-create')
    with path.open('rb') as stream:run_command(['docker','exec','-i',s.DB_ID,'pg_restore','-U','supabase_admin','-d',database,'--exit-on-error','--single-transaction'],label+'-restore',stdin=stream)
    props.apply(database,commands,binding,OUT);s.require(props.read(database)==properties,'expanded-properties-differ')

def dump(database,path,label):
    with path.open('xb') as stream:
        run_command(['docker','exec',s.DB_ID,'pg_dump','-U','supabase_admin','-d',database,'--format=custom'],label,stdout=stream);stream.flush();os.fsync(stream.fileno())

def restic(repository,password,args,label):
    env={k:v for k,v in os.environ.items() if not k.startswith('RESTIC_')};env.update(GOMAXPROCS='1',GOMEMLIMIT='384MiB')
    return run_command([str(TOOL),'--no-cache','--repo',str(repository),'--password-file',str(password),*args],label,env=env,timeout=300)

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

def signin(configuration,fixture):
    account=fixture['accounts']['owner'];session=requests.Session();session.trust_env=False
    with session.post(s.API+'/auth/v1/token?grant_type=password',headers={'apikey':configuration['anon_key']},json={'email':account['email'],'password':account['password']},timeout=20) as response:
        value=response.json();s.require(response.status_code==200 and value.get('user',{}).get('id')==account['id'] and isinstance(value.get('access_token'),str),'expanded-signin')
    record['syntheticUserSignin']=True;save()

def main():
    global original_stopped
    os.umask(0o077);record['startedAt']=stamp();plan=json.loads((OUT/'plan.json').read_text());snapshots=json.loads((OUT/'source-services-private.json').read_text());configuration=json.loads(ORIGINAL_CONFIG.read_text())
    s.verify_database(services.inspect(s.DB_ID))
    for kind in s.ORIGINALS:s.verify_original(kind,services.inspect(s.ORIGINALS[kind]))
    head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=APP,text=True).strip();dirty=subprocess.check_output(['git','status','--porcelain'],cwd=APP,text=True).strip()
    states=[subprocess.check_output(['systemctl','--user','show',unit,'-p','ActiveState','--value'],text=True).strip() for unit in UNITS]
    # Refuse another process using this exact app checkout or owned worker roots.
    for proc in Path('/proc').iterdir():
        if not proc.name.isdecimal() or int(proc.name)==os.getpid():continue
        try:
            cwd=(proc/'cwd').resolve();cmd=(proc/'cmdline').read_bytes().replace(b'\0',b' ').decode(errors='replace')
            s.require(not ((cwd==APP and '/node' in cmd) or any(str(root) in cmd for root in ROOTS.values())),'expanded-active-process')
        except (FileNotFoundError,PermissionError,ProcessLookupError):pass
    existing=json.loads(props.sql('postgres','SELECT json_agg(datname) FROM pg_database'))
    foreign,scheduled,outgoing=jobs(s.DATABASE);s.verify_plan(plan,head,dirty,existing,any(x in ('active','activating') for x in states),False,foreign,scheduled,outgoing)
    s.require(shutil.disk_usage(OUT).free>10*1024**3 and files.digest(TOOL)==TOOL_SHA,'expanded-capacity-tool')
    for name,root in ROOTS.items():
        census=files.inventory(root);s.require(len(census)==plan['gtfsRoots'][name]['files'] and sum(r['bytes'] for r in census.values())==plan['gtfsRoots'][name]['bytes'],'expanded-original-root-census')
    ips={services.inspect(identity)['NetworkSettings']['Networks'][s.NETWORK]['IPAddress'] for identity in s.ORIGINALS.values()}
    sessions=json.loads(props.sql(s.DATABASE,"SELECT coalesce(json_agg(host(client_addr)),'[]') FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'"));s.require(all(ip in ips for ip in sessions),'expanded-foreign-db-client')
    record['preflightPassed']=True;event('quiesce-owned-original-services')
    original_stopped=True;services.stop_original(snapshots);no_sessions(s.DATABASE)
    baseline=prior.inventory(s.DATABASE,'original-before');properties=props.read(s.DATABASE)
    original_census={name:files.inventory(root) for name,root in ROOTS.items()};original_storage=files.inventory(Path(s.STORAGE))
    bundle=OUT/'source-point-private';bundle.mkdir(mode=0o700);protected=bundle/'configuration-private';protected.mkdir(mode=0o700)
    for file in (ORIGINAL_CONFIG,PROOF/'browser-full-restore-02/app-runtime-private.env',Path(s.GATEWAY),OUT/'source-services-private.json'):shutil.copy2(file,protected/file.name);(protected/file.name).chmod(0o600)
    admission_config=json.loads((PROOF/'capacity-20261011-01/configuration-private.json').read_text());fixture_accounts=json.loads(Path(admission_config['fixturePath']).read_text());private_json(protected/'fixture-accounts-private.json',fixture_accounts)
    key_service={'name':s.DB_NAME,'id':s.DB_ID,'imageId':services.inspect(s.DB_ID)['Image'],'project':'openplan-restore-target-2026091050'}
    key_binding=props.archive._keys.inspect_binding(key_service);key=props.archive._keys.read_key(Path(key_binding['path']));props.archive._keys.require_mounted_bytes(key_service,key);props.archive._keys.preserve_key(protected/'pgsodium-root-private.key',key);record['mountedKeyCapturedAndReadVerified']=True
    roles=props.archive.role_inventory(s.DB_ID);(protected/'roles-inventory-private.json').write_text(roles)
    with (protected/'roles-private.sql').open('xb') as stream:run_command(['docker','exec',s.DB_ID,'pg_dumpall','-U','supabase_admin','--roles-only'],'roles-readonly-capture',stdout=stream)
    bindings={}
    for stage in ('source','target'):
        commands=props.property_commands(s.DATABASE,plan[stage+'Database']);path=protected/(stage+'-properties-private.sql');path.write_text(commands);bindings[stage]={'target':plan[stage+'Database'],'sha256':hashlib.sha256(commands.encode()).hexdigest()}
    private_json(protected/'properties-binding-private.json',bindings);private_json(protected/'database-properties-private.json',properties)
    private_json(protected/'runtime-root-mapping-private.json',{'logicalApi':s.API,'capturedRoots':{name:'gtfs-'+name for name in ROOTS},'cliRoot':'gtfs-capacity','storageRoot':'storage-objects','scope':'Three named GTFS roots retained separately. Runtime CLI path explicitly selected from restored point; original absolute paths are historical.'})
    dump(s.DATABASE,bundle/'postgres.dump','original-readonly-dump')
    for name,root in ROOTS.items():shutil.copytree(root,bundle/('gtfs-'+name));files.equal(original_census[name],files.inventory(bundle/('gtfs-'+name)))
    shutil.copytree(s.STORAGE,bundle/'storage-objects');files.equal(original_storage,files.inventory(bundle/'storage-objects'))
    prior.equal_image(baseline,prior.inventory(s.DATABASE,'original-after-readonly-capture'));no_sessions(s.DATABASE)
    source=plan['sourceDatabase'];target=plan['targetDatabase'];restore(source,bundle/'postgres.dump',properties,(protected/'source-properties-private.sql').read_text(),bindings['source'],'source');prior.equal_image(baseline,prior.inventory(source,'source-initial'))
    state={**configuration,'database':source};source_configuration=OUT/'source-kong-runtime-private.json';active.append((source,bundle/'storage-objects',source_configuration,state))
    services.start_stack('source',source,bundle/'storage-objects',protected/'kong-runtime-private.json',snapshots,OUT,state)
    object_manifest=storage_readback(source,bundle/'storage-objects',state['service_key'],'source')
    fixture=json.loads((PROOF/'capacity-20261011-01/capacity-native.json').read_text());root=bundle/'gtfs-capacity';version_path=root/hashlib.sha256(s.API.encode()).hexdigest()/('version-'+fixture['versionId']);job_path=version_path/'pending.json';terminal_path=next(version_path.glob('attempt-*/commands/command-terminal/pending.json'));expected_terminal=json.loads(terminal_path.read_text())
    pending=copy.deepcopy(expected_terminal);pending.update(resolved=False,receipt=None);private_json(terminal_path,pending);job=json.loads(job_path.read_text());job['settled']=False;private_json(job_path,job);s.verify_pending(job,pending,fixture['versionId'])
    private_json(protected/'expected-terminal-private.json',expected_terminal);private_json(protected/'object-manifest-private.json',object_manifest)
    event('installed-cli-real-reply-loss');cli(root,state['service_key'],'source-lost-completion-reply',True,fixture,expected_terminal)
    services.stop_stack(source,bundle/'storage-objects',source_configuration,OUT,state,record['serviceStops']);active.clear();no_sessions(source)
    prior.equal_image(baseline,prior.inventory(source,'source-after-reply-loss'));s.require(props.read(source)==properties,'expanded-source-properties-after')
    # Capture the now-unsettled queue together with its native committed receipt.
    event('expanded-quiesced-encrypted-capture');(bundle/'postgres.dump').rename(OUT/'original-retained.dump');dump(source,bundle/'postgres.dump','source-point-dump')
    census=files.inventory(bundle);private_json(OUT/'point-file-inventory-private.json',census);repository=OUT/'repository-private';password=OUT/'password-private';password.write_text(secrets.token_hex(32));password.chmod(0o600)
    restic(repository,password,['init','--repository-version','2'],'restic-init');raw=restic(repository,password,['backup','--json','--force',str(bundle)],'restic-backup');snapshot=next(json.loads(line)['snapshot_id'] for line in raw.decode().splitlines() if line.startswith('{') and json.loads(line).get('message_type')=='summary');s.require(re.fullmatch('[0-9a-f]{64}',snapshot),'expanded-snapshot-id')
    restic(repository,password,['check','--read-data'],'restic-full-data-check');restore_base=OUT/'target-restored-private';restic(repository,password,['restore',snapshot,'--target',str(restore_base),'--verify'],'restic-restore');restored=restore_base/bundle.relative_to('/');files.equal(census,files.inventory(restored));files.equal(census,files.inventory(bundle));no_sessions(source)
    captured_config=restored/'configuration-private';captured_props=json.loads((captured_config/'database-properties-private.json').read_text());captured_bindings=json.loads((captured_config/'properties-binding-private.json').read_text())
    restore(target,restored/'postgres.dump',captured_props,(captured_config/'target-properties-private.sql').read_text(),captured_bindings['target'],'target');prior.equal_image(baseline,prior.inventory(target,'target-before-cli'))
    event('installed-cli-restored-native-recovery');target_state={**json.loads((captured_config/'fresh-services-private.json').read_text()),'database':target};target_configuration=OUT/'target-kong-runtime-private.json';active.append((target,restored/'storage-objects',target_configuration,target_state))
    services.start_stack('target',target,restored/'storage-objects',captured_config/'kong-runtime-private.json',json.loads((captured_config/'source-services-private.json').read_text()),OUT,target_state)
    cli(restored/'gtfs-capacity',target_state['service_key'],'target-original-command-recovered',False,fixture,json.loads((captured_config/'expected-terminal-private.json').read_text()))
    prior.equal_image(baseline,prior.inventory(target,'target-after-cli'));s.require(props.read(target)==captured_props,'expanded-target-properties-after')
    storage_readback(target,restored/'storage-objects',target_state['service_key'],'target',json.loads((captured_config/'object-manifest-private.json').read_text()))
    signin(target_state,json.loads((captured_config/'fixture-accounts-private.json').read_text()));after_auth=prior.inventory(target,'target-after-signin')
    differences=[row['table'] for row,other in zip(baseline['tables'],after_auth['tables']) if row!=other];s.require(set(differences)<= {'auth.audit_log_entries','auth.users','auth.sessions','auth.refresh_tokens'},'expanded-signin-unrelated-record-change');record['signinChangedTables']=differences
    for name,root in ROOTS.items():files.equal(original_census[name],files.inventory(root))
    files.equal(original_storage,files.inventory(Path(s.STORAGE)));files.equal(census,files.inventory(bundle));prior.equal_image(baseline,prior.inventory(s.DATABASE,'original-final'));s.require(props.read(s.DATABASE)==properties and props.archive.role_inventory(s.DB_ID)==roles,'expanded-original-properties-roles-changed');props.archive._keys.require_mounted_bytes(key_service,key)
    source_complete=[row for row in record['http']['source-lost-completion-reply'] if row['path'].endswith('complete_gtfs_ingest')];target_complete=[row for row in record['http']['target-original-command-recovered'] if row['path'].endswith('complete_gtfs_ingest')];s.require({(r['requestSha256'],r['responseSha256']) for r in source_complete}=={(r['requestSha256'],r['responseSha256']) for r in target_complete},'expanded-exact-native-command-reply')
    record.update(state='passed-native',finishedAt=stamp(),snapshotId=snapshot,capturedFiles=len(census),capturedBytes=sum(r['bytes'] for r in census.values()),tables=len(baseline['tables']),sequences=len(baseline['sequences']),propertiesEqual=True,originalDurableFilesUnchanged=True,originalDatabaseUnchanged=True,allKnownGtfsRootsCaptured=True,storageObjectsReadBack=10,rolesCapturedReused=True,mountedKeyCapturedReused=True,targetDatabase=target,sourceDatabase=source,logicalApi=s.API,limits=plan['limits']);save();private_json(OUT/'result.json',record)
    # Leave only the fresh target API running for a separately identified T3 read.
    active.clear();print(json.dumps({'state':'passed-native','tables':record['tables'],'storageObjects':10,'installedCliCases':2}),flush=True)

if __name__=='__main__':
    try:main()
    except Exception as error:
        record.update(state='failed',errorType=type(error).__name__,reason=str(error) if isinstance(error,ValueError) else 'Inspect private traceback',failedAt=stamp());save()
        for database,storage,configuration,state in reversed(active):
            try:services.stop_stack(database,storage,configuration,OUT,state,record['serviceStops'])
            except Exception as cleanup:record.setdefault('cleanupErrors',[]).append(type(cleanup).__name__);save()
        if original_stopped:
            try:services.restart_original(json.loads((OUT/'source-services-private.json').read_text()));record['originalServicesRestartedAfterFailure']=True;save()
            except Exception as recovery:record['originalRecoveryErrorType']=type(recovery).__name__;save()
        raise
