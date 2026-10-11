"""Recover the original native receipt from the joined point without computation."""
import hashlib,importlib.util,json,os,subprocess,sys,time,sqlite3
from contextlib import closing
from pathlib import Path
from urllib.parse import urlsplit
import transport
import recovery_guards as check
OUT=Path(__file__).parent;POINT=OUT.parent;BASE=POINT.parent
REPO=Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-20261009')
ROLE=POINT/'target-cluster';API=POINT/'target-api';SOURCE=POINT/'cut-source-03'
sys.path.insert(0,str(REPO/'workers/aequilibrae_worker'))
import model_command_client as client
import model_command_journal as journal
import model_stage_computation as computation
record={'state':'prepared','http':[],'commands':[]};callbacks=[]


def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


root=load('recovery_known_root',REPO/'docs/reviews/2026-10-11-coordinated-worker-point/worker_root.py')
files=load('recovery_known_files',BASE/'probe_worker_file_backup.py')
image=load('recovery_complete_image',BASE/'transit-coordinated-restore-20261011-03/run.py');image.OUT=OUT


def save():
    (OUT/'recovery-progress-private.json').write_text(json.dumps(record,indent=2)+'\n')


def command(args,label):
    result=subprocess.run(args,capture_output=True,timeout=90)
    (OUT/(label+'-private.log')).write_bytes(result.stdout+result.stderr)
    record['commands'].append({'name':label,'exitCode':result.returncode});save();result.check_returncode();return result.stdout


def main():
    os.umask(0o077);started=time.monotonic()
    sys.path.insert(0,str(API));import services,network_scope
    guard=load('recovery_target_guard',ROLE/'guards.py')
    receipt=json.loads((ROLE/'container-receipt.json').read_text())
    connection=json.loads((API/'source-rest-connection-private.json').read_text())
    rest=json.loads((API/'source-rest-receipt-private.json').read_text())
    database=connection['database'];image.CONTAINER=receipt['id']
    network_scope.verify_database_attachment(services.inspect(receipt['id']),receipt,'openplan_modelpoint_target_20261011_01',ROLE/'mounted-root-private.key',guard.verify_container,True)
    services.verify_new('rest',services.inspect(rest['id']),rest,database,Path('/unused'),Path('/unused'))
    record['executionSourceSha256']={p.name:files.digest(p) for p in OUT.glob('*.py')}
    record.update(targetDatabaseId=receipt['id'],targetDatabase=database,targetRestId=rest['id']);save()
    bundle=ROLE/'restored-private'/(SOURCE/'point-private').relative_to('/')
    protected=bundle/'configuration-private';worker=bundle/'model-worker-private'
    scope_record=json.loads((protected/'model-worker-source-scope-private.json').read_text())
    scope=scope_record['logicalScope'];pending=scope_record['pendingCommand'];client.validate_command(pending)
    census=json.loads((SOURCE/'coordinated-point-file-inventory-private.json').read_text())
    files.equal(census,files.inventory(bundle));files.equal(census,files.inventory(SOURCE/'point-private'))
    expected_root=json.loads((protected/'model-worker-root-inventory-private.json').read_text());root.equal_root(expected_root,root.inventory(worker))
    logical=json.loads((protected/'model-worker-logical-journals-private.json').read_text())
    for name in logical:root.equal_journal(logical[name],root.sqlite_image(worker/name/'model-commands.sqlite3'))
    baseline=json.loads((SOURCE/'captured-native-image-private.json').read_text())
    image.equal_image(baseline,image.inventory(database,'target-before-recovery'))
    identity=client.destination(**scope)
    source_record=journal.read_existing(worker/'commands',identity,pending['request_id'])
    root.equal_journal(source_record,[{'command':pending,'response':None,'resolved':False}])
    original_request=journal.canonical(pending)
    source_event=json.loads((SOURCE/'source-point-result.json').read_text())['events'][0]
    def native_pair(prefix=''):
        query="SELECT jsonb_build_object('output',(SELECT to_jsonb(k) FROM public.model_run_kpis k WHERE k.id='"+pending['request_id']+"'),'receipt',(SELECT to_jsonb(r) FROM public.model_legacy_kpi_receipts r WHERE r.kpi_id='"+pending['request_id']+"'))"
        return json.loads(image.sql(database,prefix+query+('; ROLLBACK;' if prefix else '')))
    server=native_pair();check.verify_server(pending,server);client.checked_receipt(pending,server['output'])
    (OUT/'native-original-pair-private.json').write_text(json.dumps(server,indent=2)+'\n')
    controls=[]
    for table in ('model_run_kpis','model_legacy_kpi_receipts'):
        key='id' if table=='model_run_kpis' else 'kpi_id'
        query="BEGIN;SET LOCAL session_replication_role=replica;DELETE FROM public."+table+" WHERE "+key+"='"+pending['request_id']+"';"
        broken=native_pair(query)
        try:check.verify_server(pending,broken)
        except ValueError as error:
            check.verify_origin(str(error),'model-recovery-native-pair-missing')
        else:raise AssertionError('Missing native server record survived: '+table)
        check.verify_server(pending,native_pair());controls.append({'table':table,'rollbackOnly':True,'intendedRefusal':'model-recovery-native-pair-missing'})
    (OUT/'native-missing-pair-controls.json').write_text(json.dumps(controls,indent=2)+'\n')
    args={**scope,'run_id':pending['arguments']['run_id'],'stage_id':pending['arguments']['stage_id'],'inputs':{'synthetic':True}}
    def forbidden():callbacks.append('computation');return {'unexpected':True}
    def drain_owned_journal(name):
        # Only this fixture uses these restored journals. Complete read-only
        # observers can leave empty WAL sidecars; a native checkpoint closes them.
        with closing(sqlite3.connect(worker/name/'model-commands.sqlite3',timeout=5)) as connection:
            record.setdefault('journalCheckpoints',[]).append({'journal':name,'nativeResult':list(connection.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone())})
    initial=root.inventory(worker)
    retained=computation.compute_once(worker/'stages',**args,name='completed',compute=forbidden)
    interrupted=False
    try:computation.compute_once(worker/'stages',**args,name='interrupted',compute=forbidden)
    except computation.ComputationUnconfirmed:interrupted=True
    check.verify_no_compute(callbacks,retained,{'fixture':True},interrupted)
    root.equal_journal(logical['stages'],root.sqlite_image(worker/'stages/model-commands.sqlite3'))
    drain_owned_journal('stages')
    after_stage=root.inventory(worker);check.verify_changed_files(initial,after_stage,['stages/model-commands.sqlite3'])
    def cli(label,wrong=False):
        result=subprocess.run([sys.executable,'-B',str(REPO/'workers/aequilibrae_worker/model_command_recovery.py'),'--journal',str(worker/'commands'),'--base-url',scope['base_url'],'--deployment-id',scope['deployment_id']+('-other' if wrong else ''),'--request-id',pending['request_id']],env={**os.environ,'SUPABASE_SERVICE_ROLE_KEY':connection['service_token']},capture_output=True,timeout=45)
        (OUT/(label+'-private.log')).write_bytes(result.stdout+result.stderr)
        return result.returncode,json.loads(result.stdout)
    with transport.bridge({'url':connection['url'],'token':connection['service_token']},False,record['http'],port=urlsplit(scope['base_url']).port) as origin:
        check.verify_origin(origin,scope['base_url'])
        code,response=cli('wrong-installation',True);check.verify_wrong_identity(code,response,record['http'])
        root.equal_root(after_stage,root.inventory(worker))
        code,response=cli('original-installed-cli');check.verify_cli(code,response,pending['request_id']);check.verify_exchange(source_event,record['http'])
        final=journal.read_existing(worker/'commands',identity,pending['request_id'])
        root.equal_journal(final,[{'command':pending,'response':server['output'],'resolved':True}])
        check.verify_origin(journal.canonical(final[0]['command']),original_request)
        # A resolved repeat must use the retained receipt without another HTTP call.
        code,response=cli('cached-installed-cli');check.verify_cli(code,response,pending['request_id']);check.verify_exchange(source_event,record['http'])
    services.verify_new('rest',services.inspect(rest['id']),rest,database,Path('/unused'),Path('/unused'))
    command(['docker','stop','--time','5',rest['id']],'stop-exact-target-rest')
    image.no_sessions(database)
    image.equal_image(baseline,image.inventory(database,'target-after-original-cli'))
    check.verify_server(pending,native_pair());root.equal_journal(logical['stages'],root.sqlite_image(worker/'stages/model-commands.sqlite3'))
    expected_commands=json.loads(json.dumps(logical['commands']))
    for row in expected_commands['tables']['commands']:
        if row[0]==pending['request_id']:row[3]=journal.canonical(server['output'])
    root.equal_journal(expected_commands,root.sqlite_image(worker/'commands/model-commands.sqlite3'))
    drain_owned_journal('stages');drain_owned_journal('commands')
    check.verify_changed_files(after_stage,root.inventory(worker),['commands/model-commands.sqlite3'])
    changed_bundle=files.inventory(bundle)
    check.verify_changed_files(census,changed_bundle,['model-worker-private/stages/model-commands.sqlite3','model-worker-private/commands/model-commands.sqlite3'])
    files.equal(census,files.inventory(SOURCE/'point-private'))
    roles=(protected/'roles-private.sql').read_text();role_inventory=json.loads((protected/'roles-inventory-private.json').read_text())
    archive=load('recovery_full_archive',REPO/'openplan/scripts/ops/full_restore.py')
    guard.verify_roles(role_inventory,json.loads(archive.role_inventory(receipt['id'])),roles,command(['docker','exec',receipt['id'],'pg_dumpall','-U','supabase_admin','--roles-only'],'target-final-role-dump').decode())
    guard.verify_properties(json.loads((protected/'database-properties-private.json').read_text()),archive.database_properties(receipt['id'],database))
    archive._keys.require_mounted_bytes(receipt,archive._keys.read_key(protected/'pgsodium-root-private.key',private=True))
    network_scope.verify_database_attachment(services.inspect(receipt['id']),receipt,'openplan_modelpoint_target_20261011_01',ROLE/'mounted-root-private.key',guard.verify_container,True)
    command(['docker','stop','--time','10',receipt['id']],'stop-exact-target-database')
    record.update(state='passed-native-coordinated-recovery',wallSeconds=round(time.monotonic()-started,3),originalRequestByteEqual=True,originalResponseByteEqual=True,nativeCommittedOutputAndReceiptEqual=True,nativeAll374TablesAndSixSequencesUnchanged=True,rolePropertiesAndKeyEqual=True,computationCallbacks=0,interruptedStartRefused=True,retainedStageResultEqual=True,sourcePointUnchanged=True,targetApiAndDatabaseStopped=True,changedFiles=['model-worker-private/stages/model-commands.sqlite3','model-worker-private/commands/model-commands.sqlite3'],stageFileChange='DELETE-to-WAL journal mode only; all logical rows unchanged',commandFileChange='Original receipt retained; all other requests/receipts unchanged',physicalHostRecovery='unassessed',scientificAcceptance='unassessed',limits='Known synthetic root and legacy custody command on separate local clusters/volumes, same host/disk. Native missing-output/receipt rollback controls pass. No worker resume, useful45-minute computation, every worker family, hostile writer fence, physical-host, browser, historical Vault decryption or independent science acceptance.')
    save();(OUT/'result.json').write_text(json.dumps(record,indent=2)+'\n')
    print(json.dumps({key:record[key] for key in ('state','wallSeconds','computationCallbacks','originalRequestByteEqual','originalResponseByteEqual')}))


if __name__=='__main__':
    try:main()
    except BaseException as error:record.update(state='failed',errorType=type(error).__name__);save();raise
