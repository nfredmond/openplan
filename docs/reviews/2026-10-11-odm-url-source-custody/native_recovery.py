"""Actual interrupted source writer and two stopped-root copies with supplied fetch."""
import argparse,copy,hashlib,importlib.util,json,os,shutil,subprocess,sys,time,tempfile
from pathlib import Path
REPO=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(REPO/'workers/odm_worker'))
sys.path.insert(0,str(REPO/'openplan/scripts/ops'))
from admission_journal import FILENAME
from runtime_admission import Runtime
from runtime_preparation import Preparation
from url_source_custody import UrlSources
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
    'sourceBindingsUnchanged':True,'ownedChildStopped':True}


def save(path,value):path.write_text(json.dumps(value,indent=2)+'\n')


def observe(values):
    for key,value in EXPECTED.items():
        if key not in values or type(values[key]) is not type(value) or values[key]!=value:raise ValueError('url-source-native-'+key)


def child(out):
    os.umask(0o077);prior=tempfile.tempdir;tempfile.tempdir=str(out)
    try:checks=fixture.Checks();checks.setUp();checks.temporary._finalizer.detach()
    finally:tempfile.tempdir=prior
    source_root=checks.base/'url-sources'
    source=UrlSources(checks.runtime,source_root,'synthetic-local-target',lambda *args:None,max_bytes=4096,timeout=10)
    def fetch(url,output,remaining,deadline):
        if url.endswith('a.jpg'):output.write(checks.raw[0]);return len(checks.raw[0])
        output.write(checks.raw[1][:9]);output.output.flush();os.fsync(output.output.fileno())
        ready.publish_readiness(out/'owned-fixture.json',{'runtimeRoot':str(checks.root),'sourceRoot':str(source_root),
            'inputRoot':str(checks.input),'request':checks.request,'applicationJob':checks.spec['applicationJob'],
            'spec':{**checks.spec,'sourceRoot':str(checks.input)}})
        os._exit(19)
    source.fetch=fetch
    with checks.runtime.owner():checks.start();source.prepare(checks.request['requestId'],checks.spec['applicationJob'])
    raise AssertionError('Interrupted source fixture returned')


def run(out):
    os.umask(0o077);out.mkdir(mode=0o700);began=time.monotonic()
    paths=[Path(__file__),Path(helper.__file__),Path(ready.__file__),REPO/'openplan/scripts/ops/worker_root_snapshot.py',
           REPO/'openplan/scripts/ops/worker_journal_snapshot.py',*sorted((REPO/'workers/odm_worker').glob('*.py'))]
    bindings={str(path.relative_to(REPO)):hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
    result=subprocess.run([sys.executable,'-B',str(Path(__file__)),'--child',str(out)],cwd=REPO,capture_output=True,timeout=30,
        env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
    (out/'child.stdout').write_bytes(result.stdout);(out/'child.stderr').write_bytes(result.stderr)
    if result.returncode!=19:raise AssertionError('Original interrupted source child differs')
    config=json.loads((out/'owned-fixture.json').read_bytes());runtime_root=Path(config['runtimeRoot']);source_root=Path(config['sourceRoot']);input_root=Path(config['inputRoot'])
    roots={label:(root,helper.inventory(root)) for label,root in [('runtime',runtime_root),('sources',source_root)]}
    save(out/'original-root-inventories-private.json',{label:image for label,(root,image) in roots.items()})
    inputs=helper.inventory(input_root);packages={};values={'originalChildExit':result.returncode,'ownedChildStopped':True}
    pack=source_root/('request-'+hashlib.sha256(config['request']['requestId'].encode()).hexdigest())
    first=json.loads((pack/'source-00000.complete.json').read_bytes());partial=next((pack/'objects').glob('source-00001-*.bin'))
    values.update(actualInterruptedSecondSource=partial.stat().st_size==9,originalFirstReceiptComplete=(pack/first['objectRelativePath']).read_bytes()==b'Synthetic original A',
        originalSecondReceiptMissing=not (pack/'source-00001.complete.json').exists(),originalSetManifestMissing=not (pack/'completed.json').exists(),actualPartialObjectRetained=partial.read_bytes()==b'Synthetic')
    original_plan=(pack/'plan.json').read_bytes();partial_bytes=partial.read_bytes()
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
    def fetch(url,output,remaining,deadline):
        calls.append(url);raw=b'Changed remote A' if url.endswith('a.jpg') else b'Synthetic original B'
        output.write(raw);return len(raw)
    source=UrlSources(runtime,restored_source,'synthetic-local-target',fetch,max_bytes=4096,timeout=10)
    restored_pack=restored_source/pack.name
    with runtime.owner():
        replay,first_admission=runtime.submit(config['request']);values['originalAdmissionReplayed']=first_admission is False and replay.admission==json.loads(original_plan)['binding']['originalAdmission']
        completed=source.prepare(config['request']['requestId'],config['applicationJob'])
        values['onlyMissingOriginalSourceFetched']=calls==[config['request']['imagery']['photos'][1]['url']]
        values['originalStartedQueueStillHeld']=runtime.run_one() is False and runtime.status()['heldStarted']==1
        spec=copy.deepcopy(config['spec']);spec.update(sourceRoot=completed['sourceRoot'],sources=completed['sources'])
        preparation=Preparation(runtime,lambda entry:spec,timeout=10);prepared=preparation.resume(config['request']['requestId'])
        source.fetch=lambda *args:(_ for _ in ()).throw(AssertionError('Native complete source replay fetched'))
        values['completedReplayHasNoFetch']=source.prepare(config['request']['requestId'],config['applicationJob'])==completed
    folder=restored_runtime/('preparation-'+hashlib.sha256(config['request']['requestId'].encode()).hexdigest())
    raw=[b'Synthetic original A',b'Synthetic original B']
    values['originalFirstReceiptUnchanged']=json.loads((restored_pack/'source-00000.complete.json').read_bytes())==first
    values['originalOrphanUnchanged']=(restored_pack/'objects'/partial.name).read_bytes()==partial_bytes
    values['allCompletedSourceBytesOriginal']=all((completed['sourceRoot']/name).read_bytes()==raw[slot] for slot,name in enumerate(completed['sources']))
    values['sourcePlanAndContextOriginal']=(restored_pack/'plan.json').read_bytes()==original_plan and json.loads(original_plan)['binding']['originalContext']['originalActorId']=='synthetic-original-actor'
    values['actualPreparationBytesOriginal']=all((folder/f'retained/objects/source-{slot:05d}.bin').read_bytes()==row for slot,row in enumerate(raw))
    values['noEngineIntents']=not list((folder/'engine').glob('command-*.intent.json'))
    values['allAuthorityUnassessed']=completed['authorityVerification']=='unassessed' and completed['engineTransportPermission'] is False and prepared['authorityVerification']=='unassessed' and prepared['engineTransportPermission'] is False
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
                if str(error)!='url-source-native-'+key:raise
                controls.append({'control':key+'-'+kind,'outcome':'intended_failure'})
            else:raise AssertionError('Broken native source observation survived')
    save(out/'controls.json',controls);save(out/'source-bindings.json',bindings)
    summary={'observations':len(EXPECTED),'controls':len(controls),'rootComparisonControls':len(root_controls),'seconds':round(time.monotonic()-began,3),'allPassed':True,
        'ownedChildStopped':True,'fullWorkerRecoveryAccepted':False,'liveAuthorityVerified':False,'actualURLTransportVerified':False,
        'processingCommitExecuted':False,'claimLimits':['supplied synthetic byte fetcher, not actual network downloads','two root packages; documented read-only SQLite empty WAL/transient SHM lifecycle; durable assets unchanged; no whole-installation recovery claim','no processing/result/callback or browser/practitioner acceptance']}
    save(out/'summary.json',summary);print(json.dumps(summary),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--out',type=Path);parser.add_argument('--child',type=Path);args=parser.parse_args()
    if args.child:child(args.child)
    elif args.out:run(args.out.absolute())
    else:parser.error('An owned proof destination is required')
