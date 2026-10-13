"""Probe the pinned API's commit receipt with deliberately invalid image bytes.

This owns one network-none capped engine. It tests the reply shape, not imagery
decoding, reconstruction quality, current application authority or worker recovery.
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

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT/'workers/odm_worker'))
import engine_effects
import native_engine_attestation as native

OLD = ROOT/'docs/reviews/2026-10-11-odm-draft-reconciliation/native_reconciliation.py'
spec = importlib.util.spec_from_file_location('pinned_native_api_wrapper', OLD)
legacy = importlib.util.module_from_spec(spec);spec.loader.exec_module(legacy)
PORT = 34100


def run(out):
    os.umask(0o077);out.mkdir(mode=0o700)
    assert shutil.disk_usage(out).free > 5*1024**3
    for name in ('tmp', 'data'):(out/name).mkdir(mode=0o700)
    configuration = out/'configuration.json'
    configuration.write_text('{"logger":{"logDirectory":"/tmp","level":"error"}}\n')
    source_paths = [Path(__file__), OLD, ROOT/'workers/odm_worker/engine_effects.py']
    source = {str(path.relative_to(ROOT)):hashlib.sha256(path.read_bytes()).hexdigest() for path in source_paths}
    def save(name, value):(out/name).write_text(json.dumps(value, indent=2)+'\n')
    def command(label, args, payload=None):
        result = subprocess.run(args, input=payload, capture_output=True, timeout=30, cwd=ROOT)
        (out/(label+'-private.log')).write_bytes(result.stdout+result.stderr)
        assert result.returncode == 0, 'Owned commit probe command failed: '+label
        return result.stdout
    container = None;counter = 0
    def inspect():
        value = json.loads(subprocess.check_output(['docker', 'inspect', container], timeout=10))[0]
        host = value['HostConfig']
        assert value['Id'] == container and value['Image'] == native.IMAGE
        assert value['Config']['Labels'].get('openplan.proof') == str(out)
        assert host['NetworkMode'] == 'none' and not host['PortBindings']
        assert host['Memory'] == host['MemorySwap'] == 536870912 and host['ReadonlyRootfs'] is True
        assert host['PidsLimit'] == 64 and host['NanoCpus'] == 1000000000
        return value
    def api(path, method='GET', body=b'', content_type=None):
        nonlocal counter
        counter += 1
        request = {'path':path, 'method':method, 'body':base64.b64encode(body).decode(),
            'headers':{} if content_type is None else {'Content-Type':content_type}}
        inspect()
        raw = command('api-'+str(counter), ['docker', 'exec', '-i', container, '/usr/bin/node', '-e', legacy.CLIENT], json.dumps(request).encode())
        return legacy.json_response(raw)
    def multipart(field, body, filename=None):
        boundary = 'openplan-owned-commit-boundary'
        header = 'Content-Disposition: form-data; name="'+field+'"'
        if filename is not None:header += '; filename="'+filename+'"'
        raw = ('--'+boundary+'\r\n'+header+'\r\n\r\n').encode()+body+('\r\n--'+boundary+'--\r\n').encode()
        return raw, 'multipart/form-data; boundary='+boundary
    try:
        args = ['docker', 'create', '--pull=never', '--name', 'openplan-commit-reply-'+uuid.uuid4().hex[:12],
            '--label', 'openplan.proof='+str(out), '--network=none', '--read-only',
            '--memory=512m', '--memory-swap=512m', '--cpus=1', '--pids-limit=64', '--cap-drop=ALL',
            '--security-opt=no-new-privileges', '--user', str(os.getuid())+':'+str(os.getgid()),
            '--tmpfs', f'/tmp:rw,nosuid,nodev,size=64m,mode=0700,uid={os.getuid()},gid={os.getgid()}',
            '--mount', f'type=bind,src={out}/tmp,dst=/var/www/tmp',
            '--mount', f'type=bind,src={out}/data,dst=/var/www/data',
            '--mount', f'type=bind,src={configuration},dst=/proof-config.json,readonly',
            '--entrypoint=/usr/bin/node', native.IMAGE, *native.PROFILE,
            '--port='+str(PORT), '--config=/proof-config.json']
        container = command('create', args).decode().strip()
        save('owned-engine.json', {'id':container, 'image':native.IMAGE})
        command('start', ['docker', 'start', container]);deadline = time.monotonic()+60
        while True:
            inspect()
            result = subprocess.run(['docker', 'exec', container, '/usr/bin/node', '-e',
                "require('http').get('http://127.0.0.1:34100/info',r=>{r.resume();r.on('end',()=>process.exit(r.statusCode===200?0:1))}).on('error',()=>process.exit(1));"], capture_output=True, timeout=10)
            if result.returncode == 0:break
            if time.monotonic() >= deadline:raise TimeoutError('Owned commit engine readiness exceeded')
            time.sleep(.25)
        info = api('/info');assert info['status'] == 200
        assert json.loads(info['body'])['version'] == '2.2.4', 'Commit probe must retain the pinned API version'
        task = str(uuid.uuid4())
        boundary = 'openplan-owned-init-boundary'
        raw = ('--'+boundary+'\r\nContent-Disposition: form-data; name="name"\r\n\r\nSynthetic invalid receipt probe\r\n--'+boundary+'--\r\n').encode()
        request = {'path':'/task/new/init', 'method':'POST', 'body':base64.b64encode(raw).decode(),
            'headers':{'Content-Type':'multipart/form-data; boundary='+boundary, 'set-uuid':task}}
        reply = legacy.json_response(command('init', ['docker', 'exec', '-i', container, '/usr/bin/node', '-e', legacy.CLIENT], json.dumps(request).encode()))
        assert reply['status'] == 200 and json.loads(reply['body']).get('uuid') == task, 'Original init UUID must be accepted'
        for index in range(3):
            raw, content_type = multipart('images', b'Intentionally invalid ordinary image bytes '+str(index).encode(), 'invalid-'+str(index)+'.jpg')
            reply = api('/task/new/upload/'+task, 'POST', raw, content_type)
            assert reply['status'] == 200 and json.loads(reply['body']).get('success') is True
        reply = api('/task/new/commit/'+task, 'POST');body = reply['body'].encode()
        save('commit-reply.json', reply)
        parsed = json.loads(body)
        assert reply['status'] == 200 and parsed.get('uuid') == task and 'error' not in parsed, 'Native commit must return its original UUID'
        try:engine_effects.parsed_reply({'taskUuid':task}, 'commit', reply['status'], body)
        except ValueError as error:
            assert str(error) == 'Engine reply does not establish original command acknowledgment'
            accepted = False
        else:accepted = True
        status = api('/task/'+task+'/info')
        save('task-info.json', status)
        save('results.json', {'apiVersion':'2.2.4', 'sameOriginalUuid':True, 'commitStatus':reply['status'],
            'commitReplySha256':hashlib.sha256(body).hexdigest(), 'commitReplyKeys':sorted(parsed),
            'workerParserAcceptsActualReply':accepted, 'suppliedFiles':3, 'decodedImageryAccepted':False,
            'reconstructionQualityAccepted':False, 'workerRecoveryAccepted':False})
        for path, digest in source.items():assert hashlib.sha256((ROOT/path).read_bytes()).hexdigest() == digest
        save('source-bindings.json', source)
        print(json.dumps({'sameOriginalUuid':True, 'workerParserAcceptsActualReply':accepted, 'commitReplyKeys':sorted(parsed)}))
    finally:
        if container is not None:
            value = inspect()
            if value['State']['Running']:command('stop', ['docker', 'stop', '--time=10', container])
            value = inspect();assert value['State']['Running'] is False
            save('stopped.json', {'running':False, 'oomKilled':value['State']['OOMKilled'],
                'memoryMaxBytes':value['HostConfig']['Memory'], 'memorySwapBytes':value['HostConfig']['MemorySwap']})
            logs = subprocess.run(['docker', 'logs', container], capture_output=True, timeout=10)
            (out/'engine-private.log').write_bytes(logs.stdout+logs.stderr)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__);parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args();run(args.out.resolve())
