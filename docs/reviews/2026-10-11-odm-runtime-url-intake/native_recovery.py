"""Actual owned URL intake interruption and original settings recovery, on loopback."""
import argparse,copy,ctypes,hashlib,importlib.util,json,os,select,shutil,socket,subprocess,sys,threading,time,tempfile
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
REPO=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(REPO/'workers/odm_worker'))
sys.path.insert(0,str(REPO/'openplan/scripts/ops'))
from admission_journal import FILENAME
from runtime_admission import Runtime
from runtime_url_intake import Intake, SETTINGS
from url_transport import Transport
import test_runtime_preparation as fixture


def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
helper=load('url_source_root_helper',REPO/'docs/reviews/2026-10-11-coordinated-worker-point/worker_root.py')
capture_guard=load('url_source_capture_guard',REPO/'openplan/scripts/ops/worker_root_snapshot.py')
ready=load('url_source_readiness',REPO/'docs/reviews/2026-10-11-odm-native-readiness-race/readiness.py')
EXPECTED={'originalChildExit':19,'actualInterruptedSecondSource':True,'originalFirstReceiptComplete':True,
    'originalSecondReceiptMissing':True,'originalSetManifestMissing':True,'actualPartialObjectRetained':True,
    'twoRootPackagesVerified':True,'onlyMissingOriginalSourceFetched':True,'originalFirstReceiptUnchanged':True,
    'originalOrphanUnchanged':True,'allCompletedSourceBytesOriginal':True,'sourcePlanAndContextOriginal':True,
    'originalAdmissionReplayed':True,'originalStartedQueueStillHeld':True,'actualPreparationBytesOriginal':True,
    'noEngineIntents':True,'allAuthorityUnassessed':True,'completedReplayHasNoFetch':True,
    'allOriginalAssetsUnchanged':True,'documentedReaderSidecarsChecked':True,'allPackagesUnchanged':True,'originalInputsUnchanged':True,
    'sourceBindingsUnchanged':True,'ownedChildStopped':True,'originalTransportExit':97,'actualOriginalNetworkRequests':True,'actualRecoveredNetworkRequest':True,'ownedHTTPPeerClosed':True,'originalSettingsSavedBeforeFetch':True,'partialIntakeMappingAbsent':True,
    'partialPreparationAbsent':True,'originalSettingsUnchanged':True,'originalActorEngineOptionsPreserved':True,
    'completedReplayWithoutSourceRoot':True,'originalTaskUnchanged':True}


def save(path,value):path.write_text(json.dumps(value,indent=2)+'\n')


def observe(values):
    for key,value in EXPECTED.items():
        if key not in values or type(values[key]) is not type(value) or values[key]!=value:raise ValueError('runtime-url-intake-native-'+key)


def child(out,origin):
    os.umask(0o077);prior=tempfile.tempdir;tempfile.tempdir=str(out)
    try:checks=fixture.Checks();checks.setUp();checks.temporary._finalizer.detach()
    finally:tempfile.tempdir=prior
    checks.request=copy.deepcopy(checks.request);checks.request['requestId']='synthetic-native-http-source'
    for row in checks.request['imagery']['photos']:row['url']=origin+'/'+row['filename']+'?synthetic=original'
    checks.root=checks.base/'owned-runtime'
    checks.root.mkdir(mode=0o700)
    checks.runtime=Runtime(checks.root,'synthetic-installation',max_queued=2,pipeline=lambda job:None)
    checks.entry,_=checks.runtime.submit(checks.request);checks.spec['applicationJob']['request_id']=checks.request['requestId']
    source_root=checks.base/'url-sources'
    transport=Transport(allowed_networks=('127.0.0.1/32',),allowed_ports=(int(origin.rsplit(':',1)[1]),))
    original=subprocess.Popen;launched=[]
    def spawn(*args,**kwargs):
        process=original(*args,**kwargs)
        start=(Path('/proc')/str(process.pid)/'stat').read_text().rsplit(')',1)[1].split()[19]
        ready.publish_readiness(out/('owned-http-child-'+str(len(launched))+'.json'),{'pid':process.pid,'start':start})
        launched.append(process);return process
    subprocess.Popen=spawn
    def fetch(url,output,remaining,deadline):
        if '/a.jpg?' in url:return transport(url,output,remaining,deadline)
        class InterruptedWriter:
            def write(self,chunk):
                count=output.write(chunk);output.output.flush();os.fsync(output.output.fileno())
                ready.publish_readiness(out/'owned-fixture.json',{'runtimeRoot':str(checks.root),'sourceRoot':str(source_root),
                    'inputRoot':str(checks.input),'request':checks.request,'applicationJob':checks.spec['applicationJob'],
                    'spec':{**checks.spec,'sourceRoot':str(checks.input)}})
                os._exit(19)
                return count
        return transport(url,InterruptedWriter(),remaining,deadline)
    settings={key:copy.deepcopy(checks.spec[key]) for key in SETTINGS}
    intake=Intake(checks.runtime,source_root,'synthetic-local-target',lambda entry:settings,fetch,timeout=10)
    checks.runtime.pipeline=intake
    with checks.runtime.owner():checks.runtime.run_one()
    raise AssertionError('Interrupted source fixture returned')


def run(out,origin,state):
    os.umask(0o077);out.mkdir(mode=0o700);began=time.monotonic()
    paths=[Path(__file__),Path(helper.__file__),Path(ready.__file__),REPO/'openplan/scripts/ops/worker_root_snapshot.py',
           REPO/'openplan/scripts/ops/worker_journal_snapshot.py',*sorted((REPO/'workers/odm_worker').glob('*.py'))]
    bindings={str(path.relative_to(REPO)):hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
    result=subprocess.run([sys.executable,'-B',str(Path(__file__)),'--child',str(out),'--origin',origin],cwd=REPO,capture_output=True,timeout=30,
        env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
    (out/'child.stdout').write_bytes(result.stdout);(out/'child.stderr').write_bytes(result.stderr)
    if result.returncode!=19:raise AssertionError('Original interrupted source child differs')
    record=json.loads((out/'owned-http-child-1.json').read_bytes());reaped=False;until=time.monotonic()+3
    try:
        while time.monotonic()<until:
            pid,status=os.waitpid(record['pid'],os.WNOHANG)
            if pid==record['pid']:transport_exit=os.waitstatus_to_exitcode(status);reaped=True;break
            time.sleep(.01)
        if not reaped:raise AssertionError('Native original network child did not stop')
    finally:
        if not reaped:
            stat=Path('/proc')/str(record['pid'])/'stat'
            if stat.exists() and stat.read_text().rsplit(')',1)[1].split()[19]==record['start']:os.kill(record['pid'],9)
            try:os.waitpid(record['pid'],0)
            except ChildProcessError:pass
    if not state['closed'].wait(2):raise AssertionError('Native network peer did not close')
    original_calls=list(state['calls']);state['held']=False;state['changedFirst']=True
    config=json.loads((out/'owned-fixture.json').read_bytes());runtime_root=Path(config['runtimeRoot']);source_root=Path(config['sourceRoot']);input_root=Path(config['inputRoot'])
    roots={label:(root,helper.inventory(root)) for label,root in [('runtime',runtime_root),('sources',source_root)]}
    save(out/'original-root-inventories-private.json',{label:image for label,(root,image) in roots.items()})
    inputs=helper.inventory(input_root);packages={};values={'originalChildExit':result.returncode,'ownedChildStopped':True}
    pack=source_root/('request-'+hashlib.sha256(config['request']['requestId'].encode()).hexdigest())
    first=json.loads((pack/'source-00000.complete.json').read_bytes());partial=next((pack/'objects').glob('source-00001-*.bin'))
    values.update(actualInterruptedSecondSource=partial.stat().st_size==9,originalFirstReceiptComplete=(pack/first['objectRelativePath']).read_bytes()==b'Synthetic original A',
        originalSecondReceiptMissing=not (pack/'source-00001.complete.json').exists(),originalSetManifestMissing=not (pack/'completed.json').exists(),actualPartialObjectRetained=partial.read_bytes()==b'Synthetic')
    original_plan=(pack/'plan.json').read_bytes();partial_bytes=partial.read_bytes()
    intake_name='url-intake-'+hashlib.sha256(config['request']['requestId'].encode()).hexdigest()
    intake_plan=(runtime_root/intake_name/'plan.json').read_bytes();saved=json.loads(intake_plan)
    values.update(originalSettingsSavedBeforeFetch=saved['binding']['request']==config['request'] and saved['settings']=={key:config['spec'][key] for key in SETTINGS},
        partialIntakeMappingAbsent=not (runtime_root/intake_name/'sources.json').exists(),
        partialPreparationAbsent=not (runtime_root/('preparation-'+intake_name.removeprefix('url-intake-'))).exists())
    for label,(root,image) in roots.items():
        package=out/(label+'-package-private')
        for operation,args in [('capture',['--source',str(root),'--destination',str(package),'--writers-quiesced','--timeout','20']),('verify',['--destination',str(package),'--verify'])]:
            checked=subprocess.run([sys.executable,'-B',str(REPO/'openplan/scripts/ops/worker_root_snapshot.py'),*args],cwd=REPO,capture_output=True,timeout=30)
            (out/(label+'-'+operation+'.stdout')).write_bytes(checked.stdout);(out/(label+'-'+operation+'.stderr')).write_bytes(checked.stderr)
            if checked.returncode:raise AssertionError('Actual source root CLI failed '+label+'-'+operation)
        packages[label]=(package,helper.inventory(package))
    values['twoRootPackagesVerified']=len(packages)==2
    restored_runtime=out/'restored-runtime-private';restored_source=out/'restored-source-private'
    shutil.copytree(packages['runtime'][0]/'root',restored_runtime);shutil.copytree(packages['sources'][0]/'root',restored_source)
    runtime=Runtime(restored_runtime,'synthetic-installation',max_queued=0,pipeline=lambda job:None);calls=[]
    transport=Transport(allowed_networks=('127.0.0.1/32',),allowed_ports=(int(origin.rsplit(':',1)[1]),))
    def fetch(url,output,remaining,deadline):
        calls.append(url);return transport(url,output,remaining,deadline)
    def forbidden_supplier(entry):raise AssertionError('Actual restored intake called a changed supplier')
    intake=Intake(runtime,restored_source,'synthetic-local-target',forbidden_supplier,fetch,timeout=10)
    restored_pack=restored_source/pack.name
    with runtime.owner():
        replay,first_admission=runtime.submit(config['request']);values['originalAdmissionReplayed']=first_admission is False and replay.admission==json.loads(original_plan)['binding']['originalAdmission']
        result=intake.resume(config['request']['requestId']);prepared=result['preparation']
        values['onlyMissingOriginalSourceFetched']=calls==[config['request']['imagery']['photos'][1]['url']]
        values['originalStartedQueueStillHeld']=runtime.run_one() is False and runtime.status()['heldStarted']==1
        before=list(calls)
        values['completedReplayHasNoFetch']=intake.resume(config['request']['requestId'])==result and calls==before
    mapping=json.loads((restored_runtime/intake_name/'sources.json').read_bytes())
    completed=mapping['manifest'];folder=restored_runtime/('preparation-'+intake_name.removeprefix('url-intake-'))
    engine=json.loads((folder/'engine/plan.json').read_bytes());raw=[b'Synthetic original A',b'Synthetic original B']
    values['originalFirstReceiptUnchanged']=json.loads((restored_pack/'source-00000.complete.json').read_bytes())==first
    values['originalOrphanUnchanged']=(restored_pack/'objects'/partial.name).read_bytes()==partial_bytes
    values['allCompletedSourceBytesOriginal']=all((restored_pack/row['objectRelativePath']).read_bytes()==raw[slot] for slot,row in enumerate(completed['sources']))
    values['sourcePlanAndContextOriginal']=(restored_pack/'plan.json').read_bytes()==original_plan and json.loads(original_plan)['binding']['originalContext']['originalActorId']=='synthetic-original-actor'
    values['actualPreparationBytesOriginal']=all((folder/f'retained/objects/source-{slot:05d}.bin').read_bytes()==row for slot,row in enumerate(raw))
    values['noEngineIntents']=not list((folder/'engine').glob('command-*.intent.json'))
    values['allAuthorityUnassessed']=result['authorityVerification']=='unassessed' and result['engineTransportPermission'] is False and prepared['authorityVerification']=='unassessed' and prepared['engineTransportPermission'] is False
    values['originalSettingsUnchanged']=(restored_runtime/intake_name/'plan.json').read_bytes()==intake_plan
    values['originalActorEngineOptionsPreserved']=engine['engine']==saved['settings']['engine'] and engine['options']==saved['settings']['options'] and engine['binding']['originalContext']['originalActorId']=='synthetic-original-actor'
    missing_source=out/'completed-source-held-private';restored_source.rename(missing_source)
    intake.fetch=lambda *args:(_ for _ in ()).throw(AssertionError('Completed native intake refetched missing source root'))
    try:
        with runtime.owner():replayed=intake.resume(config['request']['requestId'])
        values['completedReplayWithoutSourceRoot']=replayed==result and not restored_source.exists()
        values['originalTaskUnchanged']=replayed['preparation']['taskUuid']==prepared['taskUuid']
    finally:missing_source.rename(restored_source)
    def normalized(image):
        return {name:{('sizeBytes' if key=='bytes' else key):value for key,value in row.items()} for name,row in image.items()}
    actual_roots={label:normalized(helper.inventory(root)) for label,(root,image) in roots.items()}
    before_roots={label:normalized(image) for label,(root,image) in roots.items()}
    save(out/'after-root-inventories-private.json',actual_roots)
    root_controls=[]
    for label in roots:
        mains={'admissions/'+FILENAME} if label=='runtime' else set()
        checked,created=capture_guard.stable_source(before_roots[label],actual_roots[label],mains)
        record=json.loads((packages[label][0]/'snapshot.json').read_bytes())
        if record['readerCreatedEmptyWalPaths']!=created:raise AssertionError('Reader sidecar lifecycle differs from captured record')
        root_controls.append({'control':label+'-baseline','outcome':'survived'})
        capture_guard.stable_source(copy.deepcopy(before_roots[label]),copy.deepcopy(actual_roots[label]),mains)
        root_controls.append({'control':label+'-harmless-copy','outcome':'survived'})
        known=next(name for name,row in actual_roots[label].items() if row['kind']=='file' and name not in {main+suffix for main in mains for suffix in ('-wal','-shm')})
        for kind in ('durable-hash','missing-durable-file','durable-mode','unexpected-data'):
            changed=copy.deepcopy(actual_roots[label])
            if kind=='durable-hash':changed[known]['sha256']='a'*64
            elif kind=='missing-durable-file':changed.pop(known)
            elif kind=='durable-mode':changed[known]['mode']=0o644
            else:changed['unexpected.bin']={'kind':'file','mode':0o600,'sizeBytes':1,'sha256':'b'*64}
            try:capture_guard.stable_source(before_roots[label],changed,mains)
            except ValueError as error:
                if str(error)!='Worker source changed during capture':raise
                root_controls.append({'control':label+'-'+kind,'outcome':'intended_refusal'})
            else:raise AssertionError('Broken durable-root comparison survived')
        capture_guard.stable_source(before_roots[label],actual_roots[label],mains);root_controls.append({'control':label+'-restored','outcome':'survived'})
    values['allOriginalAssetsUnchanged']=True
    values['documentedReaderSidecarsChecked']=True
    save(out/'root-comparison-controls.json',root_controls)
    values['allPackagesUnchanged']=all(helper.inventory(package)==image for package,image in packages.values())
    values['originalInputsUnchanged']=helper.inventory(input_root)==inputs
    values.update(originalTransportExit=transport_exit,actualOriginalNetworkRequests=original_calls==['/a.jpg?synthetic=original','/b.jpg?synthetic=original'],actualRecoveredNetworkRequest=state['calls']==original_calls+['/b.jpg?synthetic=original'],ownedHTTPPeerClosed=state['closed'].is_set())
    values['sourceBindingsUnchanged']=all(hashlib.sha256((REPO/name).read_bytes()).hexdigest()==digest for name,digest in bindings.items())
    save(out/'observed.json',values);observe(values);controls=[]
    for label,value in [('baseline',values),('harmless-extra-observation',{**values,'note':'harmless'}),('restored',copy.deepcopy(values))]:observe(value);controls.append({'control':label,'outcome':'survived'})
    for key,expected in EXPECTED.items():
        for kind in ('wrong','missing','wrong-type'):
            changed=copy.deepcopy(values)
            if kind=='missing':changed.pop(key)
            elif kind=='wrong-type':changed[key]=int(expected) if type(expected) is bool else str(expected)
            else:changed[key]=not expected if type(expected) is bool else expected+1
            try:observe(changed)
            except ValueError as error:
                if str(error)!='runtime-url-intake-native-'+key:raise
                controls.append({'control':key+'-'+kind,'outcome':'intended_failure'})
            else:raise AssertionError('Broken native source observation survived')
    save(out/'controls.json',controls);save(out/'source-bindings.json',bindings)
    summary={'observations':len(EXPECTED),'controls':len(controls),'rootComparisonControls':len(root_controls),'seconds':round(time.monotonic()-began,3),'allPassed':True,
        'ownedChildStopped':True,'fullWorkerRecoveryAccepted':False,'liveAuthorityVerified':False,'actualLoopbackURLTransportVerified':True,'publicURLTransportVerified':False,'suppliedSettingsCustodyVerified':True,
        'processingCommitExecuted':False,'claimLimits':['actual loopback HTTP and abrupt parent exit, synthetic bytes; no public DNS/TLS acceptance','two root packages; documented read-only SQLite empty WAL/transient SHM lifecycle; durable assets unchanged; no whole-installation recovery claim','no processing/result/callback or browser/practitioner acceptance']}
    save(out/'summary.json',summary);print(json.dumps(summary),flush=True)


def hosted_run(out):
    state={'calls':[],'held':True,'changedFirst':False,'closed':threading.Event()}
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_GET(self):
            state['calls'].append(self.path)
            raw=b'Changed remote A' if self.path.startswith('/a.jpg') and state['changedFirst'] else b'Synthetic original A' if self.path.startswith('/a.jpg') else b'Synthetic original B'
            self.send_response(200);self.send_header('Content-Length',str(len(raw)));self.end_headers()
            try:
                if self.path.startswith('/b.jpg') and state['held']:
                    self.wfile.write(raw[:9]);self.wfile.flush()
                    readable,_,_=select.select([self.connection],[],[],4)
                    if readable and self.connection.recv(1)==b'':state['closed'].set()
                else:self.wfile.write(raw);self.wfile.flush()
            except (BrokenPipeError,ConnectionResetError):pass
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler);server.daemon_threads=True
    thread=threading.Thread(target=lambda:server.serve_forever(poll_interval=.02),daemon=True);thread.start()
    libc=ctypes.CDLL(None,use_errno=True);previous=ctypes.c_int()
    if libc.prctl(37,ctypes.byref(previous),0,0,0) or libc.prctl(36,1,0,0,0):raise AssertionError('Owned child adoption setup differs')
    try:run(out,'http://127.0.0.1:'+str(server.server_address[1]),state)
    finally:
        server.shutdown();server.server_close();thread.join(3)
        if libc.prctl(36,previous.value,0,0,0):raise AssertionError('Owned child adoption restoration differs')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--out',type=Path);parser.add_argument('--child',type=Path);parser.add_argument('--origin');args=parser.parse_args()
    if args.child and args.origin:child(args.child,args.origin)
    elif args.out:hosted_run(args.out.absolute())
    else:parser.error('An owned proof destination is required')
