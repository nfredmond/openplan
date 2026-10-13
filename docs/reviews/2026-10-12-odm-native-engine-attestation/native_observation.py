"""Observe a fresh owned cached NodeODM container through the actual daemon.

No image pull, public port, task initialization, upload, processing or callback
runs. Retain and stop fixtures; never restart an older proof container.
"""
import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'workers/odm_worker'))
import native_engine_attestation as native

DATA = b'{"logger":{"logDirectory":"/tmp","level":"error"}}\n'
PORT = 34100
EXPECTED = {
    'daemonObserved': True, 'originalAttested': True, 'harmlessOwnerAttested': True, 'repeatOriginalAttested': True,
    'wrongOriginalRefused': True, 'wrongConfigurationRefused': True, 'wrongEndpointRefused': True,
    'stoppedOriginalRefused': True, 'sameOriginalRestartAttested': True,
    'hostReplacementDiffers': True, 'mountedOriginalBytesRetained': True,
    'hostReplacementDoesNotChangeAttestation': True, 'remountedChangedBytesRefused': True,
    'restoredMountedOriginalAttested': True, 'preCancelledRefused': True,
    'expiredDeadlineRefused': True, 'engineTaskListEmpty': True,
    'containerStopped': True, 'networkOwnedAndInternal': True, 'noPublishedPorts': True,
    'noContainerOOM': True, 'sourceBindingsUnchanged': True,
}


def verify(values):
    for key, expected in EXPECTED.items():
        if key not in values or type(values[key]) is not type(expected) or values[key] != expected:
            raise ValueError('native-observation-' + key)


def oracle_controls(values):
    rows = []
    for label, value in [('baseline', values), ('harmless-note', {**values, 'note': 'Harmless native observation note'}), ('restored', dict(values))]:
        verify(value);rows.append({'control': label, 'outcome': 'survived'})
    for key in EXPECTED:
        for kind, value in [('changed', {**values, key: False}), ('missing', {name:item for name,item in values.items() if name != key}),
            ('wrong-type', {**values, key: 1})]:
            try:
                verify(value)
            except ValueError as error:
                if str(error) != 'native-observation-' + key:
                    raise
                rows.append({'control': key + '-' + kind, 'outcome': 'intended_refusal'})
            else:
                raise AssertionError('Broken native observation classifier survived')
    return rows


def run(out, socket_path, daemon_uid, subnet):
    os.umask(0o077);out.mkdir(mode=0o700)
    if not Path(socket_path).is_absolute() or not stat.S_ISSOCK(os.lstat(socket_path).st_mode) or os.lstat(socket_path).st_uid != daemon_uid:
        raise ValueError('Explicit native daemon socket is required')
    sources = [Path(__file__), ROOT/'workers/odm_worker/native_engine_attestation.py', ROOT/'workers/odm_worker/draft_http.py',
        ROOT/'workers/odm_worker/engine_effects.py']
    hashes = {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sources}
    def save(name, value):
        with (out/name).open('x') as stream:
            json.dump(value, stream, indent=2);stream.write('\n');stream.flush();os.fsync(stream.fileno())
    def command(name, arguments, timeout=30):
        if arguments[0] == 'docker':
            arguments = ['docker', '--host', 'unix://' + socket_path, *arguments[1:]]
        result = subprocess.run(arguments, cwd=ROOT, capture_output=True, timeout=timeout)
        (out/(name+'-private.stdout')).write_bytes(result.stdout);(out/(name+'-private.stderr')).write_bytes(result.stderr)
        if result.returncode:
            raise RuntimeError('Owned native fixture command failed: ' + name)
        return result.stdout.decode().strip()
    def daemon(resource):
        return native.daemon_get(socket_path, daemon_uid, time.monotonic() + 5, resource)
    network_name = 'openplan-odm-observation-' + uuid.uuid4().hex[:12]
    container = None;network_id = None;values = {};observations = []
    def state():
        value = daemon('containers/' + container + '/json')
        if value['Id'] != container or value['Config']['Labels'].get('openplan.proof') != str(out):
            raise ValueError('Refusing an unowned native container')
        return value
    def owned_network():
        value = daemon('networks/' + network_id)
        if value['Id'] != network_id or value['Labels'].get('openplan.proof') != str(out) or value['Internal'] is not True:
            raise ValueError('Refusing an unowned native network')
        return value
    def stop(label):
        if state()['State']['Running']:
            command('stop-'+label, ['docker', 'stop', '--time=10', container], timeout=20)
        return state()
    def start(label):
        state();command('start-'+label, ['docker', 'start', container])
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            value = state();attached = next(iter(value['NetworkSettings']['Networks'].values()))
            connection = http.client.HTTPConnection(attached['IPAddress'], PORT, timeout=.5)
            try:
                connection.request('GET', '/task/list');response = connection.getresponse();body = response.read(4097)
                if response.status == 200 and body == b'[]':
                    return value
            except (OSError, http.client.HTTPException):
                pass
            finally:
                connection.close()
            time.sleep(.1)
        raise TimeoutError('Owned native engine readiness deadline')
    def call(label, attestor, engine, deadline=None, owner=lambda: True, refuse=False):
        deadline = time.monotonic() + 5 if deadline is None else deadline;began = time.monotonic()
        try:
            result = attestor(engine, deadline, owned=owner)
        except (ValueError, TimeoutError, InterruptedError) as error:
            if not refuse:
                inspected = state();save(label+'-refused-container-private.json', inspected)
                mounted, _process = native.process_configuration(inspected)
                digest, port = native.inspect_projection(inspected, mounted)
                try:
                    native.observed_identity(engine, inspected, owned_network(), digest, port)
                except ValueError as diagnostic:
                    save(label+'-refused-diagnostic.json', {'message': str(diagnostic), 'configurationMatches': digest == engine['configurationSha256'], 'mountedBytesSha256': hashlib.sha256(mounted).hexdigest(), 'expectedBytesSha256': hashlib.sha256(DATA).hexdigest()})
                else:
                    save(label+'-refused-diagnostic.json', {'message': 'Direct readback matches; supervised refusal needs further investigation'})
                raise
            observations.append({'case': label, 'outcome': 'refused', 'errorType': type(error).__name__, 'elapsedSeconds': time.monotonic()-began})
            return True
        if refuse or result is not True:
            raise AssertionError('Native observation differs: ' + label)
        observations.append({'case': label, 'outcome': 'attested', 'elapsedSeconds': time.monotonic()-began})
        return True
    config = out/'config.json';config.write_bytes(DATA)
    for name in ('tmp', 'data'):
        (out/name).mkdir(mode=0o700)
    try:
        info = daemon('version');values['daemonObserved'] = isinstance(info.get('ApiVersion'), str)
        network_id = command('create-network', ['docker', 'network', 'create', '--driver=bridge', '--internal',
            '--label', 'openplan.proof='+str(out), '--subnet='+subnet, network_name])
        owned_network();save('owned-network.json', {'id': network_id, 'name': network_name, 'proof': str(out)})
        args = ['docker', 'create', '--pull=never', '--name', network_name+'-engine', '--label', 'openplan.proof='+str(out),
            '--network='+network_id, '--read-only', '--memory=512m', '--memory-swap=512m', '--cpus=1', '--pids-limit=64',
            '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user', str(os.getuid())+':'+str(os.getgid()),
            '--tmpfs', f'/tmp:rw,nosuid,nodev,size=64m,mode=0700,uid={os.getuid()},gid={os.getgid()}',
            '--mount', f'type=bind,src={out}/tmp,dst=/var/www/tmp', '--mount', f'type=bind,src={out}/data,dst=/var/www/data',
            '--mount', f'type=bind,src={config},dst=/proof-config.json,readonly', '--entrypoint=/usr/bin/node', native.IMAGE,
            *native.PROFILE, '--port='+str(PORT), '--config=/proof-config.json']
        container = command('create-container', args);save('owned-container.json', {'id': container, 'image': native.IMAGE, 'proof': str(out)})
        inspected = start('original');save('initial-container-private.json', inspected)
        mounted, _process = native.process_configuration(inspected)
        kernel = Path('/proc/'+str(inspected['State']['Pid'])+'/root/proof-config.json').read_bytes()
        save('kernel-initial.json', {'sha256': hashlib.sha256(kernel).hexdigest(), 'matchesOriginal': kernel == DATA})
        digest, port = native.inspect_projection(inspected, mounted)
        address = next(iter(inspected['NetworkSettings']['Networks'].values()))['IPAddress']
        engine = {'instanceId': container, 'endpoint': 'http://'+address+':'+str(port), 'api': 'nodeodm-2.2.4-draft', 'version': '2.2.4',
            'imageId': native.IMAGE, 'configurationSha256': digest, 'credentialReference': 'owned-native-no-token'}
        save('original-engine-private.json', engine)
        adapter = native.Attestor(engine, socket_path, daemon_uid)
        values['originalAttested'] = call('original', adapter, engine)
        values['repeatOriginalAttested'] = all(call('repeat-original-'+str(index), adapter, engine) for index in range(5))
        values['harmlessOwnerAttested'] = call('harmless-owner', adapter, engine, owner=lambda: bool(True))
        values['wrongOriginalRefused'] = call('wrong-original', adapter, {**engine, 'instanceId': '0'*64}, refuse=True)
        changed = {**engine, 'configurationSha256': '0'*64}
        values['wrongConfigurationRefused'] = call('wrong-configuration', native.Attestor(changed, socket_path, daemon_uid), changed, refuse=True)
        changed = {**engine, 'endpoint': 'http://127.0.0.1:'+str(PORT)}
        values['wrongEndpointRefused'] = call('wrong-endpoint', native.Attestor(changed, socket_path, daemon_uid), changed, refuse=True)
        values['preCancelledRefused'] = call('pre-cancelled', adapter, engine, owner=lambda: False, refuse=True)
        values['expiredDeadlineRefused'] = call('expired', adapter, engine, deadline=time.monotonic()-1, refuse=True)
        stop('original')
        values['stoppedOriginalRefused'] = call('stopped-original', adapter, engine, refuse=True)
        start('same-original')
        values['sameOriginalRestartAttested'] = call('same-original-restart', adapter, engine)
        replacement = out/'replacement.json';replacement.write_bytes(DATA.replace(b'\n', b' '));os.replace(replacement, config)
        values['hostReplacementDiffers'] = config.read_bytes() != DATA
        mounted, _process = native.process_configuration(state())
        values['mountedOriginalBytesRetained'] = mounted == DATA
        current = state();kernel = Path('/proc/'+str(current['State']['Pid'])+'/root/proof-config.json').read_bytes()
        save('kernel-after-replacement.json', {'sha256': hashlib.sha256(kernel).hexdigest(), 'matchesOriginal': kernel == DATA, 'matchesHostPath': kernel == config.read_bytes()})
        values['hostReplacementDoesNotChangeAttestation'] = call('host-path-replaced', adapter, engine)
        stop('before-remount');start('changed-remount')
        values['remountedChangedBytesRefused'] = call('remounted-changed-bytes', adapter, engine, refuse=True)
        stop('changed-remount');config.write_bytes(DATA);start('restored-original')
        values['restoredMountedOriginalAttested'] = call('restored-mounted-original', adapter, engine)
        final = state();connection = http.client.HTTPConnection(address, PORT, timeout=3)
        try:
            connection.request('GET', '/task/list');response = connection.getresponse()
            values['engineTaskListEmpty'] = response.status == 200 and response.read(4097) == b'[]'
        finally:
            connection.close()
        final = stop('final');values['containerStopped'] = final['State']['Running'] is False
        values['networkOwnedAndInternal'] = owned_network()['Internal'] is True
        values['noPublishedPorts'] = final['HostConfig']['PortBindings'] == {} and final['HostConfig']['PublishAllPorts'] is False
        values['noContainerOOM'] = final['State']['OOMKilled'] is False
        values['sourceBindingsUnchanged'] = all(hashlib.sha256(path.read_bytes()).hexdigest() == hashes[str(path.relative_to(ROOT))] for path in sources)
        save('observations.json', observations);save('results.json', values);verify(values)
        save('oracle-controls.json', oracle_controls(values));save('source-bindings.json', hashes)
        save('stopped.json', {'running': final['State']['Running'], 'exitCode': final['State']['ExitCode'],
            'oomKilled': final['State']['OOMKilled'], 'memoryMaxBytes': final['HostConfig']['Memory'],
            'memorySwapBytes': final['HostConfig']['MemorySwap'], 'publishedPorts': final['HostConfig']['PortBindings']})
        print(json.dumps({'observations': len(observations), 'results': len(values), 'oracleControls': len(oracle_controls(values))}))
    finally:
        if container is not None:
            final = stop('cleanup');save('cleanup-stopped.json', {'running': final['State']['Running'], 'oomKilled': final['State']['OOMKilled']})
        if network_id is not None:
            owned_network()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True);parser.add_argument('--socket', required=True);parser.add_argument('--daemon-uid', type=int, required=True);parser.add_argument('--subnet', required=True)
    args = parser.parse_args();run(args.out.resolve(), args.socket, args.daemon_uid, args.subnet)
