"""Actual loopback task reads, exact private records and interruption refusals."""
import base64
import ctypes
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import copy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import select
import socket
import threading
import time
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import original_task_http as module
from retained_task_observation import Observations
from retained_source import json_bytes
import test_task_observation as fixtures


class Checks(unittest.TestCase):
    def setUp(self):
        fixtures.Checks.setUp(self)
        self.requests = []
        self.entered, self.closed, self.release = threading.Event(), threading.Event(), threading.Event()
        self.mode = 'ordinary'
        self.status = 200
        self.token = 'synthetic token & query'
        self.children = []
        fixture = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass
            def do_GET(self):
                fixture.requests.append({'path': self.path, 'headers': dict(self.headers)})
                fixture.entered.set()
                if fixture.mode == 'held':
                    readable, _, _ = select.select([self.connection], [], [], 2)
                    if readable:
                        try:
                            closed = self.connection.recv(1) == b''
                        except ConnectionResetError:
                            closed = True
                        if closed:
                            fixture.closed.set()
                    fixture.release.wait(timeout=2)
                body = json.dumps(fixture.value, indent=2).encode() + b'\n'
                if fixture.mode == 'large':
                    body = b'x' * (module.RESPONSE_LIMIT + 1)
                try:
                    self.send_response(fixture.status)
                    if fixture.status == 302:
                        self.send_header('Location', '/redirect-must-not-be-read')
                    if fixture.mode != 'close_delimited':
                        self.send_header('Content-Length', str(len(body) + (17 if fixture.mode == 'short' else 0)))
                    if fixture.mode == 'encoded':
                        self.send_header('Content-Encoding', 'gzip')
                    if fixture.mode in ('short', 'close_delimited'):
                        self.send_header('Connection', 'close')
                    self.end_headers()
                    if fixture.mode == 'large':
                        readable, _, _ = select.select([self.connection], [], [], 2)
                        if readable:
                            try:
                                closed = self.connection.recv(1) == b''
                            except ConnectionResetError:
                                closed = True
                            if closed:
                                fixture.closed.set()
                        fixture.release.wait(timeout=2)
                    self.wfile.write(body)
                    self.wfile.flush()
                    self.close_connection = True
                except (BrokenPipeError, ConnectionResetError):
                    pass
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=lambda: self.server.serve_forever(poll_interval=.02), daemon=True)
        self.thread.start()
        self.plan['engine']['endpoint'] = 'http://127.0.0.1:' + str(self.server.server_address[1])
        (self.fixture.root / 'plan.json').write_bytes(json_bytes(self.plan))
        self.records = self.fixture.base / 'observations'
        self.records.mkdir(mode=0o700)
        self.attestations = []

    def tearDown(self):
        self.release.set()
        for child in self.children:
            if child.poll() is None:
                child.kill()
            child.wait(timeout=5)
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)
        fixtures.Checks.tearDown(self)

    def attest(self, engine, deadline):
        self.assertEqual(engine, self.plan['engine'])
        self.assertGreater(deadline, time.monotonic())
        self.attestations.append(engine)
        return True

    def transport(self, **kwargs):
        def resolve(reference):
            self.assertEqual(reference, self.plan['engine']['credentialReference'], 'Credentials must use original reference')
            return self.token
        return module.Transport(self.plan, resolve, kwargs.pop('attest', self.attest), **kwargs)

    def read(self, transport=None, **kwargs):
        return (transport or self.transport())(self.plan, time.monotonic() + 1.5, owned=kwargs.pop('owned', lambda: True), **kwargs)

    def test_exact_original_get_and_credentials(self):
        status, body = self.read()
        self.assertEqual(status, 200)
        self.assertEqual(body, json.dumps(self.value, indent=2).encode() + b'\n', 'Exact original reply must survive transport')
        self.assertEqual(len(self.requests), 1, 'One GET must actually arrive')
        request = self.requests[0]
        self.assertEqual(urlsplit(request['path']).path, '/task/' + self.plan['taskUuid'] + '/info', 'Read must use original UUID')
        self.assertEqual(parse_qs(urlsplit(request['path']).query), {'token': [self.token]}, 'Credential must be encoded once')
        self.assertEqual(len(self.attestations), 2, 'Original engine must be checked before and after read')
        self.assertEqual(request['headers']['Accept-Encoding'], 'identity')

    def test_retain_and_reopen_exact_reply(self):
        store = Observations(self.fixture.root, self.plan, records_root=self.records)
        result = self.transport().retain(store, deadline=time.monotonic() + 1.5, owned=lambda: True)
        self.assertEqual(base64.b64decode(result['bodyBase64']), json.dumps(self.value, indent=2).encode() + b'\n')
        self.assertEqual(store.load(result['bodySha256']), result, 'Saved reply must reopen through original plan checks')
        self.assertIs(result['publicationPermission'], False)
        self.assertEqual(result['freshnessVerification'], 'unassessed')
        self.assertEqual(len(self.requests), 1)

    def test_changed_plan_refuses_before_credentials_or_network(self):
        changed = copy.deepcopy(self.plan)
        changed['name'] = 'different'
        with self.assertRaisesRegex(ValueError, 'Original task plan differs'):
            self.transport()(changed, time.monotonic() + 1, owned=lambda: True)
        self.assertEqual(self.requests, [])

    def test_engine_check_false_or_nonboolean_refuses(self):
        for decision in (False, 1, 'yes', None):
            with self.subTest(decision=decision), self.assertRaisesRegex(ValueError, 'engine check refused'):
                self.read(self.transport(attest=lambda engine, deadline: decision))
        self.assertEqual(self.requests, [], 'Refused engine check must precede any HTTP')

    def test_final_engine_check_refuses_saved_record(self):
        calls = []
        def check(engine, deadline):
            calls.append(engine)
            return len(calls) == 1
        store = Observations(self.fixture.root, self.plan, records_root=self.records)
        with self.assertRaisesRegex(ValueError, 'engine check refused'):
            self.transport(attest=check).retain(store, deadline=time.monotonic() + 1.5, owned=lambda: True)
        self.assertEqual(len(self.requests), 1)
        self.assertEqual(list(self.records.iterdir()), [], 'Rejected engine check must not publish metadata')

    def test_pre_cancelled_refuses_before_engine_or_network(self):
        with self.assertRaisesRegex(InterruptedError, 'read cancelled'):
            self.read(self.transport(cancelled=lambda: True))
        self.assertEqual(self.attestations, [])
        self.assertEqual(self.requests, [])

    def test_credential_none_and_invalid_values(self):
        self.token = None
        self.assertEqual(self.read()[0], 200)
        self.assertEqual(urlsplit(self.requests[0]['path']).query, '', 'No token must produce no credential query')
        for token in ('', 1, 'x' * 8193):
            self.token = token
            with self.subTest(tokenType=type(token).__name__), self.assertRaisesRegex(ValueError, 'credential value differs'):
                self.read()
        self.assertEqual(len(self.requests), 1)

    def test_credential_resolution_error_is_not_exposed(self):
        def resolve(reference):
            raise RuntimeError('PRIVATE_CREDENTIAL_MARKER')
        transport = module.Transport(self.plan, resolve, self.attest)
        with self.assertRaisesRegex(ValueError, '^Original task credential resolution failed$'):
            self.read(transport)
        self.assertEqual(self.requests, [])

    def test_nonboolean_cancellation_refuses(self):
        with self.assertRaisesRegex(ValueError, 'cancellation must be a boolean'):
            self.read(self.transport(cancelled=lambda: 0))
        self.assertEqual(self.requests, [])

    def test_adapters_are_required(self):
        with self.assertRaisesRegex(ValueError, 'explicit adapters are required'):
            module.Transport(self.plan, None, self.attest)
        with self.assertRaisesRegex(ValueError, 'ownership adapter is required'):
            self.transport()(self.plan, time.monotonic() + 1, owned=None)

    def test_owned_child_output_bounds(self):
        original = module.subprocess.Popen
        for channel, limit in [('stdout', module.RESPONSE_LIMIT), ('stderr', module.ERROR_LIMIT)]:
            code = "import sys,struct\nn=struct.unpack('!I',sys.stdin.buffer.read(4))[0]\nsys.stdin.buffer.read(n)\nsys." + channel + ".buffer.write(b'x'*" + str(limit + 1) + ")\nsys." + channel + ".buffer.flush()\n"
            def spawn(args, **kwargs):
                child = original([sys.executable, '-B', '-c', code], **kwargs)
                self.children.append(child)
                return child
            with self.subTest(channel=channel), patch.object(module.subprocess, 'Popen', side_effect=spawn):
                with self.assertRaisesRegex(ValueError, 'child output exceeds its bound'):
                    self.read()
            self.assertIsNotNone(self.children[-1].poll(), 'Bound refusal must reap the exact child')

    def test_child_metadata_bound_precedes_payload_read(self):
        def input_bytes(count):
            if count == 4:
                return (module.METADATA_LIMIT + 1).to_bytes(4, 'big')
            raise AssertionError('Oversized child metadata reached payload read')
        with patch.object(module, 'exact_input', side_effect=input_bytes), patch.object(module, 'watch_parent'):
            with self.assertRaisesRegex(ValueError, 'metadata exceeds its bound'):
                module.child(1)

    def test_absent_or_nonboolean_ownership_refuses(self):
        for decision in (False, 1, None):
            with self.subTest(decision=decision), self.assertRaises((InterruptedError, ValueError)):
                self.read(owned=lambda: decision)
        self.assertEqual(self.requests, [])

    def test_deadline_refuses_before_network(self):
        with self.assertRaises(TimeoutError):
            self.transport()(self.plan, time.monotonic() - 1, owned=lambda: True)
        self.assertEqual(self.requests, [])

    def test_redirect_is_not_followed(self):
        self.status = 302
        with self.assertRaisesRegex(ValueError, 'read did not complete'):
            self.read()
        self.assertEqual(len(self.requests), 1, 'Redirect must not cause another GET')

    def test_short_valid_json_prefix_refuses(self):
        self.mode = 'short'
        with self.assertRaisesRegex(ValueError, 'read did not complete'):
            self.read()
        self.assertEqual(len(self.requests), 1)

    def test_compressed_response_refuses(self):
        self.mode = 'encoded'
        with self.assertRaisesRegex(ValueError, 'read did not complete'):
            self.read()

    def test_oversized_response_refuses(self):
        self.mode = 'large'
        with self.assertRaisesRegex(ValueError, 'read did not complete'):
            self.read()
        self.assertTrue(self.closed.wait(timeout=1), 'Oversized declared reply must close before reading its body')

    def test_close_delimited_response_preserves_exact_bytes(self):
        self.mode = 'close_delimited'
        self.assertEqual(self.read()[1], json.dumps(self.value, indent=2).encode() + b'\n')

    def interrupted(self, ownership):
        self.mode = 'held'
        original = module.subprocess.Popen
        def spawn(*args, **kwargs):
            child = original(*args, **kwargs)
            self.children.append(child)
            return child
        transport = self.transport(cancelled=lambda: self.entered.is_set() if not ownership else False)
        owned = lambda: not self.entered.is_set() if ownership else True
        with patch.object(module.subprocess, 'Popen', side_effect=spawn):
            with self.assertRaisesRegex(InterruptedError, 'ownership ended' if ownership else 'read cancelled'):
                self.read(transport, owned=owned)
        self.assertTrue(self.entered.is_set(), 'Original read must reach the server before interruption')
        self.assertTrue(self.closed.wait(timeout=1), 'Interrupted read must close its actual server connection')
        self.assertEqual(len(self.children), 1)
        self.assertIsNotNone(self.children[0].poll(), 'Owned read child must terminate')

    def test_cancelled_inflight_closes_connection(self):
        self.interrupted(False)

    def test_lost_ownership_closes_connection(self):
        self.interrupted(True)

    def test_wrong_task_reply_refuses_retention(self):
        self.value['uuid'] = 'wrong'
        store = Observations(self.fixture.root, self.plan, records_root=self.records)
        with self.assertRaisesRegex(ValueError, 'original UUID or name'):
            self.transport().retain(store, deadline=time.monotonic() + 1.5, owned=lambda: True)
        self.assertEqual(list(self.records.iterdir()), [])

    def test_abrupt_parent_exit_stops_and_reaps_owned_http_child(self):
        libc = ctypes.CDLL(None, use_errno=True);previous = ctypes.c_int()
        self.assertEqual(libc.prctl(37,ctypes.byref(previous),0,0,0),0)
        self.assertEqual(libc.prctl(36,1,0,0,0),0)
        self.mode = 'held';owner = None;record = None;reaped = False
        def identity(pid):
            path = Path('/proc')/str(pid)/'stat'
            if not path.exists():return None
            return path.read_text().rsplit(')',1)[1].split()[19]
        with tempfile.TemporaryDirectory(prefix='odm-http-parent-exit-') as directory:
            root = Path(directory);marker = root/'owned-child.json';exit_flag = root/'exit-owner';script = root/'owner.py'
            source = ("import sys,os,json,subprocess,threading,time\nfrom pathlib import Path\n"
                      "sys.path.insert(0,"+repr(str(Path(module.__file__).parent))+ ")\nimport original_task_http\n"
                      "original=subprocess.Popen\n"
                      "def observed(*args,**kwargs):\n"
                      " child=original(*args,**kwargs)\n"
                      " start=Path('/proc')/str(child.pid)/'stat'\n"
                      " value={'pid':child.pid,'start':start.read_text().rsplit(')',1)[1].split()[19]}\n"
                      " path=Path("+repr(str(marker))+ ");pending=path.with_suffix('.pending')\n"
                      " pending.write_text(json.dumps(value));pending.rename(path)\n return child\n"
                      "original_task_http.subprocess.Popen=observed\n"
                      "def leave():\n"
                      " while not Path("+repr(str(exit_flag))+").exists():time.sleep(.01)\n"
                      " os._exit(19)\n"
                      "threading.Thread(target=leave,daemon=True).start()\n"
                      "original_task_http.Transport("+repr(self.plan)+",lambda reference:None,lambda engine,deadline:True)("+repr(self.plan)+",time.monotonic()+4,owned=lambda:True)\n")
            script.write_text(source)
            try:
                owner = subprocess.Popen([sys.executable,'-B',str(script)],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
                self.assertTrue(self.entered.wait(timeout=3),'Parent-exit probe must reach an actual HTTP request')
                record = json.loads(marker.read_text());exit_flag.touch()
                self.assertEqual(owner.wait(timeout=3),19,'Owned worker must exit abruptly at the selected boundary')
                deadline = time.monotonic()+2
                while time.monotonic()<deadline:
                    pid,_status = os.waitpid(record['pid'],os.WNOHANG)
                    if pid==record['pid']:reaped = True;break
                    time.sleep(.01)
                self.assertTrue(reaped,'Parent exit must stop the owned HTTP child')
                self.assertTrue(self.closed.wait(timeout=2),'Parent exit must close the actual HTTP connection')
                self.assertEqual(len(self.requests),1,'Orphaned original HTTP transport cannot retry')
            finally:
                self.release.set()
                if owner is not None:
                    if owner.poll() is None:owner.kill()
                    owner.wait(timeout=5)
                    for handle in (owner.stdout,owner.stderr):handle.close()
                if record is None and marker.exists():record = json.loads(marker.read_text())
                if record is not None and not reaped:
                    if identity(record['pid'])==record['start']:os.kill(record['pid'],signal.SIGKILL)
                    try:os.waitpid(record['pid'],0)
                    except ChildProcessError:pass
                self.assertEqual(libc.prctl(36,previous.value,0,0,0),0)


if __name__ == '__main__':
    unittest.main()
