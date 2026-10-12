"""Actual local HTTP supervision; public DNS/TLS and hosted use stay separate."""
import json
import ctypes
import os
from pathlib import Path
import signal
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

import application_dispatch_http as module
from application_dispatch_http import Transport


class Checks(unittest.TestCase):
    def setUp(self):
        self.requests = [];self.arrived = threading.Event();self.body_sent = threading.Event();self.closed = threading.Event()
        self.mode = 'ordinary';self.body = b'{"synthetic":"original \\u00e9tude"}'
        fixture = self
        class Handler(BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'
            def log_message(self, *args):
                pass
            def do_POST(self):
                self.close_connection = True
                raw = self.rfile.read(int(self.headers['Content-Length']))
                fixture.requests.append((self.path, dict(self.headers), raw));fixture.arrived.set()
                if fixture.mode == 'stall-header':
                    self.connection.settimeout(3)
                    try:
                        if not self.connection.recv(1):fixture.closed.set()
                    except OSError:
                        pass
                    return
                status = 302 if fixture.mode == 'redirect' else 403 if fixture.mode == 'denied' else 200
                self.send_response(status)
                self.send_header('Content-Type', 'text/plain' if fixture.mode == 'wrong-type' else 'application/json')
                if fixture.mode == 'encoded':self.send_header('Content-Encoding', 'gzip')
                if fixture.mode == 'redirect':self.send_header('Location', '/other-service')
                length = 4097 if fixture.mode == 'oversized-stall' else len(fixture.body) + 100 if fixture.mode in ('partial', 'stall-body') else len(fixture.body)
                self.send_header('Content-Length', str(length))
                if fixture.mode == 'duplicate-length':self.send_header('Content-Length', str(length))
                self.end_headers()
                try:
                    self.wfile.write(fixture.body);self.wfile.flush()
                    fixture.body_sent.set()
                    if fixture.mode in ('stall-body', 'oversized-stall'):
                        self.connection.settimeout(3)
                        if not self.connection.recv(1):fixture.closed.set()
                    if fixture.mode == 'partial':self.close_connection = True
                except OSError as error:
                    if isinstance(error, (BrokenPipeError, ConnectionResetError)):
                        fixture.closed.set()
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True);self.thread.start()
        self.url = 'http://127.0.0.1:' + str(self.server.server_address[1])
        self.args = {'p_request': 'synthetic-original', 'p_installation': 'synthetic-installation', 'p_target': 'synthetic-target'}
        self.tokens = {'apiKey': 'synthetic-private-api-key', 'bearerToken': 'synthetic-private-service-token'}
        self.references = []
        def resolve(reference):
            self.references.append(reference);return self.tokens
        self.transport = Transport(self.url, 'synthetic-private-reference', resolve, allow_http=True, max_response_bytes=4096)

    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join(timeout=5)
        self.assertFalse(self.thread.is_alive(), 'Owned HTTP fixture must stop')

    def read(self, timeout=3):
        return self.transport(self.args, time.monotonic() + timeout)

    def child_metadata(self):
        return {'endpoint': self.url, 'allowHttp': True, 'credentials': self.tokens,
            'parameters': self.args, 'deadline': time.monotonic() + 3, 'maxResponseBytes': 4096}

    def invoke_child(self, value, *, flag='--child', oversized=False):
        lifetime_read, lifetime_write = os.pipe();process = None
        try:
            process = subprocess.Popen([sys.executable, '-B', module.__file__, flag, str(lifetime_read)],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                pass_fds=(lifetime_read,), close_fds=True)
            os.close(lifetime_read);lifetime_read = None
            if oversized:
                process.stdin.write(struct.pack('!I', module.METADATA_LIMIT + 1));process.stdin.flush()
                try:process.wait(timeout=1)
                except subprocess.TimeoutExpired:self.fail('Oversized child metadata must refuse before waiting for its body')
                return process.returncode, process.stdout.read(), process.stderr.read()
            payload = json.dumps(value).encode()
            output, error = process.communicate(struct.pack('!I', len(payload)) + payload, timeout=2)
            return process.returncode, output, error
        finally:
            if lifetime_read is not None:os.close(lifetime_read)
            os.close(lifetime_write)
            if process is not None:
                module.DraftTransport._stop(process)
                for handle in (process.stdin, process.stdout, process.stderr):
                    if handle is not None:handle.close()

    def test_child_metadata_bound_refuses_before_waiting_for_body(self):
        code, output, error = self.invoke_child(None, oversized=True)
        self.assertEqual((code, output, error), (2, b'', b'Private dispatch RPC read failed\n'))
        self.assertEqual(self.requests, [])

    def test_child_envelope_and_bound_refuse_before_network(self):
        original = self.child_metadata()
        for value in ({**original, 'extra': True}, {**original, 'maxResponseBytes': False}):
            with self.subTest(value=value['maxResponseBytes']):
                code, output, error = self.invoke_child(value)
                self.assertEqual(self.requests, [], 'Invalid child envelope or bound must precede network work')
                self.assertEqual((code, output, error), (2, b'', b'Private dispatch RPC read failed\n'))

    def test_child_invocation_refuses_before_network(self):
        code, output, error = self.invoke_child(self.child_metadata(), flag='--different')
        self.assertEqual(self.requests, [], 'Invalid child invocation must precede network work')
        self.assertEqual((code, output, error), (2, b'', b'Private dispatch RPC read failed\n'))

    def test_exact_post_headers_scope_and_response_without_proxy(self):
        with patch.dict(os.environ, {'HTTP_PROXY': 'http://127.0.0.1:1', 'HTTPS_PROXY': 'http://127.0.0.1:1'}):
            actual = self.read()
        self.assertEqual(actual, self.body, 'Private response bytes must reach the validator unchanged')
        self.assertEqual(len(self.requests), 1, 'Private read sends one request')
        path, headers, body = self.requests[0]
        self.assertEqual(path, '/rpc/read_aerial_original_dispatch', 'Private endpoint must use only its fixed RPC path')
        self.assertEqual(json.loads(body), self.args, 'Original RPC scope must reach HTTP unchanged')
        self.assertEqual(headers['apikey'], self.tokens['apiKey'], 'API key must use its dedicated header')
        self.assertEqual(headers['Authorization'], 'Bearer ' + self.tokens['bearerToken'], 'Configured service token must reach the private endpoint')
        self.assertEqual(self.references, ['synthetic-private-reference'], 'Credentials must use the operator reference')

    def test_gateway_prefix_and_secret_key_without_bearer(self):
        self.transport.url = self.url + '/rest/v1';self.tokens['bearerToken'] = None
        self.read()
        self.assertEqual(self.requests[0][0], '/rest/v1/rpc/read_aerial_original_dispatch')
        self.assertNotIn('Authorization', self.requests[0][1], 'Opaque API keys cannot become bearer tokens')

    def test_child_credentials_stay_in_pipe_and_environment_is_narrow(self):
        real = module.subprocess.Popen
        def spawn(args, **kwargs):
            self.assertTrue(all(token not in ' '.join(args) for token in self.tokens.values()), 'Private credentials cannot enter child arguments')
            self.assertNotIn('OPENPLAN_SYNTHETIC_PRIVATE_SECRET', kwargs['env'], 'Private child cannot inherit unrelated credentials')
            self.assertTrue(set(kwargs['env']) <= {'PATH', 'LANG', 'LC_ALL', 'SSL_CERT_FILE', 'SSL_CERT_DIR'})
            return real(args, **kwargs)
        with patch.dict(os.environ, {'OPENPLAN_SYNTHETIC_PRIVATE_SECRET': 'synthetic-never-forward'}), patch.object(module.subprocess, 'Popen', side_effect=spawn):
            self.assertEqual(self.read(), self.body)

    def test_constructor_refuses_unapproved_http_and_ambiguous_endpoint(self):
        values = [self.url, 'https://user:secret@example.invalid', 'https://example.invalid?state=1',
            'https://example.invalid#state', 'https://example.invalid/other', 'https://example.invalid/',
            'https://example.invalid:0', 'https://example.invalid\\other', 'https://exa%6dple.invalid', 'https://example.invalid\n']
        for value in values:
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, '^Private dispatch endpoint differs$'):
                Transport(value, 'reference', lambda ref: self.tokens)

    def test_invalid_constructor_adapters_and_byte_limits_refuse(self):
        for reference, resolve, cancelled in [('', lambda ref: self.tokens, lambda: False), ('reference', None, lambda: False), ('reference', lambda ref: self.tokens, None)]:
            with self.assertRaisesRegex(ValueError, '^Private dispatch supervision and credential adapter are required$'):
                Transport(self.url, reference, resolve, cancelled=cancelled, allow_http=True)
        for bound in (False, 0, module.RESPONSE_LIMIT + 1):
            with self.subTest(bound=bound), self.assertRaisesRegex(ValueError, '^Private dispatch response bound differs$'):
                Transport(self.url, 'reference', lambda ref: self.tokens, allow_http=True, max_response_bytes=bound)

    def test_pre_cancelled_read_never_resolves_credentials_or_spawns(self):
        self.transport.cancelled = lambda: True
        with patch.object(module.subprocess, 'Popen', side_effect=AssertionError('Cancelled read spawned child')):
            with self.assertRaisesRegex(InterruptedError, '^Private dispatch read cancelled$'):
                self.read()
        self.assertEqual(self.references, [], 'Pre-cancellation must precede credentials')

    def test_invalid_cancellation_and_deadline_refuse_before_http(self):
        for decision in (None, 1):
            self.transport.cancelled = lambda: decision
            with self.assertRaisesRegex(ValueError, '^Private dispatch cancellation must be a boolean$'):
                self.read()
        self.transport.cancelled = lambda: False
        for deadline in (True, float('nan'), float('inf')):
            with self.subTest(deadline=deadline), self.assertRaisesRegex(ValueError, '^Private dispatch deadline must be finite$'):
                self.transport(self.args, deadline)
        self.assertEqual(self.requests, [])

    def test_expired_deadline_refuses_before_credentials(self):
        with patch.object(module.subprocess, 'Popen', side_effect=AssertionError('Expired private read spawned child')):
            with self.assertRaisesRegex(TimeoutError, '^Private dispatch deadline exceeded$'):
                self.transport(self.args, time.monotonic() - 1)
        self.assertEqual(self.references, [], 'Expired deadline must precede credential resolution')

    def test_credentials_and_parameters_refuse_without_request(self):
        with patch.object(module.subprocess, 'Popen', side_effect=AssertionError('Invalid input spawned child')):
            for values in ({**self.args, 'other': 'value'}, {**self.args, 'p_target': ''}):
                with self.assertRaisesRegex(ValueError, '^Private dispatch RPC parameters differ$'):
                    self.transport(values, time.monotonic() + 3)
            for tokens in ({'apiKey': 'key'}, {**self.tokens, 'apiKey': 'key\r\nother'}, {**self.tokens, 'bearerToken': 1}):
                self.transport.resolve = lambda ref: tokens
                with self.assertRaisesRegex(ValueError, '^Private dispatch credentials differ$'):
                    self.read()
        self.assertEqual(self.requests, [])

    def test_credential_exceptions_refuse_with_static_reason(self):
        self.transport.resolve = lambda ref: (_ for _ in ()).throw(RuntimeError('synthetic-private-error'))
        with self.assertRaisesRegex(ValueError, '^Private dispatch credential resolution failed$'):
            self.read()

    def test_redirect_or_denial_refuses_without_retry(self):
        for mode in ('redirect', 'denied'):
            self.mode = mode;before = len(self.requests)
            with self.subTest(mode=mode), self.assertRaisesRegex(ValueError, '^Private dispatch RPC read did not complete$'):
                self.read()
            self.assertEqual(len(self.requests), before + 1, 'Private refusal must not retry or follow redirect')

    def test_response_encoding_type_and_ambiguous_length_refuse(self):
        for mode in ('encoded', 'wrong-type', 'duplicate-length'):
            self.mode = mode
            with self.subTest(mode=mode), self.assertRaisesRegex(ValueError, '^Private dispatch RPC read did not complete$'):
                self.read()

    def test_oversized_and_partial_response_cannot_return_original(self):
        self.transport.max_response = len(self.body) - 1
        with self.assertRaisesRegex(ValueError, '^Private dispatch RPC read did not complete$'):
            self.read()
        self.transport.max_response = 4096;self.mode = 'partial'
        with self.assertRaisesRegex(ValueError, '^Private dispatch RPC read did not complete$'):
            self.read()

    def test_declared_overflow_refuses_before_reading_a_stalled_body(self):
        self.mode = 'oversized-stall'
        with self.assertRaisesRegex(ValueError, '^Private dispatch RPC read did not complete$'):
            self.read(.7)
        self.assertTrue(self.closed.wait(2), 'Declared overflow must close the real body connection')

    def test_actual_stalled_header_deadline_closes_connection_and_joins_child(self):
        self.mode = 'stall-header';children = []
        real = module.subprocess.Popen
        def spawn(*args, **kwargs):
            value = real(*args, **kwargs);children.append(value);return value
        started = time.monotonic()
        with patch.object(module.subprocess, 'Popen', side_effect=spawn):
            with self.assertRaisesRegex(TimeoutError, '^Private dispatch deadline exceeded$'):
                self.read(.7)
        self.assertTrue(self.arrived.is_set(), 'Stalled fixture must receive the real private request')
        self.assertTrue(self.closed.wait(2), 'Deadline must close the real stalled connection')
        self.assertLess(time.monotonic() - started, 3, 'Private deadline must bound the stalled read')
        self.assertTrue(children and all(child.poll() is not None for child in children), 'Deadline must join its child')

    def test_actual_body_cancellation_closes_connection_and_joins_child(self):
        self.mode = 'stall-body';children = [];real = module.subprocess.Popen
        def spawn(*args, **kwargs):
            value = real(*args, **kwargs);children.append(value);return value
        self.transport.cancelled = self.body_sent.is_set
        with patch.object(module.subprocess, 'Popen', side_effect=spawn):
            with self.assertRaisesRegex(InterruptedError, '^Private dispatch read cancelled$'):
                self.read()
        self.assertTrue(self.closed.wait(2), 'Cancellation must close the real partial-body connection')
        self.assertTrue(children and all(child.poll() is not None for child in children), 'Cancellation must join its child')

    def test_runtime_ownership_refuses_before_credentials(self):
        for owned, message in [(None, 'Private dispatch ownership adapter is required'), (lambda: 1, 'Private dispatch ownership must be a boolean')]:
            with self.assertRaisesRegex(ValueError, '^' + message + '$'):
                self.transport(self.args, time.monotonic() + 3, owned=owned)
        with self.assertRaisesRegex(InterruptedError, '^Private dispatch runtime ownership ended$'):
            self.transport(self.args, time.monotonic() + 3, owned=lambda: False)
        self.assertEqual(self.references, [], 'Unowned read must not resolve credentials')

    def test_runtime_ownership_end_closes_actual_stalled_connection(self):
        self.mode = 'stall-body';children = [];real = module.subprocess.Popen
        def spawn(*args, **kwargs):
            value = real(*args, **kwargs);children.append(value);return value
        with patch.object(module.subprocess, 'Popen', side_effect=spawn):
            with self.assertRaisesRegex(InterruptedError, '^Private dispatch runtime ownership ended$'):
                self.transport(self.args, time.monotonic() + 3, owned=lambda: not self.body_sent.is_set())
        self.assertTrue(self.closed.wait(2), 'Runtime ownership end must close the real partial response')
        self.assertTrue(children and all(child.poll() is not None for child in children), 'Runtime ownership end must join its child')

    def test_metadata_bound_refuses_before_child_spawn(self):
        with patch.object(module, 'METADATA_LIMIT', 1), patch.object(module.subprocess, 'Popen', side_effect=AssertionError('Oversized metadata spawned child')):
            with self.assertRaisesRegex(ValueError, '^Private dispatch metadata exceeds its bound$'):
                self.read()

    def test_child_output_bounds_stop_and_join_before_return(self):
        real = module.subprocess.Popen
        for channel, count in (('stdout', 4097), ('stderr', module.ERROR_LIMIT + 1)):
            children = []
            code = "import sys,struct\nn=struct.unpack('!I',sys.stdin.buffer.read(4))[0]\nsys.stdin.buffer.read(n)\nsys." + channel + ".buffer.write(b'x'*" + str(count) + ")\nsys." + channel + ".buffer.flush()\n"
            def spawn(args, **kwargs):
                value = real([sys.executable, '-B', '-c', code], **kwargs);children.append(value);return value
            with self.subTest(channel=channel), patch.object(module.subprocess, 'Popen', side_effect=spawn):
                with self.assertRaisesRegex(ValueError, '^Private dispatch child output exceeds its bound$'):
                    self.read()
            self.assertTrue(children and all(child.poll() is not None for child in children), 'Output refusal must join its child')

    def test_stalled_resolver_cannot_start_a_late_private_request(self):
        source = Path(module.__file__).read_text()
        with tempfile.TemporaryDirectory(prefix='odm-private-rpc-resolver-') as directory:
            root = Path(directory);marker = root / 'resolver-entered';script = root / 'held-rpc.py'
            source = source.replace('from draft_http import ', 'sys.path.insert(0,' + repr(str(Path(module.__file__).parent)) + ')\nfrom draft_http import ', 1)
            anchor = '    factory = http.client.HTTPSConnection'
            inserted = "    import socket\n    original_resolver = socket.getaddrinfo\n    def held_resolver(*args, **kwargs):\n        Path(" + repr(str(marker)) + ").touch()\n        time.sleep(1.5)\n        return original_resolver(*args, **kwargs)\n    socket.getaddrinfo = held_resolver\n"
            self.assertEqual(source.count(anchor), 1)
            script.write_text(source.replace(anchor, inserted + anchor, 1))
            real = module.subprocess.Popen;children = []
            def spawn(args, **kwargs):
                args = list(args);args[2] = str(script)
                value = real(args, **kwargs);children.append(value);return value
            with patch.object(module.subprocess, 'Popen', side_effect=spawn):
                with self.assertRaisesRegex(TimeoutError, '^Private dispatch deadline exceeded$'):
                    self.read(.7)
            self.assertTrue(marker.exists(), 'Resolver probe must reach the actual child resolver')
            self.assertTrue(children and all(child.poll() is not None for child in children), 'Resolver deadline must join its child')
            time.sleep(1.6)
            self.assertEqual(self.requests, [], 'Abandoned resolver cannot send a late private request')

    def test_parent_exit_stops_and_reaps_private_rpc_child(self):
        libc = ctypes.CDLL(None, use_errno=True);previous = ctypes.c_int()
        self.assertEqual(libc.prctl(37, ctypes.byref(previous), 0, 0, 0), 0)
        self.assertEqual(libc.prctl(36, 1, 0, 0, 0), 0)
        self.mode = 'stall-header';owner = None;record = None;reaped = False
        def identity(pid):
            path = Path('/proc') / str(pid) / 'stat'
            return path.read_text().rsplit(')', 1)[1].split()[19] if path.exists() else None
        with tempfile.TemporaryDirectory(prefix='odm-private-rpc-owner-') as directory:
            root = Path(directory);marker = root / 'child.json';exit_flag = root / 'exit-owner';script = root / 'owner.py'
            code = "import sys,os,json,subprocess,threading,time\nfrom pathlib import Path\nsys.path.insert(0," + repr(str(Path(module.__file__).parent)) + ")\nimport application_dispatch_http as module\noriginal=subprocess.Popen\ndef observed(*args,**kwargs):\n child=original(*args,**kwargs)\n start=Path('/proc')/str(child.pid)/'stat'\n value={'pid':child.pid,'start':start.read_text().rsplit(')',1)[1].split()[19]}\n path=Path(" + repr(str(marker)) + ");pending=path.with_suffix('.pending')\n pending.write_text(json.dumps(value));pending.rename(path)\n return child\nmodule.subprocess.Popen=observed\ndef leave():\n while not Path(" + repr(str(exit_flag)) + ").exists():time.sleep(.01)\n os._exit(19)\nthreading.Thread(target=leave,daemon=True).start()\nmodule.Transport(" + repr(self.url) + ",'reference',lambda ref:" + repr(self.tokens) + ",allow_http=True)(" + repr(self.args) + ",time.monotonic()+5)\n"
            script.write_text(code)
            try:
                owner = subprocess.Popen([sys.executable, '-B', str(script)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                self.assertTrue(self.arrived.wait(3), 'Owner-loss probe must reach a real private request')
                record = json.loads(marker.read_text());exit_flag.touch()
                self.assertEqual(owner.wait(timeout=3), 19, 'Selected owner must exit abruptly')
                deadline = time.monotonic() + 2
                while time.monotonic() < deadline:
                    pid, _status = os.waitpid(record['pid'], os.WNOHANG)
                    if pid == record['pid']:
                        reaped = True;break
                    time.sleep(.01)
                self.assertTrue(reaped, 'Owner exit must stop the private RPC child')
                self.assertTrue(self.closed.wait(2), 'Owner exit must close the real private connection')
                self.assertEqual(len(self.requests), 1, 'Orphaned private read cannot retry')
            finally:
                if owner is not None:
                    if owner.poll() is None:owner.kill()
                    owner.wait(timeout=5)
                    for handle in (owner.stdout, owner.stderr):handle.close()
                if record is None and marker.exists():record = json.loads(marker.read_text())
                if record is not None and not reaped:
                    if identity(record['pid']) == record['start']:os.kill(record['pid'], signal.SIGKILL)
                    try:os.waitpid(record['pid'], 0)
                    except ChildProcessError:pass
                self.assertEqual(libc.prctl(36, previous.value, 0, 0, 0), 0)


if __name__ == '__main__':
    unittest.main()
