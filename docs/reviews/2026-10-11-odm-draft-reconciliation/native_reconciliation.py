"""Reproduce duplicate upload and overwritten draft metadata on cached NodeODM.

Fresh containers expose no host ports or network. Synthetic bytes are uploaded
without task commit, decoding, reconstruction or a callback. Metadata probes run.
"""
import argparse
import base64
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

REPO = Path(__file__).resolve().parents[3]
IMAGE = 'sha256:cb07d06e21fd6189cfad287c6fedfa0b72568100355635cd9035cb86eed42ee2'
PORT = 34100
CLIENT = r"""const http = require('http');
let incoming = '';
process.stdin.on('data', part => incoming += part);
process.stdin.on('end', () => {
  const command = JSON.parse(incoming);
  const body = Buffer.from(command.body || '', 'base64');
  const req = http.request({host:'127.0.0.1', port:34100, path:command.path,
    method:command.method, headers:{...command.headers,'Content-Length':body.length}}, res => {
      let chunks = [], count = 0;
      res.on('data', part => { count += part.length; if(count > 1048576) res.destroy(new Error('response bound')); else chunks.push(part); });
      res.on('end', () => console.log(JSON.stringify({status:res.statusCode, body:Buffer.concat(chunks).toString()})));
      res.on('error', error => { console.error(error.message); process.exitCode = 1; });
    });
  req.setTimeout(5000, () => req.destroy(new Error('request deadline')));
  req.on('error', error => { console.error(error.message); process.exitCode = 1; });
  req.end(body);
});
"""

EXPECTED = {
    'captureExit': 0, 'verifyExit': 0,
    'originalInitSameUuid': True, 'bothUploadResponsesSucceed': True,
    'duplicateUploadedBytes': True, 'duplicateFilenamesDiffer': True,
    'repeatedInitSameUuid': True, 'originalDraftMetadataOverwritten': True,
    'originalTaskListEmpty': True, 'originalTaskInfoAbsent': True,
    'restoredTaskListEmpty': True, 'restoredTaskInfoAbsent': True,
    'restoredDraftBytesRetained': True, 'originalStoppedCleanly': True,
    'restoredStoppedCleanly': True, 'sourceOrdinaryUnchanged': True,
    'packageOrdinaryUnchanged': True, 'retainedMatchesSource': True,
    'runtimeInitiallyMatchesPackage': True, 'sourceBindingsUnchanged': True,
}


def observe(values):
    for key, expected in EXPECTED.items():
        if key not in values or type(values[key]) is not type(expected) or values[key] != expected:
            raise ValueError('draft-native-'+key)


def save(path, value):
    with path.open('x') as stream:
        json.dump(value, stream, indent=2, sort_keys=True)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())


def json_response(raw):
    lines = raw.splitlines()
    if len(lines) != 2 or lines[0] != b'Now using node v14.21.3 (npm v6.14.18)':
        raise ValueError('Native Node wrapper prelude differs')
    return json.loads(lines[1])


def check_owner(value, out):
    if value['Config']['Labels'].get('openplan.proof') != str(out):
        raise ValueError('Refusing an unowned container')
    return value


def run(out):
    out.mkdir(mode=0o700)
    began = time.monotonic()
    containers = []
    counter = 0
    spec = importlib.util.spec_from_file_location('draft_native_root', REPO/'docs/reviews/2026-10-11-coordinated-worker-point/worker_root.py')
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    paths = [Path(__file__), REPO/'openplan/scripts/ops/worker_root_snapshot.py',
             REPO/'openplan/scripts/ops/worker_journal_snapshot.py',
             REPO/'docs/reviews/2026-10-11-coordinated-worker-point/worker_root.py']
    hashes = {str(path.relative_to(REPO)): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
    config = out/'config.json'
    save(config, {'logger': {'logDirectory': '/tmp', 'level': 'error'}})
    def command(label, args, data=None, timeout=30):
        result = subprocess.run(list(map(str, args)), cwd=REPO, input=data,
                                env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'}, capture_output=True, timeout=timeout)
        (out/(label+'.stdout')).write_bytes(result.stdout)
        (out/(label+'.stderr')).write_bytes(result.stderr)
        return result
    def state(container):
        inspected = subprocess.run(['docker','inspect',container],capture_output=True,check=True,timeout=10)
        value = json.loads(inspected.stdout)[0]
        return check_owner(value, out)
    def stop(container):
        value = state(container)
        if value['State']['Running']:
            command('stop-'+container[:12], ['docker','stop','--time=15',container], timeout=25)
        value = state(container)
        save(out/('container-'+container[:12]+'.json'), {
            'id': container, 'image': value['Image'], 'state': value['State'],
            'memoryMax': value['HostConfig']['Memory'], 'memorySwap': value['HostConfig']['MemorySwap'],
            'networkMode': value['HostConfig']['NetworkMode'], 'mounts': value['Mounts']})
        logs = subprocess.run(['docker','logs',container],capture_output=True,timeout=10)
        (out/('container-'+container[:12]+'.log')).write_bytes(logs.stdout+logs.stderr)
        return value['State']['Running'] is False and value['State']['ExitCode'] == 0 and value['State']['OOMKilled'] is False
    def api(container, path, method='GET', body=b'', content_type=None):
        nonlocal counter
        counter += 1
        headers = {} if content_type is None else {'Content-Type':content_type}
        request = {'path':path,'method':method,'body':base64.b64encode(body).decode(),'headers':headers}
        result = command('api-'+str(counter), ['docker','exec','-i',container,'/usr/bin/node','-e',CLIENT],
                         json.dumps(request).encode(),timeout=10)
        if result.returncode:
            raise RuntimeError('Native API command failed: '+str(counter))
        response = json_response(result.stdout)
        return response['status'], json.loads(response['body'])
    def start(root, label):
        name = 'openplan-odm-draft-'+label+'-'+uuid.uuid4().hex[:10]
        args = ['docker','create','--pull=never','--name',name,'--label','openplan.proof='+str(out),
                '--network=none','--read-only','--memory=512m','--memory-swap=512m','--cpus=1','--pids-limit=64',
                '--cap-drop=ALL','--security-opt=no-new-privileges','--user',str(os.getuid())+':'+str(os.getgid()),
                '--tmpfs',f'/tmp:rw,nosuid,nodev,size=64m,mode=0700,uid={os.getuid()},gid={os.getgid()}',
                '--mount',f'type=bind,src={root}/tmp,dst=/var/www/tmp',
                '--mount',f'type=bind,src={root}/data,dst=/var/www/data',
                '--mount',f'type=bind,src={config},dst=/proof-config.json,readonly',
                '--entrypoint=/usr/bin/node',IMAGE,'-e',"process.umask(0o077);require('/var/www/index.js');",
                '--','native-nodeodm','--port='+str(PORT),'--config=/proof-config.json']
        created = command('create-'+label,args)
        if created.returncode:
            raise RuntimeError('Native container creation failed: '+label)
        container = created.stdout.decode().strip()
        containers.append(container)
        save(out/('owned-'+label+'.json'),{'id':container,'name':name,'root':str(root),'image':IMAGE})
        if command('start-'+label,['docker','start',container]).returncode:
            raise RuntimeError('Native container start failed: '+label)
        deadline = time.monotonic()+30
        while True:
            if not state(container)['State']['Running']:
                raise RuntimeError('Native API exited before readiness: '+label)
            result = command('ready-'+label+'-'+str(time.monotonic_ns()),
                             ['docker','exec',container,'/usr/bin/node','-e',
                              f"require('http').get('http://127.0.0.1:{PORT}/task/list',r=>{{r.resume();r.on('end',()=>process.exit(r.statusCode===200?0:1));}}).on('error',()=>process.exit(1));"],timeout=10)
            if result.returncode == 0:
                break
            if time.monotonic() >= deadline:
                raise RuntimeError('Native API readiness deadline: '+label)
            time.sleep(0.2)
        return container
    def multipart(field, value, filename=None):
        boundary='openplan-synthetic-native-boundary'
        disposition='Content-Disposition: form-data; name="'+field+'"'
        if filename:
            disposition += '; filename="'+filename+'"'
        body=('--'+boundary+'\r\n'+disposition+'\r\n\r\n').encode()+value+b'\r\n'+('--'+boundary+'--\r\n').encode()
        return body, 'multipart/form-data; boundary='+boundary
    original = out/'source'
    original.mkdir(mode=0o700)
    for name in ['tmp','data']:
        (original/name).mkdir(mode=0o700)
    task_uuid = str(uuid.uuid4())
    # Caller UUID is an actual HTTP header, not a worker-created task handle.
    def init(container, title):
        nonlocal counter
        counter += 1
        body, content_type = multipart('name',title.encode())
        request={'path':'/task/new/init','method':'POST','body':base64.b64encode(body).decode(),
                 'headers':{'Content-Type':content_type,'set-uuid':task_uuid}}
        result=command('api-'+str(counter),['docker','exec','-i',container,'/usr/bin/node','-e',CLIENT],json.dumps(request).encode(),timeout=10)
        if result.returncode:
            raise RuntimeError('Native init command failed')
        response=json_response(result.stdout)
        return response['status'],json.loads(response['body'])
    try:
        producer = start(original,'source')
        first_init = init(producer,'Synthetic original draft')
        data=b'Synthetic ordinary bytes. Not decoded imagery.\n'
        body,content_type=multipart('images',data,'synthetic-photo.jpg')
        first_upload=api(producer,'/task/new/upload/'+task_uuid,'POST',body,content_type)
        second_upload=api(producer,'/task/new/upload/'+task_uuid,'POST',body,content_type)
        draft=original/'tmp'/task_uuid
        image_files=sorted(path for path in draft.iterdir() if path.name!='body.json')
        saved_body=json.loads((draft/'body.json').read_text())
        second_init=init(producer,'Synthetic changed draft')
        changed_body=json.loads((draft/'body.json').read_text())
        first_list=api(producer,'/task/list')
        first_info=api(producer,'/task/'+task_uuid+'/info')
        clean_source=stop(producer)
        source_image=helper.inventory(original)
        capture=command('capture',[sys.executable,'-B',REPO/'openplan/scripts/ops/worker_root_snapshot.py',
                                  '--source',original,'--destination',out/'package','--writers-quiesced','--timeout','30'])
        verified=command('verify',[sys.executable,'-B',REPO/'openplan/scripts/ops/worker_root_snapshot.py',
                                 '--destination',out/'package','--verify'])
        retained=out/'package/root'
        package_image=helper.inventory(retained)
        runtime=out/'runtime'
        shutil.copytree(retained,runtime)
        runtime_image=helper.inventory(runtime)
        restored=start(runtime,'restored')
        restored_list=api(restored,'/task/list')
        restored_info=api(restored,'/task/'+task_uuid+'/info')
        clean_restored=stop(restored)
        values={
            'captureExit':capture.returncode,'verifyExit':verified.returncode,
            'originalInitSameUuid':first_init==(200,{'uuid':task_uuid}),
            'bothUploadResponsesSucceed':first_upload==(200,{'success':True}) and second_upload==(200,{'success':True}),
            'duplicateUploadedBytes':len(image_files)==2 and all(path.read_bytes()==data for path in image_files),
            'duplicateFilenamesDiffer':len(image_files)==2 and len({path.name for path in image_files})==2,
            'repeatedInitSameUuid':second_init==(200,{'uuid':task_uuid}),
            'originalDraftMetadataOverwritten':saved_body=={'name':'Synthetic original draft'} and changed_body=={'name':'Synthetic changed draft'},
            'originalTaskListEmpty':first_list==(200,[]),'originalTaskInfoAbsent':first_info==(200,{'error':task_uuid+' not found'}),
            'restoredTaskListEmpty':restored_list==(200,[]),'restoredTaskInfoAbsent':restored_info==(200,{'error':task_uuid+' not found'}),
            'restoredDraftBytesRetained':helper.inventory(runtime/'tmp')==helper.inventory(retained/'tmp'),
            'originalStoppedCleanly':clean_source,'restoredStoppedCleanly':clean_restored,
            'sourceOrdinaryUnchanged':source_image==helper.inventory(original),
            'packageOrdinaryUnchanged':package_image==helper.inventory(retained),
            'retainedMatchesSource':package_image==source_image,'runtimeInitiallyMatchesPackage':runtime_image==package_image,
            'sourceBindingsUnchanged':all(hashlib.sha256(path.read_bytes()).hexdigest()==hashes[str(path.relative_to(REPO))] for path in paths),
        }
        save(out/'observed.json',values)
        observe(values)
        raw_response=(out/'api-1.stdout').read_bytes()
        wrapper_controls=[]
        for label,raw in [('baseline',raw_response),('harmless-json-space',raw_response.replace(b'\n{',b'\n  {',1)),('restored',raw_response)]:
            if json_response(raw)!=json_response(raw_response):
                raise AssertionError('Harmless wrapper control changed the receipt')
            wrapper_controls.append({'control':label,'outcome':'survived'})
        for label,raw in [('missing-prelude',raw_response.split(b'\n',1)[1]),
                          ('changed-prelude',raw_response.replace(b'v14.21.3',b'v99.0.0',1)),
                          ('extra-stdout',b'Unexpected stdout\n'+raw_response)]:
            try:
                json_response(raw)
            except ValueError as error:
                if str(error)!='Native Node wrapper prelude differs':
                    raise
                wrapper_controls.append({'control':label,'outcome':'intended_failure'})
            else:
                raise AssertionError('Native wrapper mutation survived: '+label)
        save(out/'wrapper-controls.json',wrapper_controls)
        controls=[]
        for label,trial in [('baseline',values),('harmless-key-order',dict(reversed(list(values.items())))),('restored',values)]:
            observe(trial)
            controls.append({'control':label,'outcome':'survived'})
        for key,expected in EXPECTED.items():
            for kind in ['changed','missing','wrong_type']:
                trial=dict(values)
                if kind=='missing':
                    trial.pop(key)
                elif kind=='wrong_type':
                    trial[key]=int(expected) if type(expected) is bool else float(expected)
                else:
                    trial[key]=not expected if type(expected) is bool else expected+1
                try:
                    observe(trial)
                except ValueError as error:
                    if str(error)!='draft-native-'+key:
                        raise
                    controls.append({'control':key+'-'+kind,'outcome':'intended_failure'})
                else:
                    raise AssertionError('Native draft observation mutation survived: '+key+'-'+kind)
        save(out/'controls.json',controls)
        save(out/'source-bindings.json',hashes)
        save(out/'result.json',{'outcome':'unsafe_draft_retry_counterexample_reproduced',
                               'workerRecoveryAccepted':False,'engineReconstructionExecuted':False,
                               'engineMetadataProbesExecuted':True,'uploadedBytes':len(data)*2,'uploadedFiles':len(image_files),
                               'controls':len(controls),'positive':3,'broken':len(EXPECTED)*3,
                               'elapsedSeconds':round(time.monotonic()-began,3)})
        print((out/'result.json').read_text())
    finally:
        for container in containers:
            if state(container)['State']['Running'] or not (out/('container-'+container[:12]+'.json')).exists():
                stop(container)


if __name__ == '__main__':
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out',type=Path,required=True)
    run(parser.parse_args().out.absolute())
