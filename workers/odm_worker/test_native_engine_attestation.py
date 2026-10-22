"""Native observation guards and actual supervised Unix-socket responses.

The fixture is not Docker and proves no engine behavior. Separate native evidence
must bind the actual daemon, mounted configuration and original service.
"""
import copy
import http.server
import io
import json
import os
from pathlib import Path
import socketserver
import signal
import sys
import subprocess
import struct
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import native_engine_attestation as native

DATA = b'{"logger":{"logDirectory":"/tmp","level":"error"}}\n'
CONTAINER = 'a' * 64
NETWORK = 'b' * 64



def fixture(root):
    config = root / 'config.json';config.write_bytes(DATA)
    container = {'Id': CONTAINER, 'Image': native.IMAGE,
        'Config': {'Entrypoint': ['/usr/bin/node'], 'Cmd': native.PROFILE + ['--port=34100', '--config=/proof-config.json'],
            'Env': ['PATH=/usr/bin', 'PRIVATE_FIXTURE=confidential_fixture_marker']},
        'HostConfig': {'ReadonlyRootfs': True, 'Privileged': False, 'CapAdd': None, 'Devices': [],
            'PidMode': '', 'PortBindings': {}, 'PublishAllPorts': False},
        'Mounts': [{'Type': 'bind', 'Destination': name, 'Source': str(config if name == '/proof-config.json' else root / name.rsplit('/', 1)[1]),
            'RW': name != '/proof-config.json'} for name in ['/var/www/tmp', '/var/www/data', '/proof-config.json']],
        'State': {'Running': True, 'Paused': False, 'Restarting': False, 'Dead': False, 'Status': 'running', 'Pid': 123},
        'NetworkSettings': {'Networks': {'private': {'NetworkID': NETWORK, 'EndpointID': 'original-endpoint', 'IPAddress': '172.30.17.2'}}}}
    network = {'Id': NETWORK, 'Driver': 'bridge', 'Internal': True,
        'Containers': {CONTAINER: {'EndpointID': 'original-endpoint', 'IPv4Address': '172.30.17.2/29'}}}
    digest, _port = native.inspect_projection(container, DATA)
    engine = {'instanceId': CONTAINER, 'endpoint': 'http://172.30.17.2:34100', 'api': 'nodeodm-2.2.4-draft',
        'version': '2.2.4', 'imageId': native.IMAGE, 'configurationSha256': digest, 'credentialReference': 'fixture-native-no-token'}
    return engine, container, network


class Daemon(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True

    def __init__(self, path, engine, container, network):
        self.engine = engine;self.container = container;self.network = network
        self.requests = [];self.inspect_started = threading.Event();self.release = threading.Event()
        self.stall = False;self.raw_container = None;self.status = 200
        outer = self
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_GET(self):
                outer.requests.append((self.command, self.path))
                if self.path == '/v1.51/containers/' + CONTAINER + '/json':
                    outer.inspect_started.set()
                    if outer.stall:
                        outer.release.wait(8)
                    body = outer.raw_container if outer.raw_container is not None else json.dumps(outer.container).encode()
                elif self.path == '/v1.51/networks/' + NETWORK:
                    body = json.dumps(outer.network).encode()
                else:
                    try:
                        self.send_response(404);self.send_header('Content-Length', '0');self.end_headers()
                    except (BrokenPipeError, ConnectionResetError):
                        pass
                    return
                try:
                    self.send_response(outer.status);self.send_header('Content-Length', str(len(body)));self.end_headers();self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    pass
        super().__init__(str(path), Handler)
        self.thread = threading.Thread(target=self.serve_forever, kwargs={'poll_interval': .02})
        self.thread.start()

    def close(self):
        self.release.set();self.shutdown();self.server_close();self.thread.join(2)
        if self.thread.is_alive():
            raise AssertionError('Owned Unix-socket fixture did not stop')


class NativeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='odm-native-observation-');self.root = Path(self.temp.name)
        self.engine, self.container, self.network = fixture(self.root)
        self.daemon = None
        self.proc = self.root / 'proc';process = self.proc / '123';(process / 'root').mkdir(parents=True)
        (process / 'stat').write_bytes(b'123 (fixture) S ' + b'0 ' * 18 + b'456 0\n')
        self.mounted = process / 'root/proof-config.json';self.mounted.write_bytes(DATA)
        self.observer = self.root / 'process-observer.py'
        self.observer.write_text('import sys\nsys.path.insert(0,' + repr(str(Path(native.__file__).parent)) + ')\nimport native_engine_attestation as n\nread=n.process_configuration\nn.process_configuration=lambda c:read(c,proc_root=' + repr(str(self.proc)) + ')\ntry:\n n.child(int(sys.argv[2]))\nexcept Exception:\n print("Native engine observation refused",file=sys.stderr)\n sys.exit(1)\n')

    def tearDown(self):
        if self.daemon is not None:
            self.daemon.close()
        self.temp.cleanup()

    def refuse(self, action, label, errors=(ValueError,)):
        try:
            action()
        except errors:
            return
        self.fail(label)

    def start(self):
        self.path = self.root / 'daemon.sock'
        self.daemon = Daemon(self.path, self.engine, self.container, self.network)
        observer = str(self.observer);original_source = native.__file__
        class FixtureAttestor(native.Attestor):
            def __call__(self, *args, **kwargs):
                with patch.object(native, '__file__', observer if native.__file__ == original_source else native.__file__):
                    return super().__call__(*args, **kwargs)
        return FixtureAttestor(self.engine, str(self.path), os.geteuid())

    def test_valid_identity_and_exact_configuration(self):
        digest, port = native.inspect_projection(self.container, DATA)
        value = native.observed_identity(self.engine, self.container, self.network, digest, port)
        self.assertTrue(value['running'], 'Original native observation must be running')
        self.assertEqual(value['engine'], self.engine, 'Original native observation identity differs')
        changed, _port = native.inspect_projection(self.container, DATA.replace(b'\n', b' '))
        self.assertNotEqual(digest, changed, 'Exact mounted configuration spelling must affect its hash')

    def test_launch_refusals(self):
        changes = [('Image', 'sha256:' + '0' * 64), ('Config.Entrypoint', ['other']), ('Config.Cmd', []),
            ('Config.Env', ['NODE_OPTIONS=--require=other']), ('HostConfig.ReadonlyRootfs', False), ('HostConfig.Privileged', True),
            ('HostConfig.CapAdd', ['ALL']), ('HostConfig.Devices', [{}]), ('HostConfig.PidMode', 'host'),
            ('HostConfig.PortBindings', {'3000/tcp': [{}]}), ('HostConfig.PublishAllPorts', True),
            ('Mounts', []), ('Mounts', self.container['Mounts'] + [self.container['Mounts'][0]])]
        for field, replacement in changes:
            value = copy.deepcopy(self.container);keys = field.split('.');target = value
            for key in keys[:-1]:
                target = target[key]
            target[keys[-1]] = replacement
            with self.subTest(field=field):
                self.refuse(lambda: native.inspect_projection(value, DATA), 'Native launch guard: ' + field)
        for field, replacement in [('Type', 'volume'), ('RW', False), ('Destination', '/var/www'), ('Source', 'relative')]:
            value = copy.deepcopy(self.container);value['Mounts'][0][field] = replacement
            self.refuse(lambda: native.inspect_projection(value, DATA), 'Native mount guard: ' + field)
        self.refuse(lambda: native.inspect_projection(self.container, b'{"token":"unassessed"}'), 'Unsupported native configuration must refuse')

    def test_identity_and_state_refusals(self):
        cases = [('Id', 'c' * 64), ('Image', 'sha256:' + 'd' * 64), ('State.Running', False), ('State.Paused', True),
            ('State.Restarting', True), ('State.Dead', True), ('State.Status', 'exited'), ('State.Pid', 0), ('State.Pid', True)]
        for field, replacement in cases:
            value = copy.deepcopy(self.container);keys = field.split('.');target = value
            for key in keys[:-1]:
                target = target[key]
            target[keys[-1]] = replacement
            self.refuse(lambda: native.observed_identity(self.engine, value, self.network, self.engine['configurationSha256'], 34100), 'Native identity guard: ' + field)
        self.refuse(lambda: native.observed_identity(self.engine, self.container, self.network, '0' * 64, 34100), 'Native original configuration digest must match')

    def test_network_and_endpoint_refusals(self):
        for field, value in [('Id', 'c' * 64), ('Driver', 'host'), ('Internal', False), ('Containers', {})]:
            network = copy.deepcopy(self.network);network[field] = value
            self.refuse(lambda: native.observed_identity(self.engine, self.container, network, self.engine['configurationSha256'], 34100), 'Native network guard: ' + field)
        for field, value in [('EndpointID', 'other'), ('IPv4Address', '172.30.17.3/29')]:
            network = copy.deepcopy(self.network);network['Containers'][CONTAINER][field] = value
            self.refuse(lambda: native.observed_identity(self.engine, self.container, network, self.engine['configurationSha256'], 34100), 'Native member guard: ' + field)
        for endpoint in ['http://localhost:34100', 'http://172.30.17.3:34100', 'http://172.30.17.2:3000', 'https://172.30.17.2:34100', 'http://172.30.17.2:34100/other']:
            engine = {**self.engine, 'endpoint': endpoint}
            self.refuse(lambda: native.observed_identity(engine, self.container, self.network, self.engine['configurationSha256'], 34100), 'Native endpoint must bind to its actual container')

    def test_json_refusals(self):
        for raw in [b'', '{}', b'{"a":1,"a":2}', b'{"a":NaN}', b'{}' + b' ' * native.INSPECTION_LIMIT]:
            self.refuse(lambda: native.checked_json(raw, native.INSPECTION_LIMIT), 'Native JSON bound, uniqueness and finite values must refuse')

    def test_supervised_three_read_only_requests(self):
        attestor = self.start()
        self.assertIs(attestor(self.engine, time.monotonic() + 5, owned=lambda: True), True, 'Actual supervised observation must return true')
        self.assertEqual(self.daemon.requests, [('GET', '/v1.51/containers/' + CONTAINER + '/json'),
            ('GET', '/v1.51/networks/' + NETWORK),
            ('GET', '/v1.51/containers/' + CONTAINER + '/json')], 'Only exact original read-only native observations are allowed')

    def test_mounted_bytes_are_not_host_path_bytes(self):
        attestor = self.start();self.mounted.write_bytes(DATA + b' ')
        self.assertEqual((self.root / 'config.json').read_bytes(), DATA)
        self.refuse(lambda: attestor(self.engine, time.monotonic() + 5, owned=lambda: True), 'Mounted bytes cannot be replaced by host path bytes')

    def test_pre_refusals_never_start_an_observer(self):
        attestor = self.start()
        real = native.subprocess.Popen
        for deadline, owner in [(None, lambda: True), (time.monotonic() - 1, lambda: True), (float('nan'), lambda: True),
            (time.monotonic() + 5, lambda: False), (time.monotonic() + 5, lambda: 1)]:
            with patch.object(native.subprocess, 'Popen', wraps=real) as opened:
                self.refuse(lambda: attestor(self.engine, deadline, owned=owner), 'Pre-refused observation must reject', (ValueError, TimeoutError, InterruptedError))
                self.assertEqual(opened.call_count, 0, 'Pre-refused observation cannot start a child')
        self.assertEqual(self.daemon.requests, [], 'Pre-refused observation cannot query its daemon')
        with patch.object(native.subprocess, 'Popen', wraps=real) as opened:
            self.refuse(lambda: attestor({**self.engine, 'credentialReference': 'other'}, time.monotonic() + 5, owned=lambda: True),
                'Changed configured original cannot attest')
            self.assertEqual(opened.call_count, 0, 'Changed configured original cannot start an observer')

    def test_stalled_observation_keeps_actual_deadline(self):
        attestor = self.start();self.daemon.stall = True;began = time.monotonic()
        try:
            attestor(self.engine, began + .6, owned=lambda: True)
        except (TimeoutError, ValueError, InterruptedError) as refused:
            self.assertIsInstance(refused, TimeoutError, 'Native observation must report its actual deadline')
        else:
            self.fail('Stalled observer must raise its actual deadline')
        self.assertLess(time.monotonic() - began, 1.5, 'Native observation must not extend its shared deadline')

    def test_owner_ends_during_observation(self):
        attestor = self.start();self.daemon.stall = True
        try:
            attestor(self.engine, time.monotonic() + 5, owned=lambda: not self.daemon.inspect_started.is_set())
        except (TimeoutError, ValueError, InterruptedError) as refused:
            self.assertIsInstance(refused, InterruptedError, 'Native owner must interrupt its observation')
        else:
            self.fail('Ended native owner cannot finish observation')

    def test_peer_uid_requires_actual_unix_credentials(self):
        self.start();connection = native.UnixConnection(str(self.path), os.geteuid() + 1, time.monotonic() + 5)
        try:
            self.refuse(connection.connect, 'Native daemon peer cannot differ')
        finally:
            connection.close()

    def test_daemon_bytes_and_diagnostics_refuse(self):
        attestor = self.start()
        for data in [b'{"Id":"duplicate","Id":"other"}', b'x' * (native.INSPECTION_LIMIT + 1),
            json.dumps(self.container).encode() + b' ' * native.INSPECTION_LIMIT]:
            self.daemon.raw_container = data
            self.refuse(lambda: attestor(self.engine, time.monotonic() + 5, owned=lambda: True), 'Malformed native daemon bytes must refuse')
        self.daemon.raw_container = None;self.daemon.status = 503
        self.refuse(lambda: attestor(self.engine, time.monotonic() + 5, owned=lambda: True), 'Unavailable native daemon cannot attest')

    def test_explicit_constructor_and_launch_port(self):
        for engine, path, uid in [(self.engine, 'relative', 0), (self.engine, '/tmp/native.sock', True),
            ({**self.engine, 'instanceId': 'short'}, '/tmp/native.sock', 0),
            ({**self.engine, 'imageId': 'sha256:' + '0' * 64}, '/tmp/native.sock', 0)]:
            self.refuse(lambda: native.Attestor(engine, path, uid), 'Native constructor must retain its explicit original')
        for value in ['--port=0', '--port=65536', '--port=other']:
            container = copy.deepcopy(self.container);container['Config']['Cmd'][4] = value
            self.refuse(lambda: native.inspect_projection(container, DATA), 'Native launch port must remain valid')

    def test_child_frame_bound_precedes_body_read(self):
        read, write = os.pipe();process = None
        try:
            process = subprocess.Popen([sys.executable, '-B', native.__file__, '--child', str(read)],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, pass_fds=(read,))
            os.close(read);read = None
            process.stdin.write(struct.pack('!I', native.WIRE_LIMIT + 1));process.stdin.flush()
            try:
                code = process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.fail('Oversized native observer frame must refuse before body')
            self.assertEqual(code, 1, 'Oversized native observer frame must refuse')
        finally:
            os.close(write)
            if read is not None:
                os.close(read)
            if process is not None:
                native.DraftTransport._stop(process)
                for handle in (process.stdin, process.stdout, process.stderr):
                    handle.close()

    def test_parent_receipt_and_output_bounds(self):
        attestor = self.start();fake = self.root / 'observer.py'
        valid = {'format': 'openplan.odm-native-observation.v1', 'engine': self.engine,
            'configurationSha256': self.engine['configurationSha256'], 'networkId': NETWORK, 'running': True}
        cases = []
        for field, value in [('format', 'other'), ('engine', {**self.engine, 'credentialReference': 'other'}),
            ('configurationSha256', '0' * 64), ('networkId', 'short'), ('running', False), ('extra', True)]:
            record = {**valid, field: value};cases.append((json.dumps(record).encode(), b''))
        cases.extend([(b'x' * (native.WIRE_LIMIT + 1), b''), (b'', b'x' * (native.WIRE_LIMIT + 1)),
            (json.dumps(valid).encode(), b'confidential_fixture_marker')])
        for output, error in cases:
            fake.write_text('import sys\nsys.stdin.buffer.read()\nsys.stdout.buffer.write(' + repr(output) + ')\nsys.stderr.buffer.write(' + repr(error) + ')\n')
            with patch.object(native, '__file__', str(fake)):
                try:
                    attestor(self.engine, time.monotonic() + 5, owned=lambda: True)
                except ValueError as refused:
                    self.assertNotIn('confidential_fixture_marker', str(refused), 'Native observer diagnostics must stay private')
                else:
                    self.fail('Malformed native observer receipt must refuse')

    def test_owner_and_deadline_rechecked_after_receipt(self):
        attestor = self.start();parsed = [False];read_json = native.checked_json;check_time = native.finite_deadline
        def observe(raw, limit):
            result = read_json(raw, limit);parsed[0] = True;return result
        with patch.object(native, 'checked_json', side_effect=observe):
            self.refuse(lambda: attestor(self.engine, time.monotonic() + 5, owned=lambda: not parsed[0]),
                'Native owner must be checked after the completed receipt', (InterruptedError,))
        parsed[0] = False
        def deadline(value):
            if parsed[0]:
                raise TimeoutError('Fixture deadline expires after the receipt')
            check_time(value)
        with patch.object(native, 'checked_json', side_effect=observe), patch.object(native, 'finite_deadline', side_effect=deadline):
            self.refuse(lambda: attestor(self.engine, time.monotonic() + 5, owned=lambda: True),
                'Native deadline must be checked after the completed receipt', (TimeoutError,))

    def test_mount_enumeration_order_does_not_change_identity(self):
        container = copy.deepcopy(self.container);container['Mounts'].reverse()
        digest, port = native.inspect_projection(container, DATA)
        self.assertEqual(digest, self.engine['configurationSha256'], 'Mount enumeration order cannot change native launch identity')
        self.assertEqual(port, 34100)

    def test_original_launch_metadata_affects_fingerprint(self):
        original = self.engine['configurationSha256']
        for field in ['Config', 'HostConfig', 'Mounts']:
            value = copy.deepcopy(self.container)
            if field == 'Config':
                value[field]['Labels'] = {'original': 'other'}
            elif field == 'HostConfig':
                value[field]['Memory'] = 268435456
            else:
                value[field][0]['Source'] += '-other'
            digest, _port = native.inspect_projection(value, DATA)
            self.assertNotEqual(original, digest, 'Original native launch metadata must affect its fingerprint: ' + field)

    def test_parent_buffers_stay_bounded(self):
        attestor = self.start();fake = self.root / 'oversized.py'
        real_buffer = bytearray;peaks = []
        class Buffer(real_buffer):
            def extend(self, data):
                super().extend(data);peaks.append(len(self))
        for output, error in [(b'x' * 10000, b''), (b'', b'x' * 10000)]:
            fake.write_text('import sys\nsys.stdin.buffer.read()\nsys.stdout.buffer.write(' + repr(output) + ')\nsys.stderr.buffer.write(' + repr(error) + ')\n')
            with patch.object(native, '__file__', str(fake)), patch.object(native, 'bytearray', Buffer, create=True):
                self.refuse(lambda: attestor(self.engine, time.monotonic() + 5, owned=lambda: True), 'Oversized observer output must refuse')
            self.assertLessEqual(max(peaks, default=0), native.WIRE_LIMIT, 'Native observer buffer may not exceed its bound')

    def test_child_input_shape_refuses_before_daemon(self):
        self.start();read, write = os.pipe()
        try:
            payload = native.encoded({'engine': self.engine, 'socketPath': str(self.path), 'daemonUid': os.geteuid(),
                'deadline': time.monotonic() + 5, 'foreign': True}).encode()
            result = subprocess.run([sys.executable, '-B', native.__file__, '--child', str(read)],
                input=struct.pack('!I', len(payload)) + payload, capture_output=True, pass_fds=(read,), timeout=2)
            self.assertEqual(result.returncode, 1, 'Foreign native input shape must refuse')
            self.assertEqual(self.daemon.requests, [], 'Foreign native input cannot query the daemon')
        finally:
            os.close(read);os.close(write)

    def diagnostic(self, action, message):
        try:
            action()
        except Exception as error:
            self.assertIsInstance(error, ValueError, 'Required native refusal: ' + message)
            self.assertEqual(str(error), message, 'Required native refusal: ' + message)
        else:
            self.fail('Required native refusal: ' + message)

    def test_structural_projection_refusals(self):
        for field, replacement, reason in [
            ('Config', None, 'Native engine launch inspection differs'),
            ('Mounts', [], 'Native engine original mounts are required')]:
            container = copy.deepcopy(self.container);container[field] = replacement
            self.diagnostic(lambda: native.inspect_projection(container, DATA), reason)
        container = copy.deepcopy(self.container);container['Mounts'][0]['Destination'] = '/other'
        self.diagnostic(lambda: native.inspect_projection(container, DATA), 'Native engine mount scope differs')
        container = copy.deepcopy(self.container);container['NetworkSettings']['Networks'] = {}
        self.diagnostic(lambda: native.observed_identity(self.engine, container, self.network, self.engine['configurationSha256'], 34100),
            'Native engine original network differs')
        container = copy.deepcopy(self.container);container['NetworkSettings']['Networks']['private']['IPAddress'] = 'invalid'
        self.diagnostic(lambda: native.observed_identity(self.engine, container, self.network, self.engine['configurationSha256'], 34100),
            'Native engine original address differs')

    def test_socket_scope_before_daemon_access(self):
        self.start();process_reader = native.process_configuration;payload = native.encoded({'engine': self.engine, 'socketPath': str(self.path),
            'daemonUid': os.geteuid(), 'deadline': time.monotonic() + 5}).encode()
        reader = io.BytesIO(struct.pack('!I', len(payload)) + payload)
        actual = native.os.lstat(self.path)
        from types import SimpleNamespace
        with patch.object(native, 'exact_input', side_effect=reader.read), patch.object(native, 'watch_parent', lambda fd: None), patch.object(native, 'process_configuration', side_effect=lambda c: process_reader(c, proc_root=self.proc)),             patch.object(native.os, 'lstat', return_value=SimpleNamespace(st_mode=actual.st_mode, st_uid=actual.st_uid + 1)),             patch.object(native.sys, 'stdout', SimpleNamespace(buffer=io.BytesIO())):
            self.diagnostic(lambda: native.child(-1), 'Native engine daemon socket differs')
        self.assertEqual(self.daemon.requests, [], 'Wrong native socket scope cannot reach daemon reads')

    def test_daemon_shape_and_status_refusals(self):
        self.start();deadline = time.monotonic() + 5
        self.daemon.raw_container = b'[]'
        self.diagnostic(lambda: native.daemon_get(str(self.path), os.geteuid(), deadline, 'containers/' + CONTAINER + '/json'),
            'Native engine daemon response shape differs')
        self.daemon.raw_container = None;self.daemon.status = 503
        self.diagnostic(lambda: native.daemon_bytes(str(self.path), os.geteuid(), deadline, 'containers/' + CONTAINER + '/json', native.INSPECTION_LIMIT),
            'Native engine daemon observation is unavailable')

    def test_parent_metadata_bound_precedes_spawn(self):
        engine = {**self.engine, 'credentialReference': 'x' * native.WIRE_LIMIT}
        attestor = native.Attestor(engine, '/tmp/native.sock', os.geteuid());real = native.subprocess.Popen
        with patch.object(native.subprocess, 'Popen', wraps=real) as opened:
            self.refuse(lambda: attestor(engine, time.monotonic() + 5, owned=lambda: True), 'Oversized native metadata must refuse')
            self.assertEqual(opened.call_count, 0, 'Oversized native metadata cannot start an observer')

    def test_ownership_callback_refusal_types(self):
        self.diagnostic(lambda: native.Attestor._check(time.monotonic() + 5, 1), 'Native engine ownership callback is required')
        self.diagnostic(lambda: native.Attestor._check(time.monotonic() + 5, lambda: 1), 'Native engine ownership must return a boolean')

    def test_process_configuration_and_refusals(self):
        data, identity = native.process_configuration(self.container, proc_root=self.proc)
        self.assertEqual(data, DATA, 'Kernel configuration must retain exact bytes')
        self.assertEqual(identity, (123, 456), 'Kernel process identity must retain original start time')
        for value in [False, 0, True, '123']:
            container = copy.deepcopy(self.container);container['State']['Pid'] = value
            self.diagnostic(lambda: native.process_configuration(container, proc_root=self.proc), 'Native engine process is unavailable')
        for data in [b'', b'x' * (native.CONFIGURATION_LIMIT + 1)]:
            self.mounted.write_bytes(data)
            self.diagnostic(lambda: native.process_configuration(self.container, proc_root=self.proc), 'Native engine process configuration is not bounded regular bytes')
        self.mounted.unlink();self.mounted.symlink_to(self.root / 'config.json')
        with self.assertRaises(OSError, msg='Kernel configuration cannot follow a substituted leaf'):
            native.process_configuration(self.container, proc_root=self.proc)

    def test_process_identity_and_changed_read_refusals(self):
        for data in [b'', b'garbage', b'124 (other) S ' + b'0 ' * 18 + b'456 0',
            b'123 (dead) Z ' + b'0 ' * 18 + b'456 0', b'123 (fixture) S ' + b'0 ' * 19, b'123 (fixture) S ' + b'0 ' * 18 + b'456' + b' ' * native.WIRE_LIMIT]:
            self.diagnostic(lambda: native.process_identity(data, 123), 'Native engine process identity differs')
        read = native.os.read
        with patch.object(native.os, 'read', side_effect=lambda fd, size: b'' if size == 8192 else read(fd, size)):
            self.diagnostic(lambda: native.process_configuration(self.container, proc_root=self.proc), 'Native engine process configuration changed while reading')
        actual_stat = native.os.fstat;count = [0]
        from types import SimpleNamespace
        def changed(fd):
            value = actual_stat(fd);count[0] += 1
            if count[0] == 2:
                return SimpleNamespace(st_dev=value.st_dev, st_ino=value.st_ino, st_size=value.st_size,
                    st_mtime_ns=value.st_mtime_ns, st_ctime_ns=value.st_ctime_ns + 1)
            return value
        with patch.object(native.os, 'fstat', side_effect=changed):
            self.diagnostic(lambda: native.process_configuration(self.container, proc_root=self.proc), 'Native engine process configuration changed while reading')
        with patch.object(native, 'process_identity', side_effect=[(123, 456), (123, 457)]):
            self.diagnostic(lambda: native.process_configuration(self.container, proc_root=self.proc), 'Native engine process configuration changed while reading')

    def test_process_and_configuration_rechecked(self):
        attestor = self.start()
        def altered_observer(kind):
            wrapper = self.observer.read_text()
            replacement = "read=n.process_configuration\ncount=[0]\ndef observe(c):\n count[0]+=1\n data,identity=read(c,proc_root=" + repr(str(self.proc)) + ")\n if count[0]==2: return (data+b' ' if " + repr(kind) + "=='bytes' else data), (identity[0],identity[1]+1) if " + repr(kind) + "=='process' else identity\n return data,identity\nn.process_configuration=observe"
            start = wrapper.index('read=n.process_configuration');end = wrapper.index('\ntry:', start)
            return wrapper[:start] + replacement + wrapper[end:]
        saved = self.observer.read_text()
        try:
            for kind in ('process', 'bytes'):
                self.observer.write_text(altered_observer(kind))
                self.refuse(lambda: attestor(self.engine, time.monotonic() + 5, owned=lambda: True), 'Changed native process or configuration must refuse')
                self.observer.write_text(saved)
        finally:
            self.observer.write_text(saved)

    def test_child_network_shape_and_id_before_lookup(self):
        self.start();process_reader = native.process_configuration
        connection = native.UnixConnection(str(self.path), os.geteuid(), time.monotonic() + 5)
        try:
            connection.request('GET', '/v1.51/unsupported-fixture')
            response = connection.getresponse()
            self.assertEqual(response.status, 404)
            self.assertEqual(response.read(), b'', 'Unknown daemon path must return a bodyless refusal')
        finally:
            connection.close()
        for networks, reason in [({}, 'Native engine original network differs'),
            ({'private': {'NetworkID': 'invalid'}}, 'Native engine original network ID differs')]:
            self.daemon.container = copy.deepcopy(self.container)
            self.daemon.container['NetworkSettings']['Networks'] = networks
            payload = native.encoded({'engine': self.engine, 'socketPath': str(self.path),
                'daemonUid': os.geteuid(), 'deadline': time.monotonic() + 5}).encode()
            reader = io.BytesIO(struct.pack('!I', len(payload)) + payload)
            with patch.object(native, 'exact_input', side_effect=reader.read), patch.object(native, 'watch_parent', lambda fd: None), patch.object(native, 'process_configuration', side_effect=lambda c: process_reader(c, proc_root=self.proc)):
                self.diagnostic(lambda: native.child(-1), reason)
        self.assertFalse(any('/networks/' in path for method, path in self.daemon.requests), 'Invalid native network ID cannot reach network lookup')

    def test_failed_observer_exit_and_stderr_refuse(self):
        attestor = self.start();fake = self.root / 'failed.py'
        valid = {'format': 'openplan.odm-native-observation.v1', 'engine': self.engine,
            'configurationSha256': self.engine['configurationSha256'], 'networkId': NETWORK, 'running': True}
        for stderr, status in [(b'', 1), (b'confidential_fixture_marker', 0)]:
            fake.write_text('import sys\nsys.stdin.buffer.read()\nsys.stdout.buffer.write(' + repr(json.dumps(valid).encode()) + ')\nsys.stderr.buffer.write(' + repr(stderr) + ')\nsys.exit(' + str(status) + ')\n')
            with patch.object(native, '__file__', str(fake)):
                self.diagnostic(lambda: attestor(self.engine, time.monotonic() + 5, owned=lambda: True), 'Native engine observation refused')

    def test_observer_ends_when_parent_exits(self):
        self.start();self.daemon.stall = True;pidfile = self.root / 'observer-identity.json';script = self.root / 'parent.py'
        def identity(pid):
            try:
                fields = Path('/proc/' + str(pid) + '/stat').read_text().rpartition(') ')[2].split()
                return fields[19], fields[0]
            except (FileNotFoundError, ProcessLookupError):
                return None
        def cleanup(pid, start):
            current = identity(pid)
            if current is not None and current[0] == start and current[1] != 'Z':
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        status = '123 (fixture) S ' + '0 ' * 18 + '456 0\n'
        with patch.object(Path, 'read_text', return_value=status), patch.object(os, 'kill', side_effect=ProcessLookupError('Controlled observer exits before cleanup')):
            try:
                cleanup(123, '456')
            except ProcessLookupError:
                raise AssertionError('Retired observer must not fail cleanup') from None
        with patch.object(Path, 'read_text', return_value=status), patch.object(os, 'kill', side_effect=PermissionError('Controlled cleanup permission refusal')):
            with self.assertRaises(PermissionError, msg='Observer cleanup must retain permission refusal'):
                cleanup(123, '456')
        with patch.object(Path, 'read_text', side_effect=ProcessLookupError('Controlled process exits during stat read')):
            try:
                retired = identity(123)
            except ProcessLookupError:
                raise AssertionError('Exited observer lookup must count as retired') from None
            self.assertIsNone(retired, 'Exited observer lookup must count as retired')
        with patch.object(Path, 'read_text', side_effect=PermissionError('Controlled proc permission refusal')):
            with self.assertRaises(PermissionError, msg='Unavailable observer lookup must retain its permission refusal'):
                identity(123)
        script.write_text('import sys,json,time\nfrom pathlib import Path\nsys.path.insert(0,' + repr(str(Path(native.__file__).parent)) + ')\nimport native_engine_attestation as n\nn.__file__=' + repr(str(self.observer)) + '\nreal=n.subprocess.Popen\ndef start(*a,**k):\n p=real(*a,**k)\n fields=Path("/proc/"+str(p.pid)+"/stat").read_text().rpartition(") ")[2].split()\n Path(' + repr(str(pidfile)) + ').write_text(json.dumps({"pid":p.pid,"start":fields[19]}))\n return p\nn.subprocess.Popen=start\nn.Attestor(' + repr(self.engine) + ',' + repr(str(self.path)) + ',' + str(os.geteuid()) + ')(' + repr(self.engine) + ',time.monotonic()+15,owned=lambda:True)\n')
        parent = subprocess.Popen([sys.executable, '-B', str(script)], stdout=subprocess.PIPE, stderr=subprocess.PIPE);saved = None
        try:
            self.assertTrue(self.daemon.inspect_started.wait(3), 'Owned observer must reach its stalled fixture')
            saved = json.loads(pidfile.read_text());self.assertEqual(identity(saved['pid'])[0], saved['start'])
            parent.kill();parent.wait(timeout=2);deadline = time.monotonic() + 2
            while time.monotonic() < deadline:
                current = identity(saved['pid'])
                if current is None or current[0] != saved['start'] or current[1] == 'Z':
                    break
                time.sleep(.01)
            else:
                self.fail('Native observer must end with its parent lifetime')
        finally:
            native.DraftTransport._stop(parent);parent.stdout.close();parent.stderr.close()
            if saved is not None:
                cleanup(saved['pid'], saved['start'])


if __name__ == '__main__':
    unittest.main()
