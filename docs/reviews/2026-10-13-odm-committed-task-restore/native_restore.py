"""Observe a failed synthetic task before and after stopped-root restoration.

These two owned engines use an existing internal fixture bridge, with no public
ports, valid imagery, webhook or application connection. This cannot authorize adoption, retry, processing or publication.
"""
import argparse
import base64
import hashlib
import http.client
import ipaddress
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT/'workers/odm_worker'))
from native_engine_attestation import IMAGE

WRAPPER = ROOT/'docs/reviews/2026-10-11-odm-draft-reconciliation/native_reconciliation.py'
spec = importlib.util.spec_from_file_location('original_owned_native_wrapper', WRAPPER)
legacy = importlib.util.module_from_spec(spec);spec.loader.exec_module(legacy)


def inventory(root):
    values = {}
    for path in [root, *sorted(root.rglob('*'))]:
        info = path.lstat()
        assert info.st_uid == os.getuid() and not stat.S_IMODE(info.st_mode)&0o077, 'Owned stopped-root entries must stay private'
        if stat.S_ISDIR(info.st_mode):kind = 'directory'
        else:
            assert stat.S_ISREG(info.st_mode) and info.st_nlink == 1, 'Owned stopped-root entries must be ordinary unaliased bytes'
            kind = 'file'
        row = {'kind':kind, 'mode':stat.S_IMODE(info.st_mode)}
        if kind == 'file':row.update(bytes=info.st_size, sha256=hashlib.sha256(path.read_bytes()).hexdigest())
        values[str(path.relative_to(root))] = row
    return values


def run(out):
    os.umask(0o077);out.mkdir(mode=0o700)
    assert shutil.disk_usage(out).free > 5*1024**3
    config = out/'configuration.json';config.write_text('{"logger":{"logDirectory":"/tmp","level":"error"}}\n')
    containers = [];counter = 0
    fixture = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/odm-private-dispatch-producer-20261011/rpc-cli-09')
    database_id = (fixture/'create-private-database-private.log').read_text().strip()
    database = json.loads(subprocess.check_output(['docker','inspect',database_id],timeout=10))[0]
    assert database['Id'] == database_id and database['State']['Running'] is False
    purpose = database['Config']['Labels'].get('openplan.purpose')
    helper_spec=importlib.util.spec_from_file_location('retained_owned_rpc_profile',ROOT/'docs/reviews/2026-10-12-odm-private-dispatch-reader/native_rpc_recovery.py')
    helper=importlib.util.module_from_spec(helper_spec);helper_spec.loader.exec_module(helper)
    assert purpose == helper.PURPOSE and database['Image'] == helper.PG_IMAGE
    assert len(database['NetworkSettings']['Networks']) == 1
    network_name = next(iter(database['NetworkSettings']['Networks']))
    network_id = database['NetworkSettings']['Networks'][network_name]['NetworkID']
    network = json.loads(subprocess.check_output(['docker','network','inspect',network_id],timeout=10))[0]
    assert network['Id'] == network_id and network['Internal'] is True and network['Labels'].get('openplan.purpose') == purpose
    def save(name, value):(out/name).write_text(json.dumps(value, indent=2)+'\n')
    def execute(label, args, payload=None, timeout=35):
        result = subprocess.run(list(map(str,args)), input=payload, capture_output=True, cwd=ROOT, timeout=timeout)
        (out/(label+'-private.log')).write_bytes(result.stdout+result.stderr)
        assert result.returncode == 0, 'Owned restore probe command failed: '+label
        return result.stdout
    def inspect(container):
        value = json.loads(subprocess.check_output(['docker','inspect',container], timeout=10))[0]
        host = value['HostConfig']
        assert value['Id'] == container and value['Image'] == IMAGE and value['Config']['Labels'].get('openplan.proof') == str(out), 'Restore engine ownership differs'
        assert not host['PortBindings'] and host['ReadonlyRootfs'] is True
        assert list(value['NetworkSettings']['Networks']) == [network_name]
        assert value['NetworkSettings']['Networks'][network_name]['NetworkID'] == network_id
        assert host['Memory'] == host['MemorySwap'] == 536870912 and host['PidsLimit'] == 64 and host['NanoCpus'] == 1000000000
        return value
    def stop(container, label):
        value = inspect(container)
        if value['State']['Running']:execute(label+'-stop', ['docker','stop','--time=10',container])
        value = inspect(container);assert value['State']['Running'] is False
        save(label+'-stopped.json', {'id':container, 'running':False, 'oomKilled':value['State']['OOMKilled'], 'exitCode':value['State']['ExitCode'], 'memoryMaxBytes':value['HostConfig']['Memory'], 'memorySwapBytes':value['HostConfig']['MemorySwap']})
    def start(root, label):
        args = ['docker','create','--pull=never','--name','openplan-failed-task-'+uuid.uuid4().hex[:12],
            '--label','openplan.proof='+str(out),'--network='+network_id,'--read-only','--memory=512m','--memory-swap=512m',
            '--cpus=1','--pids-limit=64','--cap-drop=ALL','--security-opt=no-new-privileges',
            '--user',str(os.getuid())+':'+str(os.getgid()),
            '--tmpfs',f'/tmp:rw,nosuid,nodev,size=64m,mode=0700,uid={os.getuid()},gid={os.getgid()}',
            '--mount',f'type=bind,src={root}/tmp,dst=/var/www/tmp','--mount',f'type=bind,src={root}/data,dst=/var/www/data',
            '--mount',f'type=bind,src={config},dst=/proof-config.json,readonly','--entrypoint=/usr/bin/node',IMAGE,
            '-e',"process.umask(0o077);require('/var/www/index.js');",'--','native-nodeodm','--port=34100','--config=/proof-config.json']
        container = execute(label+'-create',args).decode().strip();containers.append(container)
        save(label+'-owned.json', {'id':container,'image':IMAGE,'root':str(root)})
        execute(label+'-start',['docker','start',container]);deadline = time.monotonic()+60
        while True:
            inspect(container)
            try:
                result = api(container,'/info')
                if result['status'] == 200:return container
            except (OSError, http.client.HTTPException):pass
            if time.monotonic()>=deadline:raise TimeoutError('Owned restored task readiness exceeded')
            time.sleep(.25)
    def api(container, path, method='GET', body=b'', headers=None):
        nonlocal counter
        counter += 1;value = inspect(container)
        address = value['NetworkSettings']['Networks'][network_name]['IPAddress']
        assert ipaddress.ip_address(address).version == 4 and ipaddress.ip_address(address).is_private
        connection = http.client.HTTPConnection(address,34100,timeout=5);deadline = time.monotonic()+5
        try:
            connection.request(method,path,body=body,headers=headers or {})
            response = connection.getresponse();parts=[];size=0
            while True:
                if response.fp is None:break
                remaining=deadline-time.monotonic()
                if remaining<=0:raise TimeoutError('Owned backend HTTP deadline exceeded')
                response.fp.raw._sock.settimeout(remaining)
                chunk=response.read1(65536)
                if not chunk:break
                size+=len(chunk);assert size<=1048576,'Owned backend HTTP response exceeds its byte bound'
                parts.append(chunk)
            result={'status':response.status,'body':b''.join(parts).decode('utf-8')}
            save('api-'+str(counter)+'-response.json',result)
            return result
        finally:connection.close()
    def body(field, data, filename=None):
        boundary = 'openplan-owned-restore-boundary';header = 'Content-Disposition: form-data; name="'+field+'"'
        if filename is not None:header += '; filename="'+filename+'"'
        return ('--'+boundary+'\r\n'+header+'\r\n\r\n').encode()+data+('\r\n--'+boundary+'--\r\n').encode(), 'multipart/form-data; boundary='+boundary
    try:
        source = out/'source';source.mkdir(mode=0o700)
        for name in ('tmp','data'):(source/name).mkdir(mode=0o700)
        producer = start(source,'producer');task = str(uuid.uuid4())
        raw, content_type = body('name',b'Synthetic invalid stopped-root task')
        reply = api(producer,'/task/new/init','POST',raw,{'Content-Type':content_type,'set-uuid':task})
        assert reply['status'] == 200 and json.loads(reply['body']).get('uuid') == task
        for index in range(3):
            raw, content_type = body('images',b'Invalid ordinary source bytes '+str(index).encode(),'invalid-'+str(index)+'.jpg')
            reply = api(producer,'/task/new/upload/'+task,'POST',raw,{'Content-Type':content_type})
            assert reply['status'] == 200 and json.loads(reply['body']).get('success') is True
        reply = api(producer,'/task/new/commit/'+task,'POST');assert reply['status'] == 200 and json.loads(reply['body']).get('uuid') == task
        save('original-commit-reply.json',reply)
        deadline = time.monotonic()+40
        while True:
            reply = api(producer,'/task/'+task+'/info');assert reply['status'] == 200
            current = json.loads(reply['body']);save('original-task-info.json',current)
            if current.get('status',{}).get('code') == 30:break
            assert current.get('status',{}).get('code') in (10,20), 'Synthetic invalid task must not count as successful imagery'
            if time.monotonic()>=deadline:raise TimeoutError('Synthetic invalid task did not reach a failed state')
            time.sleep(.5)
        stop(producer,'producer');before = inventory(source);save('source-inventory.json',before)
        snapshot = ROOT/'openplan/scripts/ops/worker_root_snapshot.py'
        execute('capture',[sys.executable,'-B',snapshot,'--source',source,'--destination',out/'package','--writers-quiesced','--timeout','30'])
        execute('verify',[sys.executable,'-B',snapshot,'--destination',out/'package','--verify'])
        retained = out/'package/root';assert inventory(retained) == before, 'Captured failed-task bytes differ'
        runtime = out/'runtime';shutil.copytree(retained,runtime);assert inventory(runtime) == before, 'Relocated failed-task bytes differ'
        restored = start(runtime,'restored')
        restored_list = api(restored,'/task/list');restored_info = api(restored,'/task/'+task+'/info')
        save('restored-task-list.json',restored_list);save('restored-task-info.json',restored_info)
        observed = json.loads(restored_info['body'])
        projection = ('uuid','name','imagesCount','options','status')
        restored_matches = restored_info['status'] == 200 and all(observed.get(key) == current.get(key) for key in projection)
        assert restored_matches, 'Restored failed-task API projection differs'
        stop(restored,'restored')
        assert inventory(source) == before and inventory(retained) == before, 'Restoration must not mutate original or package'
        save('results.json',{'originalTaskUuid':task,'originalFailedStatus':current['status'],'apiTaskRestored':restored_matches,
            'exactSourcePackageRelocation':True,'originalAndPackageUnchanged':True,'newEngineIdentity':producer != restored,
            'knownRootOnly':True,'decodedImageryAccepted':False,'workerRecoveryAccepted':False,'engineAdoptionAuthorized':False})
        save('source-bindings.json',{str(path.relative_to(ROOT)):hashlib.sha256(path.read_bytes()).hexdigest() for path in (Path(__file__),WRAPPER,snapshot)})
        print(json.dumps({'apiTaskRestored':restored_matches,'originalFailedStatus':current['status'],'workerRecoveryAccepted':False}))
    finally:
        for index,container in enumerate(containers):
            if inspect(container)['State']['Running']:stop(container,'finally-'+str(index))
            logs = subprocess.run(['docker','logs',container],capture_output=True,timeout=10)
            (out/('engine-'+str(index)+'-private.log')).write_bytes(logs.stdout+logs.stderr)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__);parser.add_argument('--out',type=Path,required=True)
    args = parser.parse_args();run(args.out.resolve())
