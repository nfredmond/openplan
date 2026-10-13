"""Actual owned runtime interruption and two-root local preparation recovery."""
import argparse
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0,str(REPO/'workers/odm_worker'))
from admission_journal import FILENAME
from runtime_admission import Runtime
from runtime_preparation import Preparation
import retained_source

EXPECTED = {'childExit':19, 'childStopped':True, 'capturedRootCount':2,
    'captureExit':0, 'verifyExit':0, 'originalRootsUnchanged':True,
    'originalPackagesUnchanged':True, 'originalJournalPreserved':True,
    'originalTaskPreserved':True, 'originalContextPreserved':True,
    'firstSlotRetainedBeforeDeath':True, 'secondSlotAbsentBeforeDeath':True,
    'originalAdmissionReplayed':True, 'localPreparationCompleted':True,
    'allOriginalBytesMatch':True, 'noEngineIntentsIssued':True,
    'engineTransportPermission':False, 'authorityUnassessed':True,
    'callbackCustodyUnassessed':True, 'originalStartStillHeld':True,
    'completeCopyNeedsNoOriginalInput':True, 'changedActorRefused':True,
    'changedEngineRefused':True, 'changedRetainedBytesRefused':True,
    'negativeFixturesRestored':True, 'sourceBindingsUnchanged':True}


def observe(value):
    for key,expected in EXPECTED.items():
        if key not in value or type(value[key]) is not type(expected) or value[key]!=expected:
            raise ValueError('runtime-preparation-native-'+key)


def save(path,value):
    with path.open('x') as stream:
        json.dump(value,stream,indent=2,sort_keys=True);stream.write('\n');stream.flush();os.fsync(stream.fileno())


def child(out):
    import tempfile
    import test_runtime_preparation as fixture
    os.umask(0o077);tempfile.tempdir=str(out)
    checks=fixture.Checks();checks.setUp()
    spec=copy.deepcopy(checks.spec);spec['sourceRoot']=str(spec['sourceRoot'])
    save(out/'fixture-private.json',{'root':str(checks.root),'input':str(checks.input),
        'request':checks.request,'admission':checks.entry.admission,'spec':spec,'pid':os.getpid()})
    actual=retained_source.digest
    def interrupt(root,name,limit,deadline,output=None):
        if output is not None and name=='b.jpg':os._exit(19)
        return actual(root,name,limit,deadline,output)
    retained_source.digest=interrupt
    with checks.runtime.owner():checks.runtime.run_one()
    raise AssertionError('Owned runtime did not reach the interrupted second slot')


def run(out):
    os.umask(0o077);out.mkdir(mode=0o700);began=time.monotonic()
    spec=importlib.util.spec_from_file_location('preparation_root',REPO/'docs/reviews/2026-10-11-coordinated-worker-point/worker_root.py')
    helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    def ordinary(root):
        return {name:row for name,row in helper.inventory(root).items()
                if name not in {'admissions/'+FILENAME+suffix for suffix in ('','-wal','-shm')}}
    def logical(root):return helper.sqlite_image(root/'admissions'/FILENAME)
    paths=[Path(__file__),REPO/'docs/reviews/2026-10-11-coordinated-worker-point/worker_root.py',
           REPO/'openplan/scripts/ops/worker_root_snapshot.py',REPO/'openplan/scripts/ops/worker_journal_snapshot.py',
           *sorted((REPO/'workers/odm_worker').glob('*.py'))]
    bindings={str(path.relative_to(REPO)):hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
    def command(label,args):
        result=subprocess.run(list(map(str,args)),cwd=REPO,capture_output=True,timeout=30,
            env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
        (out/(label+'.stdout')).write_bytes(result.stdout);(out/(label+'.stderr')).write_bytes(result.stderr)
        return result.returncode
    code=command('child',[sys.executable,'-B',__file__,'--child','--out',out])
    fixture=json.loads((out/'fixture-private.json').read_bytes());source=Path(fixture['root']);inputs=Path(fixture['input'])
    original=ordinary(source);original_journal=logical(source);original_input=helper.inventory(inputs)
    prefix='preparation-'+hashlib.sha256(fixture['request']['requestId'].encode()).hexdigest()
    original_plan=json.loads((source/prefix/'plan.json').read_bytes())
    captures=[];packages=[]
    for label,root in (('runtime',source),('input',inputs)):
        package=out/(label+'-package-private');packages.append(package)
        capture=command(label+'-capture',[sys.executable,'-B',REPO/'openplan/scripts/ops/worker_root_snapshot.py',
            '--source',root,'--destination',package,'--writers-quiesced','--timeout','20'])
        verify=command(label+'-verify',[sys.executable,'-B',REPO/'openplan/scripts/ops/worker_root_snapshot.py',
            '--destination',package,'--verify'])
        captures.append((capture,verify))
        if capture or verify:raise AssertionError('Actual root CLI refused '+label)
    package_images=[helper.inventory(p) for p in packages];package_journal=logical(packages[0]/'root')
    runtime=out/'resumed-runtime-private';resumed_input=out/'resumed-input-private'
    shutil.copytree(packages[0]/'root',runtime);shutil.copytree(packages[1]/'root',resumed_input)
    supplied=fixture['spec'];supplied['sourceRoot']=resumed_input
    current=Runtime(runtime,'synthetic-installation',max_queued=0,pipeline=lambda job:None)
    preparation=Preparation(current,lambda entry:supplied,timeout=4)
    observed={'childExit':code,'childStopped':not Path('/proc/'+str(fixture['pid'])).exists(),
        'capturedRootCount':len(packages),'captureExit':max(row[0] for row in captures),'verifyExit':max(row[1] for row in captures),
        'firstSlotRetainedBeforeDeath':(source/prefix/'retained/objects/source-00000.bin').exists(),
        'secondSlotAbsentBeforeDeath':not (source/prefix/'retained/objects/source-00001.bin').exists()}
    with current.owner():
        replay,first=current.submit(fixture['request'])
        observed['originalAdmissionReplayed']=first is False and replay.admission==fixture['admission']
        result=preparation.resume(fixture['request']['requestId'])
        observed['originalStartStillHeld']=current.run_one() is False and current.status()['heldStarted']==1
    plan=json.loads((runtime/prefix/'plan.json').read_bytes())
    engine=json.loads((runtime/prefix/'engine/plan.json').read_bytes())
    observed.update(originalTaskPreserved=result['taskUuid']==original_plan['taskUuid']==engine['taskUuid'],
        originalContextPreserved=plan['context']==original_plan['context']==engine['binding']['originalContext'],
        localPreparationCompleted=result['state']=='prepared_locally',
        allOriginalBytesMatch=all((runtime/prefix/f'retained/objects/source-{i:05d}.bin').read_bytes()==(inputs/name).read_bytes() for i,name in enumerate(fixture['spec']['sources'])),
        noEngineIntentsIssued=sorted(p.name for p in (runtime/prefix/'engine').iterdir())==['plan.json','writer.lock'],
        engineTransportPermission=result['engineTransportPermission'],
        authorityUnassessed=result['authorityVerification']=='unassessed',
        callbackCustodyUnassessed=result['callbackDeliveryVerification']=='unassessed',
        originalJournalPreserved=logical(runtime)==original_journal)
    completed_package=out/'completed-package-private'
    if command('completed-capture',[sys.executable,'-B',REPO/'openplan/scripts/ops/worker_root_snapshot.py',
               '--source',runtime,'--destination',completed_package,'--writers-quiesced','--timeout','20']):raise AssertionError('Completed root capture failed')
    if command('completed-verify',[sys.executable,'-B',REPO/'openplan/scripts/ops/worker_root_snapshot.py',
               '--destination',completed_package,'--verify']):raise AssertionError('Completed root verification failed')
    complete_image=helper.inventory(completed_package);complete_journal=logical(completed_package/'root')
    copied=out/'completed-runtime-private';shutil.copytree(completed_package/'root',copied)
    supplied['sourceRoot']=out/'absent-original-input'
    restored=Runtime(copied,'synthetic-installation',max_queued=0,pipeline=lambda job:None)
    recovery=Preparation(restored,lambda entry:supplied,timeout=4)
    before=ordinary(copied);before_journal=logical(copied)
    with restored.owner():
        observed['completeCopyNeedsNoOriginalInput']=recovery.resume(fixture['request']['requestId'])==result and not supplied['sourceRoot'].exists()
        for label,change in (('changedActorRefused',{'applicationJob':{**supplied['applicationJob'],'created_by':'another'}}),
                             ('changedEngineRefused',{'engine':{**supplied['engine'],'instanceId':'another'}})):
            changed={**supplied,**change};probe=Preparation(restored,lambda entry:changed,timeout=4)
            try:probe.resume(fixture['request']['requestId'])
            except ValueError:observed[label]=True
            else:observed[label]=False
        path=copied/prefix/'retained/objects/source-00000.bin';raw=path.read_bytes()
        try:
            path.write_bytes(b'X'*len(raw))
            try:recovery.resume(fixture['request']['requestId'])
            except ValueError:observed['changedRetainedBytesRefused']=True
            else:observed['changedRetainedBytesRefused']=False
        finally:
            path.write_bytes(raw)
            with path.open('rb') as stream:os.fsync(stream.fileno())
        recovery.resume(fixture['request']['requestId'])
    observed['negativeFixturesRestored']=ordinary(copied)==before and logical(copied)==before_journal
    observed['originalRootsUnchanged']=ordinary(source)==original and logical(source)==original_journal and helper.inventory(inputs)==original_input
    observed['originalPackagesUnchanged']=all(helper.inventory(p)==image for p,image in zip(packages,package_images)) and logical(packages[0]/'root')==package_journal and helper.inventory(completed_package)==complete_image and logical(completed_package/'root')==complete_journal
    observed['sourceBindingsUnchanged']=all(hashlib.sha256((REPO/name).read_bytes()).hexdigest()==digest for name,digest in bindings.items())
    observe(observed);save(out/'observed.json',observed)
    controls=[]
    for label,value in (('baseline',observed),('harmless-extra-observation',{**observed,'note':'harmless'}),('restored',copy.deepcopy(observed))):
        observe(value);controls.append({'control':label,'outcome':'survived'})
    for key,expected in EXPECTED.items():
        for kind in ('wrong','missing','wrong-type'):
            value=copy.deepcopy(observed)
            if kind=='missing':value.pop(key)
            elif kind=='wrong-type':value[key]=int(expected) if type(expected) is bool else str(expected)
            else:value[key]=not expected if type(expected) is bool else expected+1
            try:observe(value)
            except ValueError as error:
                if str(error)!='runtime-preparation-native-'+key:raise
                controls.append({'control':key+'-'+kind,'outcome':'intended_failure'})
            else:raise AssertionError('Native observation mutation survived')
    save(out/'controls.json',controls);save(out/'source-bindings.json',bindings)
    summary={'observations':len(EXPECTED),'controls':len(controls),'seconds':round(time.monotonic()-began,3),
        'nativeLocalPreparationRecovered':True,'workerRecoveryAccepted':False,
        'engineOrCallbackTransportExecuted':False,'inputImageryDecoded':False,
        'claimLimits':['controlled original application projection, no live authority','explicit local resume, not deployed automatic recovery',
                       'two separately captured stopped local roots, not a complete installation point','no browser or practitioner acceptance']}
    save(out/'summary.json',summary);print(json.dumps(summary))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--child',action='store_true');args=parser.parse_args()
    if args.child:child(args.out.absolute())
    else:run(args.out.absolute())
