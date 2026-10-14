"""Abrupt derived-slot interruption and actual stopped-root copy recovery."""
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
import zipfile

REPO=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(REPO/'workers/odm_worker'))
from admission_journal import FILENAME, Journal
import derived_zip

EXPECTED={'childExit':19,'captureExit':0,'verifyExit':0,
    'originalPlanPresent':True,'originalFirstSlotPresent':True,'originalSecondSlotAbsent':True,'originalManifestAbsent':True,
    'capturedOrdinaryMatchesSource':True,'capturedJournalMatchesSource':True,
    'runtimeInitiallyMatchesPackage':True,'originalPlanPreserved':True,'originalFirstSlotPreserved':True,
    'originalArchiveIdentityPreserved':True,'originalBindingPreserved':True,'bothOriginalDerivedBytesRecovered':True,
    'originalDownloadUnavailable':True,'completedReplayExact':True,
    'changedArchiveRefused':True,'changedDerivedBytesRefused':True,'changedActorRefused':True,
    'runtimeOrdinaryUnchangedOnReplay':True,'runtimeJournalUnchangedOnReplay':True,
    'sourceOrdinaryUnchanged':True,'sourceJournalUnchanged':True,'packageUnchanged':True,'sourceBindingsUnchanged':True}


def save(path,value):
    with path.open('x') as stream:
        json.dump(value,stream,indent=2,sort_keys=True);stream.write('\n');stream.flush();os.fsync(stream.fileno())


def observe(values):
    for key,expected in EXPECTED.items():
        if key not in values or type(values[key]) is not type(expected) or values[key]!=expected:
            raise ValueError('zip-native-'+key)


def source_arguments(root,input_root):
    context={key:'synthetic-'+key for key in ('installationId','originalActorId','targetId','applicationJobId')}
    context.update(workspaceId='synthetic-workspace',missionId='synthetic-mission')
    return {'journal':Journal(root/'admissions'),'request_id':'synthetic-native-zip','reference':'synthetic-original-job',
        'context':context,'source_root':input_root,'sources':['original.zip'],'destination':root/'source','max_bytes':1024*1024,'timeout':2}


def prepare(root,input_root,**changes):
    return derived_zip.prepare(source_arguments(root,input_root),destination=root/'derived',max_expanded_bytes=4096,
        max_entries=100,max_directory_bytes=1024*1024,timeout=5,**changes)


def child(out):
    root=out/'worker';root.mkdir(mode=0o700);inputs=out/'input';inputs.mkdir(mode=0o700)
    with zipfile.ZipFile(inputs/'original.zip','w',zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('second/a.jpg',b'Synthetic native second ordinary bytes')
        archive.writestr('first/a.JPG',b'Synthetic native first ordinary bytes')
        archive.writestr('readme.txt',b'Ignored synthetic text')
    args=source_arguments(root,inputs)
    request={'requestId':args['request_id'],'externalRef':{'workspaceId':'synthetic-workspace','missionId':'synthetic-mission'},
        'imagery':{'type':'zip_url','url':'http://127.0.0.1:1/never.zip'}}
    args['journal'].admit(request,lambda value:('synthetic-original-job',{'requestId':value['requestId'],'jobReference':'synthetic-original-job','status':'accepted'}),max_queued=2)
    sync=derived_zip.synchronize
    def stop_after_slot(path):
        sync(path)
        if path==root/'derived/objects' and (path/'image-00000.bin').exists() and not (path/'image-00001.bin').exists():
            # Real file and directory sync returned. Interpreter shutdown and
            # finally blocks do not run. This is not power loss inside fsync.
            os._exit(19)
    derived_zip.synchronize=stop_after_slot
    prepare(root,inputs)
    raise RuntimeError('Native child missed interrupted slot boundary')


def run(out):
    os.umask(0o077);out.mkdir(mode=0o700);began=time.monotonic()
    spec=importlib.util.spec_from_file_location('zip_native_root',REPO/'docs/reviews/2026-10-11-coordinated-worker-point/worker_root.py')
    helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    def ordinary(root):
        return {key:value for key,value in helper.inventory(root).items()
            if key not in {'admissions/'+FILENAME+suffix for suffix in ('','-wal','-shm')}}
    def logical(root):return helper.sqlite_image(root/'admissions'/FILENAME)
    paths=[Path(__file__),REPO/'workers/odm_worker/derived_zip.py',REPO/'workers/odm_worker/retained_source.py',
        REPO/'workers/odm_worker/admission_journal.py',REPO/'workers/odm_worker/intake.py',
        REPO/'openplan/scripts/ops/worker_root_snapshot.py',REPO/'openplan/scripts/ops/worker_journal_snapshot.py',Path(helper.__file__)]
    bindings={str(path.relative_to(REPO)):hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
    def command(label,args):
        result=subprocess.run(list(map(str,args)),cwd=REPO,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'},capture_output=True,timeout=30)
        (out/(label+'.stdout')).write_bytes(result.stdout);(out/(label+'.stderr')).write_bytes(result.stderr)
        return result
    result=command('child',[sys.executable,'-B',__file__,'--child','--out',out])
    source=out/'worker';package=out/'package';runtime=out/'runtime';absent=out/'absent-download'
    original=ordinary(source);original_logical=logical(source)
    plan_bytes=(source/'derived/plan.json').read_bytes();plan=json.loads(plan_bytes)
    first_bytes=(source/'derived/objects/image-00000.bin').read_bytes()
    captured=command('capture',[sys.executable,'-B',REPO/'openplan/scripts/ops/worker_root_snapshot.py',
        '--source',source,'--destination',package,'--writers-quiesced','--timeout','30'])
    verified=command('verify',[sys.executable,'-B',REPO/'openplan/scripts/ops/worker_root_snapshot.py','--destination',package,'--verify'])
    retained=package/'root';package_image=helper.inventory(package)
    shutil.copytree(retained,runtime);initial=ordinary(runtime)==ordinary(retained) and logical(runtime)==logical(retained)
    receipt=prepare(runtime,absent);recovered=ordinary(runtime);recovered_logical=logical(runtime)
    replay=prepare(runtime,absent)
    def refuse_bytes(path,message):
        raw=path.read_bytes()
        try:
            path.write_bytes(b'X'+raw[1:])
            try:prepare(runtime,absent)
            except ValueError as error:return message in str(error)
            return False
        finally:path.write_bytes(raw)
    archive_refused=refuse_bytes(runtime/'source/objects/source-00000.bin','Retained source slot differs')
    derived_refused=refuse_bytes(runtime/'derived/objects/image-00000.bin','Retained derived ZIP image differs')
    args=source_arguments(runtime,absent);args['context']['originalActorId']='changed-original-actor'
    try:
        derived_zip.prepare(args,destination=runtime/'derived',max_expanded_bytes=4096,max_entries=100,max_directory_bytes=1024*1024,timeout=5)
    except ValueError as error:actor_refused='Saved source preparation identity differs' in str(error)
    else:actor_refused=False
    manifest=receipt['manifest']
    values={'childExit':result.returncode,'captureExit':captured.returncode,'verifyExit':verified.returncode,
        'originalPlanPresent':bool(plan_bytes),'originalFirstSlotPresent':bool(first_bytes),
        'originalSecondSlotAbsent':not (source/'derived/objects/image-00001.bin').exists(),
        'originalManifestAbsent':not (source/'derived/manifest.json').exists(),
        'capturedOrdinaryMatchesSource':ordinary(retained)==original,'capturedJournalMatchesSource':logical(retained)==original_logical,
        'runtimeInitiallyMatchesPackage':initial,'originalPlanPreserved':(runtime/'derived/plan.json').read_bytes()==plan_bytes,
        'originalFirstSlotPreserved':(runtime/'derived/objects/image-00000.bin').read_bytes()==first_bytes,
        'originalArchiveIdentityPreserved':manifest['archive']==plan['archive'],
        'originalBindingPreserved':manifest['binding']==plan['binding'],
        'bothOriginalDerivedBytesRecovered':len(manifest['sources'])==2 and all((runtime/entry['objectRelativePath'].replace('objects/','derived/objects/',1)).read_bytes()==raw for entry,raw in zip(manifest['sources'],[b'Synthetic native first ordinary bytes',b'Synthetic native second ordinary bytes'])),
        'originalDownloadUnavailable':not absent.exists(),'completedReplayExact':replay==receipt,
        'changedArchiveRefused':archive_refused,'changedDerivedBytesRefused':derived_refused,'changedActorRefused':actor_refused,
        'runtimeOrdinaryUnchangedOnReplay':ordinary(runtime)==recovered,'runtimeJournalUnchangedOnReplay':logical(runtime)==recovered_logical,
        'sourceOrdinaryUnchanged':ordinary(source)==original,'sourceJournalUnchanged':logical(source)==original_logical,
        'packageUnchanged':helper.inventory(package)==package_image,
        'sourceBindingsUnchanged':all(hashlib.sha256(path.read_bytes()).hexdigest()==bindings[str(path.relative_to(REPO))] for path in paths)}
    save(out/'observed.json',values);observe(values);controls=[]
    for label,value in [('baseline',values),('harmless-order',dict(reversed(list(values.items())))),('restored',values)]:
        observe(value);controls.append({'control':label,'outcome':'survived'})
    for key,expected in EXPECTED.items():
        for kind in ('wrong','missing','wrong-type'):
            changed=dict(values)
            if kind=='missing':changed.pop(key)
            elif kind=='wrong-type':changed[key]=1 if type(expected) is bool else True
            else:changed[key]=not expected if type(expected) is bool else expected+1
            try:observe(changed)
            except ValueError as error:
                if str(error)!='zip-native-'+key:raise
                controls.append({'control':key+'-'+kind,'outcome':'intended_failure','reason':str(error)})
            else:raise AssertionError('ZIP native control survived: '+key)
    save(out/'controls.json',controls);save(out/'source-bindings.json',bindings)
    summary={'seconds':round(time.monotonic()-began,3),'observations':len(EXPECTED),'controls':len(controls),
        'workerRecoveryAccepted':False,'engineRequests':False,'imageDecoding':False}
    save(out/'summary.json',summary);print(json.dumps(summary))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--out',type=Path,required=True);parser.add_argument('--child',action='store_true')
    args=parser.parse_args();os.umask(0o077)
    child(args.out.absolute()) if args.child else run(args.out.absolute())
