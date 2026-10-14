"""Inspect stopped native NodeODM ZIP drafts against an original saved byte plan.

Fresh pinned engines run serially without external network or host ports. No
task commit, decoded imagery, reconstruction, callback or recovery permission.
"""
import argparse
import base64
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
import uuid
import zipfile

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO/'workers/odm_worker'))
from admission_journal import FILENAME, Journal
from engine_effects import Effects


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


native = load('draft_prior_native', REPO/'docs/reviews/2026-10-11-odm-draft-reconciliation/native_reconciliation.py')
helper = load('draft_root_native', REPO/'docs/reviews/2026-10-11-coordinated-worker-point/worker_root.py')
IMAGE, PORT, CLIENT = native.IMAGE, native.PORT, native.CLIENT

EXPECTED = {
    'originalZipPlanFormat': True, 'originalZipArchiveIdentity': True, 'originalDerivedPlanIdentity': True, 'originalOrderedMembers': True,
    'partialInspectionExit': 0, 'completeInspectionExit': 0,
    'partialOriginalUuid': True, 'partialOriginalHash': True,
    'partialExactFirstUpload': True, 'partialMissingSecond': True,
    'partialHasNoTransportPermission': True,
    'completeOriginalUuid': True, 'completeOriginalHash': True,
    'completeExactUploads': True, 'completeHasNoTransportPermission': True,
    'allPackageVerificationsPassed': True, 'allEngineResponsesChecked': True,
    'originalUncertainUploadNotReissued': True, 'unissuedSecondUploadFirstIntent': True,
    'unresolvedFirstReceiptPreserved': True, 'commitRemainsUnissued': True,
    'duplicateNativeUploadRefused': True, 'overwrittenNativeMetadataRefused': True,
    'changedCapturedBytesRefused': True, 'allOwnedEnginesStoppedCleanly': True,
    'allEnginesUsePinnedImage': True, 'allEnginesHaveNoExternalNetworkOrPorts': True,
    'allEnginesHaveDeclaredMemoryLimit': True, 'stoppedRootsMatchPackages': True,
    'allProtectedPackagesUnchanged': True, 'workerOrdinaryUnchangedByInspection': True,
    'workerJournalUnchangedByInspection': True, 'sourceBindingsUnchanged': True,
}


def observe(values):
    for key, expected in EXPECTED.items():
        if key not in values or type(values[key]) is not type(expected) or values[key] != expected:
            raise ValueError('zip-engine-custody-native-'+key)


def checked_responses(responses, task_uuid):
    return len(responses) == 5 and all(type(r['status']) is int and r['status'] == 200 and
        (json.loads(r['body']) == {'uuid':task_uuid} if index in (0,4) else
         json.loads(r['body']) == {'success':True} and json.loads(r['body']).get('success') is True)
        for index, r in enumerate(responses))


def multipart(fields):
    boundary = 'openplan-native-original-draft'
    pieces = []
    for field, value, filename in fields:
        disposition = 'Content-Disposition: form-data; name="'+field+'"'
        if filename is not None: disposition += '; filename="'+filename+'"'
        pieces.append(('--'+boundary+'\r\n'+disposition+'\r\n\r\n').encode()+value+b'\r\n')
    return b''.join(pieces)+('--'+boundary+'--\r\n').encode(), 'multipart/form-data; boundary='+boundary


def run(out):
    os.umask(0o077);out.mkdir(mode=0o700);began = time.monotonic()
    containers, stopped, packages, roots, responses = [], {}, {}, {}, []
    paths = [Path(__file__), Path(native.__file__), Path(helper.__file__),
        REPO/'workers/odm_worker/draft_custody.py', REPO/'workers/odm_worker/engine_effects.py',
        REPO/'workers/odm_worker/retained_source.py', REPO/'workers/odm_worker/derived_zip.py', REPO/'workers/odm_worker/intake.py', REPO/'workers/odm_worker/admission_journal.py',
        REPO/'openplan/scripts/ops/odm_draft_custody.py',
        REPO/'openplan/scripts/ops/worker_root_snapshot.py', REPO/'openplan/scripts/ops/worker_journal_snapshot.py']
    hashes = {str(path.relative_to(REPO)): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
    config = out/'config.json';native.save(config, {'logger': {'logDirectory': '/tmp', 'level': 'error'}})
    counter = 0
    def command(label, args, data=None, timeout=30):
        result = subprocess.run(list(map(str, args)), cwd=REPO, input=data, capture_output=True,
            env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'}, timeout=timeout)
        (out/(label+'.stdout')).write_bytes(result.stdout);(out/(label+'.stderr')).write_bytes(result.stderr)
        return result
    def state(container):
        result = subprocess.run(['docker','inspect',container], capture_output=True, check=True, timeout=10)
        return native.check_owner(json.loads(result.stdout)[0], out)
    def stop(container):
        if container in stopped: return stopped[container]
        value = state(container)
        if value['State']['Running']:
            command('stop-'+container[:12], ['docker','stop','--time=15',container], timeout=25)
        value = state(container);stopped[container] = value
        native.save(out/('container-'+container[:12]+'.json'), value)
        logs = command('logs-'+container[:12], ['docker','logs',container], timeout=10)
        (out/('container-'+container[:12]+'.log')).write_bytes(logs.stdout+logs.stderr)
        return value
    def start(root, label):
        name = 'openplan-odm-zip-custody-'+label+'-'+uuid.uuid4().hex[:10]
        args = ['docker','create','--pull=never','--name',name,'--label','openplan.proof='+str(out),
            '--network=none','--read-only','--memory=512m','--memory-swap=512m','--cpus=1','--pids-limit=64',
            '--cap-drop=ALL','--security-opt=no-new-privileges','--user',str(os.getuid())+':'+str(os.getgid()),
            '--tmpfs',f'/tmp:rw,nosuid,nodev,size=64m,mode=0700,uid={os.getuid()},gid={os.getgid()}',
            '--mount',f'type=bind,src={root}/tmp,dst=/var/www/tmp',
            '--mount',f'type=bind,src={root}/data,dst=/var/www/data',
            '--mount',f'type=bind,src={config},dst=/proof-config.json,readonly',
            '--entrypoint=/usr/bin/node',IMAGE,'-e',"process.umask(0o077);require('/var/www/index.js');",
            '--','native-nodeodm','--port='+str(PORT),'--config=/proof-config.json']
        created = command('create-'+label, args)
        if created.returncode: raise RuntimeError('Native engine creation failed: '+label)
        container = created.stdout.decode().strip();containers.append(container)
        native.save(out/('owned-'+label+'.json'), {'id':container,'root':str(root),'image':IMAGE})
        if command('start-'+label, ['docker','start',container]).returncode:
            raise RuntimeError('Native engine start failed: '+label)
        deadline = time.monotonic()+30
        while True:
            if not state(container)['State']['Running']: raise RuntimeError('Engine exited before readiness')
            result = command('ready-'+label+'-'+str(time.monotonic_ns()),
                ['docker','exec',container,'/usr/bin/node','-e',
                 f"require('http').get('http://127.0.0.1:{PORT}/task/list',r=>{{r.resume();r.on('end',()=>process.exit(r.statusCode===200?0:1));}}).on('error',()=>process.exit(1));"], timeout=10)
            if not result.returncode: break
            if time.monotonic() >= deadline: raise RuntimeError('Native readiness deadline')
            time.sleep(0.2)
        return container
    def api(container, descriptor, fields):
        nonlocal counter
        counter += 1;body, content_type = multipart(fields)
        request = {'path':descriptor['path'], 'method':descriptor['method'], 'body':base64.b64encode(body).decode(),
            'headers':{**descriptor.get('headers', {}), 'Content-Type':content_type}}
        result = command('api-'+str(counter), ['docker','exec','-i',container,'/usr/bin/node','-e',CLIENT],
            json.dumps(request).encode(), timeout=10)
        if result.returncode: raise RuntimeError('Native API failed: '+str(counter))
        response = native.json_response(result.stdout);responses.append(response)
        return response
    worker = out/'worker';worker.mkdir(mode=0o700)
    inputs = out/'input';inputs.mkdir(mode=0o700)
    with zipfile.ZipFile(inputs/'original.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('second/a.jpg', b'Synthetic native ZIP second ordinary bytes')
        archive.writestr('first/a.JPG', b'Synthetic native ZIP first ordinary bytes')
    (inputs/'original.zip').chmod(0o600)
    context = {key:'synthetic-'+key for key in ('installationId','originalActorId','targetId','applicationJobId')}
    context.update(workspaceId='synthetic-workspace', missionId='synthetic-mission')
    request = {'requestId':'synthetic-draft-custody', 'externalRef':{
        'workspaceId':context['workspaceId'], 'missionId':context['missionId']},
        'imagery':{'type':'zip_url','url':'http://127.0.0.1:1/unused.zip'}}
    journal = Journal(worker/'admissions')
    journal.admit(request, lambda value: ('synthetic-original-job', {
        'requestId':value['requestId'],'jobReference':'synthetic-original-job','status':'accepted'}), max_queued=2)
    task_uuid = str(uuid.uuid4())
    effects = Effects(root=worker/'effects', source_arguments={'journal':journal,
        'request_id':request['requestId'],'reference':'synthetic-original-job','context':context,
        'source_root':inputs,'sources':['original.zip'],'destination':worker/'source','max_bytes':4096,'timeout':2},
        engine={'instanceId':'synthetic-owned-original-native-root','endpoint':'http://127.0.0.1:'+str(PORT),
            'api':'nodeodm-2.2.4-draft','version':'2.2.4','imageId':IMAGE,
            'configurationSha256':hashlib.sha256(config.read_bytes()).hexdigest(),'credentialReference':'synthetic-no-secret'},
        task_uuid=task_uuid,name='Synthetic original custody draft',options=[],filenames=['image-00000.jpg','image-00001.jpg'], derived_arguments={'destination':worker/'derived', 'max_expanded_bytes':4096, 'max_entries':100, 'max_directory_bytes':1024*1024})
    plan = effects.plan;budget = sum(row['bytes'] for row in plan['uploads'])
    def upload(container, index):
        intent, first = effects.issue('upload:'+str(index))
        row = plan['uploads'][index]
        response = api(container, intent['command'], [('images',(worker/'derived'/row['objectRelativePath']).read_bytes(),row['filename'])])
        return first, response
    def capture(root, label):
        package = out/('package-'+label)
        captured = command('capture-'+label, [sys.executable,'-B',REPO/'openplan/scripts/ops/worker_root_snapshot.py',
            '--source',root,'--destination',package,'--writers-quiesced','--timeout','30'])
        verified = command('verify-'+label, [sys.executable,'-B',REPO/'openplan/scripts/ops/worker_root_snapshot.py',
            '--destination',package,'--verify'])
        roots[label] = (root, helper.inventory(root));packages[label] = (package, helper.inventory(package))
        return package, captured.returncode, verified.returncode
    def inspection(package, label):
        return command('inspection-'+label, [sys.executable,'-B',REPO/'openplan/scripts/ops/odm_draft_custody.py',
            '--snapshot',package,'--engine-plan',worker/'effects/plan.json','--plan-sha256',effects.plan_hash,
            '--max-bytes',str(budget),'--timeout','30'])
    def worker_ordinary():
        return {key:value for key,value in helper.inventory(worker).items()
            if key not in {'admissions/'+FILENAME+suffix for suffix in ('','-wal','-shm')}}
    def worker_logical(): return helper.sqlite_image(worker/'admissions'/FILENAME)
    try:
        source = out/'engine-original';source.mkdir(mode=0o700)
        for name in ('tmp','data'): (source/name).mkdir(mode=0o700)
        engine = start(source,'original')
        intent, _first = effects.issue('init')
        initialized = api(engine,intent['command'],[(key,value.encode(),None) for key,value in intent['command']['form'].items()])
        effects.save_reply('init',initialized['status'],initialized['body'].encode())
        first_a, uploaded_a = upload(engine,0)
        # The response is observed, but its worker receipt is deliberately not
        # saved. This models receipt interruption, not lost network delivery.
        stop(engine);partial_package, c1, v1 = capture(source,'partial')
        ordinary_before, logical_before = worker_ordinary(), worker_logical()
        partial = inspection(partial_package,'partial');p = json.loads(partial.stdout)
        unchanged_partial = ordinary_before == worker_ordinary() and logical_before == worker_logical()
        unchanged_flag = effects.issue('upload:0')[1]
        restored = out/'engine-restored';shutil.copytree(partial_package/'root',restored)
        engine = start(restored,'restored');first_b, uploaded_b = upload(engine,1)
        effects.save_reply('upload:1',uploaded_b['status'],uploaded_b['body'].encode())
        stop(engine);complete_package, c2, v2 = capture(restored,'complete')
        ordinary_before, logical_before = worker_ordinary(), worker_logical()
        complete = inspection(complete_package,'complete');q = json.loads(complete.stdout)
        ordinary_unchanged = ordinary_before == worker_ordinary();logical_unchanged = logical_before == worker_logical()
        duplicate = out/'engine-duplicate';shutil.copytree(complete_package/'root',duplicate)
        engine = start(duplicate,'duplicate')
        row = plan['uploads'][0]
        duplicated = api(engine,effects.command_map['upload:0'],[('images',(worker/'derived'/row['objectRelativePath']).read_bytes(),row['filename'])])
        stop(engine);duplicate_package, c3, v3 = capture(duplicate,'duplicate')
        duplicate_check = inspection(duplicate_package,'duplicate')
        changed = out/'engine-metadata';shutil.copytree(complete_package/'root',changed)
        engine = start(changed,'metadata')
        descriptor = copy.deepcopy(effects.command_map['init']);descriptor['form']['name'] = 'Synthetic overwritten native draft'
        reinitialized = api(engine,descriptor,[(key,value.encode(),None) for key,value in descriptor['form'].items()])
        stop(engine);metadata_package, c4, v4 = capture(changed,'metadata')
        metadata_check = inspection(metadata_package,'metadata')
        altered = out/'engine-altered';shutil.copytree(complete_package/'root',altered)
        path = altered/'tmp'/task_uuid/row['filename'];raw = path.read_bytes()
        try:
            path.write_bytes(b'X'+raw[1:]);bad_package, c5, v5 = capture(altered,'altered')
            bad_check = inspection(bad_package,'altered')
        finally: path.write_bytes(raw)
        states = {row['operation']:row['state'] for row in effects.snapshot()['commands']}
        derived_manifest = json.loads((worker/'derived/manifest.json').read_bytes())
        values = {
            'originalZipPlanFormat': plan['format']=='openplan.odm-engine-zip-plan.v1',
            'originalZipArchiveIdentity': plan['sourceCustody']['archive']=={'bytes':(inputs/'original.zip').stat().st_size,'sha256':hashlib.sha256((inputs/'original.zip').read_bytes()).hexdigest()} and plan['sourceCustody']['retainedManifestSha256']==hashlib.sha256((worker/'source/manifest.json').read_bytes()).hexdigest(),
            'originalDerivedPlanIdentity': plan['sourceManifestSha256']==hashlib.sha256((worker/'derived/manifest.json').read_bytes()).hexdigest() and plan['sourceCustody']['derivedPlanSha256']==hashlib.sha256((worker/'derived/plan.json').read_bytes()).hexdigest(),
            'originalOrderedMembers': [row['archiveMember'] for row in plan['uploads']]==['first/a.JPG','second/a.jpg'],
            'partialInspectionExit':partial.returncode,'completeInspectionExit':complete.returncode,
            'partialOriginalUuid':p['taskUuid']==task_uuid,'partialOriginalHash':p['planSha256']==effects.plan_hash,
            'partialExactFirstUpload':p['state']=='partial_matching_draft' and p['matchingUploads']==[{'slot':0,'filename':row['filename'],'bytes':row['bytes'],'sha256':row['sha256']}],
            'partialMissingSecond':p['missingUploads']==[1], 'partialHasNoTransportPermission':p['transportPermission'] is False,
            'completeOriginalUuid':q['taskUuid']==task_uuid,'completeOriginalHash':q['planSha256']==effects.plan_hash,
            'completeExactUploads':q['state']=='complete_matching_draft' and q['missingUploads']==[] and q['matchingUploads']==[{key:r[key] for key in ('slot','filename','bytes','sha256')} for r in plan['uploads']],
            'completeHasNoTransportPermission':q['transportPermission'] is False,
            'allPackageVerificationsPassed':all(code==0 for code in (c1,v1,c2,v2,c3,v3,c4,v4,c5,v5)),
            'allEngineResponsesChecked':checked_responses(responses, task_uuid),
            'originalUncertainUploadNotReissued':first_a is True and unchanged_flag is False,
            'unissuedSecondUploadFirstIntent':first_b is True,'unresolvedFirstReceiptPreserved':states['upload:0']=='unresolved',
            'commitRemainsUnissued':states['commit']=='unissued',
            'duplicateNativeUploadRefused':duplicate_check.returncode==1 and b'duplicates' in duplicate_check.stderr,
            'overwrittenNativeMetadataRefused':metadata_check.returncode==1 and b'metadata differs' in metadata_check.stderr,
            'changedCapturedBytesRefused':bad_check.returncode==1 and b'original bytes' in bad_check.stderr,
            'allOwnedEnginesStoppedCleanly':len(stopped)==4 and all(v['State']['Running'] is False and v['State']['ExitCode']==0 and v['State']['OOMKilled'] is False for v in stopped.values()),
            'allEnginesUsePinnedImage':all(v['Image']==IMAGE for v in stopped.values()),
            'allEnginesHaveNoExternalNetworkOrPorts':all(v['HostConfig']['NetworkMode']=='none' and not v['HostConfig']['PortBindings'] for v in stopped.values()),
            'allEnginesHaveDeclaredMemoryLimit':all(v['HostConfig']['Memory']==536870912 and v['HostConfig']['MemorySwap']==536870912 for v in stopped.values()),
            'stoppedRootsMatchPackages':all(helper.inventory(package/'root')==roots[label][1] for label,(package,_image) in packages.items()),
            'allProtectedPackagesUnchanged':all(helper.inventory(package)==image for package,image in packages.values()),
            'workerOrdinaryUnchangedByInspection':unchanged_partial and ordinary_unchanged,
            'workerJournalUnchangedByInspection':unchanged_partial and logical_unchanged,
            'sourceBindingsUnchanged':all(hashlib.sha256(path.read_bytes()).hexdigest()==hashes[str(path.relative_to(REPO))] for path in paths),
        }
        native.save(out/'observed.json',values);observe(values)
        controls = []
        for label,value in [('baseline',values),('harmless-order',dict(reversed(list(values.items())))),('restored',values)]:
            observe(value);controls.append({'control':label,'outcome':'survived'})
        for key, expected in EXPECTED.items():
            for kind in ('wrong','missing','wrong-type'):
                altered = dict(values)
                if kind=='missing': altered.pop(key)
                elif kind=='wrong-type': altered[key] = 1 if type(expected) is bool else True
                else: altered[key] = not expected if type(expected) is bool else expected+1
                try: observe(altered)
                except ValueError as error:
                    if str(error) != 'zip-engine-custody-native-'+key: raise
                    controls.append({'control':key+'-'+kind,'outcome':'intended_failure','reason':str(error)})
                else: raise AssertionError('Native observation control survived: '+key)
        native.save(out/'controls.json',controls);native.save(out/'source-bindings.json',hashes)
        response_controls = []
        for label, entries in [('baseline', responses), ('harmless-json-space', [{**r,'body':' '+r['body']+' '} for r in responses]), ('restored', responses)]:
            if checked_responses(entries, task_uuid) is not True: raise AssertionError('Response harmless control failed')
            response_controls.append({'control':label,'outcome':'survived'})
        cases = [('empty', []), ('missing-last', responses[:-1])]
        for label, index, value in [('wrong-status',1,{'status':201}),('wrong-uuid',0,{'body':'{"uuid":"changed"}'}),('failed-upload',1,{'body':'{"success":false}'}),('nonboolean-upload',1,{'body':'{"success":1}'})]:
            changed = copy.deepcopy(responses);changed[index].update(value);cases.append((label,changed))
        for label, entries in cases:
            if checked_responses(entries, task_uuid) is not False: raise AssertionError('Broken response control survived: '+label)
            response_controls.append({'control':label,'outcome':'intended_refusal'})
        native.save(out/'response-controls.json',response_controls)
        summary = {'seconds':round(time.monotonic()-began,3),'observations':len(EXPECTED),'controls':len(controls),
            'responseControls':len(response_controls),
            'ownedStoppedContainers':len(stopped),'image':IMAGE,'engineReconstruction':False,'engineMetadataProbes':True,
            'workerRecoveryAccepted':False,'transportPermission':False,'sourceType':'synthetic ordinary bytes, not decoded imagery'}
        native.save(out/'summary.json',summary);print(json.dumps(summary))
    finally:
        for container in containers:
            stop(container)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__);parser.add_argument('--out',type=Path,required=True)
    args = parser.parse_args();run(args.out.absolute())
