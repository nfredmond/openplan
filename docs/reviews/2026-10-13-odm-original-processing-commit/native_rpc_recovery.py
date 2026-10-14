"""Compose the retained private RPC fixture with one real owned draft engine.

The owned original commit processes invalid ordinary bytes solely to produce a failed task. The existing
RPC lifecycle retains responsibility for its role/function restoration and stop.
"""
import argparse
import hashlib
import http.client
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
import native_engine_attestation as native
from engine_effects import commands

DATA = b'{"logger":{"logDirectory":"/tmp","level":"error"}}\n'
PORT = 34100
ENGINE_ENV = 'OPENPLAN_NATIVE_COMPOSITION_ENGINE'
def run(fixture, out, socket_path, daemon_uid):
    os.umask(0o077);out.mkdir(mode=0o700)
    assert shutil.disk_usage(out).free > 5*1024**3
    helper_path = ROOT/'docs/reviews/2026-10-12-odm-private-dispatch-reader/native_rpc_recovery.py'
    spec = importlib.util.spec_from_file_location('owned_rpc_lifecycle', helper_path)
    helper = importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    helper.CLIENT = Path(__file__).with_name('native_client.py')
    sources = [helper_path, helper.CLIENT, Path(__file__), *[ROOT/'workers/odm_worker'/name for name in
        ('native_engine_attestation.py', 'application_draft_authority.py', 'application_dispatch_reader.py',
         'draft_http.py', 'runtime_dispatch_custody.py', 'runtime_url_draft.py', 'admission_journal.py',
         'runtime_observation.py', 'original_task_http.py', 'retained_task_observation.py',
         'application_processing_authority.py', 'original_commit_http.py', 'runtime_commit.py')]]
    bindings = {str(path.relative_to(ROOT)):hashlib.sha256(path.read_bytes()).hexdigest() for path in sources}
    def save(name, value):
        (out/name).write_text(json.dumps(value, indent=2)+'\n')
    def docker(label, args):
        result = subprocess.run(['docker', '--host', 'unix://'+socket_path, *args], capture_output=True, timeout=40)
        (out/(label+'-private.log')).write_bytes(result.stdout+result.stderr)
        assert result.returncode == 0, 'Owned native composition command failed: '+label
        return result.stdout.decode().strip()
    def daemon(resource):return native.daemon_get(socket_path, daemon_uid, time.monotonic()+5, resource)
    pg = (fixture/'create-private-database-private.log').read_text().strip()
    original_pg = daemon('containers/'+pg+'/json')
    assert original_pg['Id'] == pg and original_pg['Image'] == helper.PG_IMAGE
    assert original_pg['Config']['Labels'].get('openplan.purpose') == helper.PURPOSE and original_pg['State']['Running'] is False
    network_name = next(iter(original_pg['NetworkSettings']['Networks']))
    network_id = original_pg['NetworkSettings']['Networks'][network_name]['NetworkID']
    network = daemon('networks/'+network_id)
    assert network['Id'] == network_id and network['Internal'] is True and network['Labels'].get('openplan.purpose') == helper.PURPOSE
    config = out/'config.json';config.write_bytes(DATA)
    for name in ('tmp', 'data'):(out/name).mkdir(mode=0o700)
    container = None;prior_environment = os.environ.get(ENGINE_ENV)
    def state():
        value = daemon('containers/'+container+'/json')
        if value['Id'] != container or value['Config']['Labels'].get('openplan.proof') != str(out):
            raise ValueError('Native composition container ownership differs')
        return value
    def request(path):
        value = state();attached = value['NetworkSettings']['Networks'][network_name]
        connection = http.client.HTTPConnection(attached['IPAddress'], PORT, timeout=2)
        try:
            connection.request('GET', path);response = connection.getresponse();body = response.read(1024*1024+1)
            assert response.status == 200 and len(body) <= 1024*1024
            return json.loads(body)
        finally:connection.close()
    def ready():
        deadline = time.monotonic()+90
        while time.monotonic() < deadline:
            try:
                if request('/info').get('version') == '2.2.4':return state()
            except (OSError, ValueError, AssertionError):time.sleep(.25)
        raise TimeoutError('Owned native composition readiness exceeded')
    def restart(label, payload):
        replacement = out/(label+'-replacement.json');replacement.write_bytes(payload);os.replace(replacement, config)
        state();docker(label+'-restart', ['restart', '--time=10', container]);ready()
    try:
        args = ['create', '--pull=never', '--name', 'openplan-odm-composition-'+uuid.uuid4().hex[:12],
            '--label', 'openplan.proof='+str(out), '--network='+network_id, '--read-only',
            '--memory=512m', '--memory-swap=512m', '--cpus=1', '--pids-limit=64', '--cap-drop=ALL',
            '--security-opt=no-new-privileges', '--user', str(os.getuid())+':'+str(os.getgid()),
            '--tmpfs', f'/tmp:rw,nosuid,nodev,size=64m,mode=0700,uid={os.getuid()},gid={os.getgid()}',
            '--mount', f'type=bind,src={out}/tmp,dst=/var/www/tmp', '--mount', f'type=bind,src={out}/data,dst=/var/www/data',
            '--mount', f'type=bind,src={config},dst=/proof-config.json,readonly', '--entrypoint=/usr/bin/node',
            native.IMAGE, *native.PROFILE, '--port='+str(PORT), '--config=/proof-config.json']
        container = docker('create-engine', args);save('owned-engine.json', {'id': container, 'image': native.IMAGE, 'proof': str(out)})
        docker('start-engine', ['start', container]);initial = ready()
        mounted, _process = native.process_configuration(initial);digest, port = native.inspect_projection(initial, mounted)
        address = initial['NetworkSettings']['Networks'][network_name]['IPAddress']
        engine = {'instanceId': container, 'endpoint': 'http://'+address+':'+str(port), 'api': 'nodeodm-2.2.4-draft',
            'version': '2.2.4', 'imageId': native.IMAGE, 'configurationSha256': digest, 'credentialReference': 'owned-native-composition-no-token'}
        native.Attestor(engine, socket_path, daemon_uid)(engine, time.monotonic()+5, owned=lambda: True)
        private = out/'native-engine-private.json';private.write_text(json.dumps({'engine': engine, 'socketPath': socket_path, 'daemonUid': daemon_uid}))
        os.environ[ENGINE_ENV] = str(private)
        def after_restore(phase, root):
            try:
                restart('changed-profile', DATA.replace(b'\n', b' '))
                phase('native-changed-engine-refused', 'engine-refused', root)
            finally:
                restart('restored-profile', DATA)
            phase('native-restored-engine-authority', 'engine-authority-restored', root)
            phase('bound-runtime-original-processing-commit', 'runtime-commit-observe', root.parent/'relocated-runtime')
        helper.run(fixture, out/'rpc', after_restore=after_restore)
        rows = json.loads((out/'rpc/controls.json').read_text());by_name = {row['control']: row for row in rows}
        observed = by_name['bound-runtime-original-processing-commit']
        assert observed['actualRuntimeTaskRead'] is True and observed['applicationReads'] == 3, 'Native runtime must use three current application reads'
        assert observed['nativeEngineChecks'] == 2 and observed['taskGets'] == 1, 'Native runtime must use one original task GET and two engine checks'
        assert observed['reportedState'] == 'failed' and observed['reportedImageCount'] == 2, 'Native invalid inputs must remain reported failure'
        assert observed['noPermissionPromotion'] is True and observed['localCopiedReplyExact'] is True, 'Native runtime cannot promote permissions or lose copied metadata'
        assert observed['actualOriginalCommit'] is True and observed['commitApplicationReads'] == 2 and observed['commitEngineChecks'] == 3 and observed['commitPosts'] == 1 and observed['commitReplayExact'] is True, 'Native commit must use exact original authority and one supervised POST'
        save('results.json', {'actualOriginalCommit':True, 'commitApplicationReads':2, 'commitEngineChecks':3, 'commitPosts':1, 'commitReplayExact':True, 'actualRuntimeObservation': True, 'rpcCases':len(rows), 'applicationReads':3,
            'nativeEngineChecks':2, 'taskGets':1, 'reportedState':'failed', 'reportedImageCount':2,
            'bodySha256':observed['bodySha256'], 'localCopiedReplyExact':True,
            'applicationPermissionChecked':True, 'processingQualityAccepted':False,
            'workerRecoveryAccepted':False, 'defaultActivated':False})
        for name, digest in bindings.items():assert hashlib.sha256((ROOT/name).read_bytes()).hexdigest() == digest, name
        save('source-bindings.json', bindings)
        if os.environ.get('OPENPLAN_OWNED_PROOF_UNIT'):
            raw = subprocess.check_output(['systemctl', '--user', 'show', os.environ['OPENPLAN_OWNED_PROOF_UNIT'],
                '-p', 'ControlGroup', '-p', 'MemoryMax', '-p', 'MemorySwapMax', '-p', 'MemoryPeak'], text=True)
            props = dict(line.split('=', 1) for line in raw.splitlines())
            group = Path('/sys/fs/cgroup')/props.pop('ControlGroup').lstrip('/')
            props['memoryEvents'] = dict(line.split() for line in (group/'memory.events').read_text().splitlines())
            save('resources.json', props)
        print(json.dumps({'rpcCases':len(rows),'actualRuntimeObservation':True,'applicationReads':3,'taskGets':1}))
    finally:
        if prior_environment is None:os.environ.pop(ENGINE_ENV, None)
        else:os.environ[ENGINE_ENV] = prior_environment
        if container is not None:
            current = state()
            if current['State']['Running']:docker('stop-engine', ['stop', '--time=10', container])
            final = state();assert final['State']['Running'] is False
            save('stopped.json', {'running': final['State']['Running'], 'oomKilled': final['State']['OOMKilled'],
                'memoryMaxBytes': final['HostConfig']['Memory'], 'memorySwapBytes': final['HostConfig']['MemorySwap'], 'publishedPorts': final['HostConfig']['PortBindings']})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture', type=Path, required=True);parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--socket', required=True);parser.add_argument('--daemon-uid', type=int, required=True)
    args = parser.parse_args();run(args.fixture.resolve(), args.out.resolve(), args.socket, args.daemon_uid)
