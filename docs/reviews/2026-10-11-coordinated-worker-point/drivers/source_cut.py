"""Capture one stopped-writer source fixture with actual lost native KPI reply."""
from contextlib import closing
import hashlib,importlib.util,json,os,secrets,shutil,subprocess,sys,time,uuid
from pathlib import Path
import requests
import transport as transport
import cut_guards as guards

OUT=Path(__file__).parent
POINT=OUT.parent
BASE=POINT.parent
REPO=Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-20261009')
ROLE=POINT/'source-cluster'
API=POINT/'source-api-02'
sys.path.insert(0,str(REPO/'workers/aequilibrae_worker'))
import model_command_client as client
import model_command_journal as journal
import model_legacy_kpi_command as kpi
import model_stage_computation as computation


def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


root=load('coordinated_known_root',REPO/'docs/reviews/2026-10-11-coordinated-worker-point/worker_root.py')
files=load('coordinated_point_files',BASE/'probe_worker_file_backup.py')
image=load('coordinated_point_native_image',BASE/'transit-coordinated-restore-20261011-03/run.py')
record={'state':'prepared','events':[],'commands':[],'scientificAcceptance':'unassessed'}
keepers=[]


def save():
    (OUT/'cut-progress-private.json').write_text(json.dumps(record,indent=2)+'\n')


def command(args,label,timeout=120,env=None):
    result=subprocess.run(args,capture_output=True,timeout=timeout,env=env)
    (OUT/(label+'-private.log')).write_bytes(result.stdout+result.stderr)
    record['commands'].append({'name':label,'exitCode':result.returncode});save();result.check_returncode()
    return result.stdout


def main():
    os.umask(0o077);started=time.monotonic()
    sys.path.insert(0,str(API));import services as service;import network_scope as network
    source_guard=load('coordinated_source_guard',ROLE/'guards.py')
    receipt=json.loads((ROLE/'container-receipt.json').read_text())
    connection=json.loads((API/'source-rest-connection-private.json').read_text())
    rest=json.loads((API/'source-rest-receipt-private.json').read_text())
    database=connection['database']
    network.verify_database_attachment(service.inspect(receipt['id']),receipt,'openplan_modelpoint_source_20261011_01',ROLE/'mounted-root-private.key',source_guard.verify_container,True)
    service.verify_new('rest',service.inspect(rest['id']),rest,database,Path('/unused'),Path('/unused'))
    record['executionSourceSha256']={p.name:files.digest(p) for p in OUT.glob('*.py')}
    record['helperSourceSha256']={str(p.relative_to(REPO)):files.digest(p) for p in [REPO/'docs/reviews/2026-10-11-coordinated-worker-point/worker_root.py',REPO/'openplan/scripts/ops/worker_journal_snapshot.py',*(REPO/'workers/aequilibrae_worker'/name for name in ('model_command_client.py','model_command_journal.py','model_legacy_kpi_command.py','model_command_recovery.py','model_stage_computation.py'))]}
    image.CONTAINER=receipt['id'];image.OUT=OUT/'native-images';image.OUT.mkdir(mode=0o700)
    before=image.inventory(database,'source-before-synthetic')
    before_models=json.loads(image.sql(database,"SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.models m"))
    (OUT/'before-models-private.json').write_text(json.dumps(before_models,indent=2)+'\n')
    run,stage=str(uuid.uuid4()),str(uuid.uuid4())
    record.update(runId=run,stageId=stage,sourceDatabaseId=receipt['id'],sourceDatabase=database,sourceRestId=rest['id']);save()
    seed="INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by) SELECT '"+run+"',workspace_id,model_id,'aequilibrae','queued','Synthetic coordinated worker recovery',created_by FROM public.model_runs WHERE NOT attempt_managed ORDER BY id LIMIT 1 RETURNING workspace_id"
    workspace=str(uuid.UUID(image.sql(database,seed)))
    image.sql(database,"INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES('"+stage+"','"+run+"','Synthetic local journal recovery','queued',1)")
    worker=OUT/'worker-source';worker.mkdir(mode=0o700)
    for name in ('inputs','outputs','scratch/empty','commands','stages'):(worker/name).mkdir(mode=0o700,parents=True)
    (worker/'inputs/source.bin').write_bytes(bytes(range(256)))
    (worker/'outputs/result.json').write_bytes(b'{"synthetic":true,"scientificAcceptance":"unassessed"}\n')
    for name in ('commands','stages'):
        keeper=journal.connect(worker/name);keeper.execute('PRAGMA wal_checkpoint(TRUNCATE)');keeper.execute('PRAGMA wal_autocheckpoint=0');keepers.append(keeper)
    bridge_connection={'url':connection['url'],'token':connection['service_token']}
    with transport.bridge(bridge_connection,True,record['events']) as origin:
        scope={'base_url':origin,'deployment_id':'6bdd3b83-c653-48d1-9b7b-b68c19f0c1d0'}
        payload={'run_id':run,'stage_id':stage,'kpi_name':'recovery_fixture','kpi_label':'Synthetic custody test','kpi_category':'general','value':0,'unit':'fixture','geometry_ref':None,'breakdown_json':None}
        pending=kpi.prepare(worker/'commands',workspace,payload,name='lost-reply',**scope)
        record.update(logicalScope=scope,pendingCommand=pending,workspaceId=workspace,state='prepared-native-command');save()
        cli=subprocess.run([sys.executable,'-B',str(REPO/'workers/aequilibrae_worker/model_command_recovery.py'),'--journal',str(worker/'commands'),'--base-url',origin,'--deployment-id',scope['deployment_id'],'--request-id',pending['request_id']],env={**os.environ,'SUPABASE_SERVICE_ROLE_KEY':connection['service_token']},capture_output=True,timeout=45)
        (OUT/'original-cli-private.log').write_bytes(cli.stdout+cli.stderr)
        guards.verify_lost(cli.returncode,json.loads(cli.stdout),record['events'])
        guards.verify_pending(journal.read_existing(worker/'commands',client.destination(**scope),pending['request_id']),pending)
        resolved=kpi.prepare(worker/'commands',workspace,payload,name='resolved-receipt',**scope)
        statuses=[]
        def post(url,**kwargs):
            transport.verify_request('POST',url.removeprefix(origin),len(json.dumps(kwargs['json']).encode()),kwargs['headers']['Authorization']=='Bearer '+connection['service_token'])
            response=requests.post(connection['url']+'/rpc/record_legacy_model_kpi',**kwargs);statuses.append(response.status_code);return response
        retained=client.deliver(worker/'commands',resolved,**scope,service_key=connection['service_token'],post=post)
        saved=journal.read_existing(worker/'commands',client.destination(**scope),resolved['request_id'])[0]['response']
        guards.verify_resolved(statuses[0],retained,saved)
        args={**scope,'run_id':run,'stage_id':stage,'inputs':{'synthetic':True}}
        computation.compute_once(worker/'stages',**args,name='completed',compute=lambda:{'fixture':True})
        class Interrupted(Exception):pass
        def interrupted():raise Interrupted()
        try:computation.compute_once(worker/'stages',**args,name='interrupted',compute=interrupted)
        except Interrupted:pass
        (worker/'state.json').write_text(json.dumps({'synthetic':True,'logicalScope':scope,'runId':run,'stageId':stage,'pendingRequestId':pending['request_id'],'resolvedRequestId':resolved['request_id'],'scientificAcceptance':'unassessed'},indent=2)+'\n')
    service.verify_new('rest',service.inspect(rest['id']),rest,database,Path('/unused'),Path('/unused'))
    command(['docker','stop','--time','5',rest['id']],'quiesce-exact-source-rest',30)
    image.no_sessions(database)
    after=image.inventory(database,'source-after-synthetic-commands')
    guards.verify_seed_delta(before,after)
    model_graph=json.loads(image.sql(database,"SELECT jsonb_build_object('modelId',r.model_id,'createdAt',r.created_at,'modelsAfter',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.models m),'newEnrollment',(SELECT to_jsonb(e) FROM public.model_execution_custody_enrollment e WHERE e.run_id=r.id),'observedAfterRun',(SELECT e.observed_at>=r.created_at FROM public.model_execution_custody_enrollment e WHERE e.run_id=r.id)) FROM public.model_runs r WHERE r.id='"+run+"'"))
    enrollment_after=json.loads(image.sql(database,"SET search_path TO public,extensions; SELECT json_build_object('count',count(*),'sha256',encode(digest(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text),''),'sha256'),'hex')) FROM public.model_execution_custody_enrollment t WHERE t.run_id<>'"+run+"'"))
    enrollment_before=next(row for row in before['tables'] if row['table']=='public.model_execution_custody_enrollment')
    guards.verify_trigger_graph(before_models,model_graph['modelsAfter'],model_graph['modelId'],model_graph['createdAt'],{key:enrollment_before[key] for key in ('count','sha256')},enrollment_after,model_graph['newEnrollment'],run,model_graph['observedAfterRun'])
    (OUT/'trigger-graph-private.json').write_text(json.dumps(model_graph,indent=2)+'\n')
    record.update(state='quiescent-source-capture',sourceWritersStopped=True,sourceRestStopped=True);save()
    logical={name:root.sqlite_image(worker/name/'model-commands.sqlite3') for name in ('commands','stages')}
    worker_before={name:value for name,value in root.inventory(worker).items() if name not in {'commands/model-commands.sqlite3-shm','stages/model-commands.sqlite3-shm'}}
    raw={name:{suffix:files.digest(worker/name/('model-commands.sqlite3'+suffix)) for suffix in ('','-wal')} for name in logical}
    snapshots=OUT/'journal-snapshots';snapshots.mkdir(mode=0o700)
    for name in logical:
        command([sys.executable,'-B',str(REPO/'openplan/scripts/ops/worker_journal_snapshot.py'),'--source',str(worker/name/'model-commands.sqlite3'),'--destination',str(snapshots/name),'--writers-quiesced'],name+'-actual-snapshot',30)
        root.equal_journal(logical[name],root.sqlite_image(snapshots/name/'model-commands.sqlite3'))
    bundle=OUT/'point-private'
    base_bundle=BASE/'transit-expanded-local-point-20261011-03/source-point-private'
    original_census=files.inventory(base_bundle)
    shutil.copytree(base_bundle,bundle)
    files.equal(original_census,files.inventory(bundle))
    (bundle/'postgres.dump').unlink()
    image.dump(database,bundle/'postgres.dump','coordinated-native-dump')
    model=bundle/'model-worker-private'
    def sidecars(directory,names):return [name for name in names if name in {'model-commands.sqlite3','model-commands.sqlite3-wal','model-commands.sqlite3-shm'}] if Path(directory) in {worker/'commands',worker/'stages'} else []
    shutil.copytree(worker,model,ignore=sidecars)
    for name in logical:shutil.copy2(snapshots/name/'model-commands.sqlite3',model/name/'model-commands.sqlite3')
    census=root.inventory(model)
    protected=bundle/'configuration-private'
    property_scope=sys.modules['scope'];sys.modules['scope']=load('modelpoint_fresh_property_scope',POINT/'fresh-source-03/scope.py')
    actual_properties=load('modelpoint_fresh_properties',POINT/'fresh-source-03/properties.py')
    sys.modules['scope']=property_scope
    bindings={}
    for phase in ('source','target'):
        properties_sql=actual_properties.property_commands(database,database)
        (protected/(phase+'-properties-private.sql')).write_text(properties_sql)
        bindings[phase]={'target':database,'sha256':hashlib.sha256(properties_sql.encode()).hexdigest()}
    (protected/'properties-binding-private.json').write_text(json.dumps(bindings,indent=2)+'\n')
    (protected/'database-properties-private.json').write_text(json.dumps(actual_properties.read(database),indent=2)+'\n')
    (protected/'model-worker-root-inventory-private.json').write_text(json.dumps(census,indent=2)+'\n')
    (protected/'model-worker-logical-journals-private.json').write_text(json.dumps(logical,indent=2)+'\n')
    (protected/'model-worker-source-scope-private.json').write_text(json.dumps({'logicalScope':scope,'pendingCommand':pending,'sourceHead':'9446f76af65106897eb8a693c5aff9817de5de7f','sourceDatabaseId':receipt['id'],'sourceDatabase':database,'journalSnapshotMapping':{name+'/model-commands.sqlite3':name for name in logical}},indent=2)+'\n')
    image.equal_image(after,image.inventory(database,'source-after-capture'))
    for name in logical:
        root.equal_journal(logical[name],root.sqlite_image(worker/name/'model-commands.sqlite3'))
        root.equal_root(raw[name],{suffix:files.digest(worker/name/('model-commands.sqlite3'+suffix)) for suffix in raw[name]})
    root.equal_root(worker_before,{name:value for name,value in root.inventory(worker).items() if name not in {'commands/model-commands.sqlite3-shm','stages/model-commands.sqlite3-shm'}})
    files.equal(original_census,files.inventory(base_bundle))
    complete=files.inventory(bundle)
    (OUT/'coordinated-point-file-inventory-private.json').write_text(json.dumps(complete,indent=2)+'\n')
    (OUT/'captured-native-image-private.json').write_text(json.dumps(after,indent=2)+'\n')
    password=OUT/'password-private';password.write_text(secrets.token_urlsafe(48)+'\n');password.chmod(0o600)
    tool=BASE/'worker-backup-tool-20261011/restic'
    env={**os.environ,'GOMAXPROCS':'1','GOMEMLIMIT':'512MiB'}
    def restic(args,label):return command([str(tool),'--no-cache','--repo',str(OUT/'repository-private'),'--password-file',str(password),*args],label,300,env)
    restic(['init'],'coordinated-repository-init')
    result=json.loads(restic(['backup','--json',str(bundle)],'coordinated-encrypted-backup').decode().strip().splitlines()[-1])
    restic(['check','--read-data'],'coordinated-encrypted-read-check')
    snapshot=result['snapshot_id']
    restic(['restore',snapshot,'--target',str(OUT/'restored-private'),'--verify'],'coordinated-file-restore')
    restored=OUT/'restored-private'/bundle.relative_to('/')
    files.equal(complete,files.inventory(restored));files.equal(complete,files.inventory(bundle))
    root.equal_root(census,root.inventory(restored/'model-worker-private'))
    for name in logical:root.equal_journal(logical[name],root.sqlite_image(restored/'model-worker-private'/name/'model-commands.sqlite3'))
    image.no_sessions(database);image.equal_image(after,image.inventory(database,'source-final'))
    record.update(state='passed-native-source-point',snapshotId=snapshot,wallSeconds=round(time.monotonic()-started,3),capturedFiles=len(complete),capturedBytes=sum(row['bytes'] for row in complete.values()),modelRootFiles=sum(row['kind']=='file' for row in census.values()),modelRootDirectories=sum(row['kind']=='directory' for row in census.values()),populatedJournals=2,originalPointUnchanged=True,sourceNativeImageUnchangedAfterCapture=True,encryptedFullReadCheck=True,separateDatabaseTargetRecovery='pending',limits='Known synthetic root and native legacy KPI source only. Actual installed CLI loses a committed native HTTP200 reply. Full database dump/roles/key/ten retained Storage objects and three GTFS roots join two normalized model journals. Source owned API stops first, no other writers remain, original bytes/records match. Separate-cluster target command reconciliation, active-worker fencing, other worker families, useful computation, physical-host, browser and scientific acceptance remain unproved.')
    network.verify_database_attachment(service.inspect(receipt['id']),receipt,'openplan_modelpoint_source_20261011_01',ROLE/'mounted-root-private.key',source_guard.verify_container,True)
    command(['docker','stop','--time','10',receipt['id']],'stop-exact-source-database',30)
    record['sourceDatabaseStopped']=True
    save();(OUT/'source-point-result.json').write_text(json.dumps(record,indent=2)+'\n')
    print(json.dumps({key:record[key] for key in ('state','snapshotId','capturedFiles','capturedBytes','wallSeconds')}))


if __name__=='__main__':
    try:main()
    except BaseException as error:
        record.update(state='failed',errorType=type(error).__name__);save();raise
    finally:
        for keeper in keepers:keeper.close()
