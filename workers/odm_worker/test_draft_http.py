"""Controlled actual loopback HTTP transport, without live application authority."""
import copy
import base64
import ctypes
import hashlib
from email.parser import BytesParser
from email.policy import default as email_policy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
import select
import socket
import signal
import subprocess
from pathlib import Path
from types import SimpleNamespace
import tempfile
import sys
import threading
import time
import unittest
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlsplit

import draft_http as module
from draft_http import Transport


class Checks(unittest.TestCase):
    def setUp(self):
        self.requests = []
        self.entered, self.release, self.closed = threading.Event(), threading.Event(), threading.Event()
        self.mode = 'ordinary'
        self.response = b'{"success":true}'
        self.children = []
        fixture = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):pass
            def do_POST(self):
                if fixture.mode == 'held_body':
                    fixture.entered.set();fixture.release.wait(timeout=3)
                body = self.rfile.read(int(self.headers['Content-Length']))
                fixture.requests.append({'path': self.path, 'headers': dict(self.headers), 'body': body})
                fixture.entered.set()
                if fixture.mode == 'held':
                    readable, _, _ = select.select([self.connection], [], [], 3)
                    if readable and self.connection.recv(1, socket.MSG_PEEK) == b'':
                        fixture.closed.set()
                    fixture.release.wait(timeout=3)
                try:
                    response = fixture.response
                    if fixture.mode == 'engine':
                        response = json.dumps({'uuid':self.headers['set-uuid']} if urlsplit(self.path).path == '/task/new/init' else {'success':True}).encode()
                    self.send_response(200)
                    if fixture.mode != 'close_delimited':
                        self.send_header('Content-Length', str(len(response)+(17 if fixture.mode=='short_reply' else 0)))
                    if fixture.mode in ('short_reply','close_delimited'):
                        self.send_header('Connection','close')
                    self.end_headers();self.wfile.write(response)
                    if fixture.mode in ('short_reply','close_delimited'):
                        self.wfile.flush();self.close_connection=True
                except (BrokenPipeError, ConnectionResetError):pass
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=lambda:self.server.serve_forever(poll_interval=0.02), daemon=True)
        self.thread.start()
        self.engine = {'instanceId': 'synthetic-http-engine',
            'endpoint': 'http://127.0.0.1:'+str(self.server.server_address[1]),
            'api': 'nodeodm-2.2.4-draft', 'version': '2.2.4', 'imageId': 'sha256:'+'a'*64,
            'configurationSha256': 'b'*64, 'credentialReference': 'synthetic-http-credential'}
        self.task = '12345678-1234-4234-8234-123456789abc'
        self.init = {'method': 'POST', 'path': '/task/new/init', 'headers': {'set-uuid': self.task},
                     'form': {'name': 'Synthetic original task', 'options': '[]'}}
        self.raw = b'Synthetic original image bytes\x00\xff'
        self.upload = {'method': 'POST', 'path': '/task/new/upload/'+self.task,
            'multipart': {'field': 'images', 'filename': 'original.jpg', 'bytes': len(self.raw),
                          'sha256': hashlib.sha256(self.raw).hexdigest()}}

    def tearDown(self):
        self.release.set()
        for child in self.children:
            if child.poll() is None:child.kill()
            child.wait(timeout=5)
        self.server.shutdown();self.server.server_close();self.thread.join(timeout=3)

    def transport(self, credentials=lambda reference:None, cancelled=lambda:False):
        transport = Transport(self.engine, credentials, cancelled)
        return transport

    def observed_spawn(self, *args, **kwargs):
        child = self.original_spawn(*args, **kwargs)
        self.children.append(child)
        return child

    def test_incomplete_content_length_refuses_valid_json_prefix(self):
        self.mode='short_reply'
        self.response=json.dumps({'uuid':self.task}).encode()
        with self.assertRaisesRegex(RuntimeError,'Original draft HTTP child failed'):
            self.transport()(self.engine,self.init,None,time.monotonic()+3)
        self.assertEqual(len(self.requests),1,'Framing refusal must follow the actual original request')

    def test_incomplete_content_length_refuses_empty_prefix(self):
        self.mode='short_reply';self.response=b''
        with self.assertRaisesRegex(RuntimeError,'Original draft HTTP child failed'):
            self.transport()(self.engine,self.init,None,time.monotonic()+3)
        self.assertEqual(len(self.requests),1,'Empty-prefix refusal must follow the actual original request')

    def test_complete_close_delimited_reply_preserves_exact_bytes(self):
        self.mode='close_delimited';self.response=json.dumps({'uuid':self.task}).encode()
        self.assertEqual(self.transport()(self.engine,self.init,None,time.monotonic()+3),(200,self.response),
            'A complete reply delimited by connection close must remain supported')

    def test_complete_zero_length_reply_is_not_a_framing_error(self):
        self.response=b''
        self.assertEqual(self.transport()(self.engine,self.init,None,time.monotonic()+3),(200,b''),
            'Framing completeness does not decide whether an empty body is an API acknowledgement')

    def test_actual_init_preserves_fields_header_and_credential(self):
        self.response = json.dumps({'uuid': self.task}).encode()
        calls = []
        def credential(reference):calls.append(reference);return 'synthetic token+only'
        with patch.dict(os.environ, {'HTTP_PROXY':'http://127.0.0.1:1', 'HTTPS_PROXY':'http://127.0.0.1:1'}):
            result = self.transport(credential)(self.engine, self.init, None, time.monotonic()+3)
        self.assertEqual(result, (200, self.response), 'Exact original HTTP status and body must return')
        request = self.requests[0]
        self.assertEqual(parse_qs(urlsplit(request['path']).query), {'token':['synthetic token+only']})
        self.assertEqual(request['headers']['set-uuid'], self.task, 'Original initialization UUID must reach HTTP')
        message = BytesParser(policy=email_policy).parsebytes(('Content-Type: '+request['headers']['Content-Type']+'\r\nMIME-Version: 1.0\r\n\r\n').encode()+request['body'])
        self.assertTrue(message.is_multipart(), 'Pinned engine initialization requires multipart fields')
        fields = [(part.get_param('name', header='content-disposition'),part.get_payload(decode=True).decode()) for part in message.iter_parts()]
        self.assertEqual(fields, [('name','Synthetic original task'), ('options','[]')], 'Original initialization fields must reach multipart unchanged')
        self.assertEqual(calls, ['synthetic-http-credential'])

    def test_actual_upload_preserves_original_image_and_filename(self):
        stream = io.BytesIO(self.raw)
        result = self.transport()(self.engine, self.upload, stream, time.monotonic()+3)
        self.assertEqual(result, (200, self.response))
        request = self.requests[0];body = request['body']
        boundary = request['headers']['Content-Type'].split('boundary=',1)[1].encode()
        self.assertIn(b'name="images"; filename="original.jpg"', body)
        self.assertEqual(body.split(b'\r\n\r\n',1)[1], self.raw+b'\r\n--'+boundary+b'--\r\n', 'Original image bytes must reach multipart unchanged')
        self.assertEqual(stream.tell(), len(self.raw), 'Transport must consume the complete original image')
        self.assertEqual(len(self.requests), 1, 'Original upload cannot retry')

    def test_pre_cancelled_transport_refuses_before_credentials_or_spawn(self):
        credentials = Mock(return_value=None)
        transport = self.transport(credentials=credentials, cancelled=lambda:True)
        with patch('draft_http.subprocess.Popen', side_effect=AssertionError('Precancelled transport spawned child')):
            with self.assertRaisesRegex(InterruptedError, 'Original draft HTTP transport cancelled'):
                transport(self.engine, self.init, None, time.monotonic()+3)
        self.assertEqual(credentials.call_count, 0, 'Precancelled transport resolved credentials')
        self.assertEqual(self.requests, [])

    def test_actual_response_cancellation_closes_connection_and_reaps_child(self):
        self.mode = 'held';cancelled = threading.Event()
        def cancel():
            if self.entered.wait(timeout=3):cancelled.set()
        thread = threading.Thread(target=cancel);thread.start()
        self.original_spawn = subprocess.Popen
        try:
            with patch('draft_http.subprocess.Popen', side_effect=self.observed_spawn):
                with self.assertRaisesRegex(InterruptedError, 'Original draft HTTP transport cancelled'):
                    self.transport(cancelled=cancelled.is_set)(self.engine, self.init, None, time.monotonic()+3)
            self.assertTrue(self.closed.wait(timeout=2), 'Cancellation must close the actual HTTP connection')
            self.assertEqual(len(self.children), 1)
            self.assertIsNotNone(self.children[0].poll(), 'Cancellation must reap the owned HTTP child')
            self.assertEqual(len(self.requests), 1, 'Cancelled original transport cannot retry')
        finally:
            self.release.set();thread.join(timeout=3)

    def test_changed_engine_refuses_before_credentials_or_spawn(self):
        changed = copy.deepcopy(self.engine);changed['instanceId'] = 'another-engine'
        credentials = Mock(return_value=None)
        transport = self.transport(credentials=credentials)
        with patch('draft_http.subprocess.Popen', side_effect=AssertionError('Changed engine spawned child')):
            with self.assertRaisesRegex(ValueError, 'Original HTTP engine identity differs'):
                transport(changed, self.init, None, time.monotonic()+3)
        self.assertEqual(credentials.call_count, 0, 'Changed engine resolved credentials')

    def test_commit_command_never_reaches_credentials_or_spawn(self):
        credentials = Mock(return_value=None)
        transport = self.transport(credentials=credentials)
        with patch('draft_http.subprocess.Popen', side_effect=AssertionError('Commit spawned child')):
            with self.assertRaisesRegex(ValueError, 'Only original init/upload HTTP commands are permitted'):
                transport(self.engine, {**self.upload,'path':'/task/new/commit/'+self.task}, io.BytesIO(self.raw), time.monotonic()+3)
        self.assertEqual(credentials.call_count, 0, 'Commit resolved credentials')

    def test_invalid_deadline_refuses_before_credentials_or_spawn(self):
        credentials = Mock(return_value=None)
        transport = self.transport(credentials=credentials)
        with patch('draft_http.subprocess.Popen', side_effect=AssertionError('Invalid deadline spawned child')):
            for deadline in (float('nan'), True, None, float('inf')):
                with self.subTest(deadline=deadline), self.assertRaises(ValueError):
                    transport(self.engine, self.init, None, deadline)
                self.assertEqual(credentials.call_count, 0, 'Invalid deadline resolved credentials')
            with self.assertRaisesRegex(TimeoutError, 'Original draft HTTP deadline exceeded'):
                transport(self.engine, self.init, None, time.monotonic()-1)

    def test_cancellation_adapter_requires_exact_boolean(self):
        for value in (0, 1, None, {'cancelled':False}):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'HTTP cancellation adapter must return a boolean'):
                self.transport(cancelled=lambda:value)(self.engine, self.init, None, time.monotonic()+3)

    def test_credentials_refuse_invalid_values_and_keep_diagnostics_private(self):
        for value in ('', True, {}, 'x'*8193):
            with self.subTest(value_type=type(value).__name__), self.assertRaisesRegex(ValueError, 'Original engine credential value differs'):
                self.transport(credentials=lambda reference:value)(self.engine, self.init, None, time.monotonic()+3)
        def broken(reference):raise RuntimeError('Synthetic private credential detail')
        with self.assertRaisesRegex(ValueError, '^Original engine credential resolution failed$'):
            self.transport(credentials=broken)(self.engine, self.init, None, time.monotonic()+3)

    def test_metadata_bound_precedes_child_launch(self):
        command = copy.deepcopy(self.init);command['form']['options'] = 'x'*module.METADATA_LIMIT
        with patch('draft_http.subprocess.Popen', side_effect=AssertionError('Oversized metadata spawned child')):
            with self.assertRaisesRegex(ValueError, 'Original HTTP metadata exceeds its bound'):
                self.transport()(self.engine, command, None, time.monotonic()+3)

    def test_streamed_hash_mismatch_cannot_finish_multipart(self):
        command = copy.deepcopy(self.upload);command['multipart']['sha256'] = '0'*64
        with self.assertRaisesRegex(RuntimeError, 'Original draft HTTP child failed'):
            self.transport()(self.engine, command, io.BytesIO(self.raw), time.monotonic()+3)
        self.assertTrue(self.entered.wait(timeout=2), 'Hash mismatch must exercise a real request')
        boundary = self.requests[0]['headers']['Content-Type'].split('boundary=',1)[1].encode()
        self.assertFalse(self.requests[0]['body'].endswith(b'\r\n--'+boundary+b'--\r\n'), 'Changed streamed hash cannot complete the multipart request')

    def test_response_envelope_duplicate_keys_and_base64_refuse(self):
        def wire(value):return json.dumps(value).encode()
        body = base64.b64encode(self.response).decode()
        self.assertEqual(module.decode_response(wire({'status':200,'bodyBase64':body})), (200,self.response))
        for value in ({'status':True,'bodyBase64':body}, [200,body], {'status':200,'bodyBase64':{}},
                      {'status':200,'bodyBase64':body,'extra':True}, {'status':200}):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'Original HTTP child response envelope differs'):
                module.decode_response(wire(value))
        with self.assertRaisesRegex(ValueError, 'Original HTTP child response has duplicate keys'):
            module.decode_response(b'{"status":500,"status":200,"bodyBase64":""}')
        with self.assertRaises(ValueError):module.decode_response(wire({'status':200,'bodyBase64':'%%%'}))

    def test_response_bounds_refuse_before_or_after_decoding(self):
        with patch('draft_http.json.loads', side_effect=AssertionError('Oversized wire reached JSON parser')):
            with self.assertRaisesRegex(ValueError, 'Original HTTP child output exceeds its bound'):
                module.decode_response(b' '* (module.WIRE_LIMIT+1))
        body = base64.b64encode(b'x'*(module.RESPONSE_LIMIT+1)).decode()
        with self.assertRaisesRegex(ValueError, 'Original HTTP response exceeds its bound'):
            module.decode_response(json.dumps({'status':200,'bodyBase64':body}).encode())

    def test_actual_oversized_response_refuses_from_child(self):
        self.response = b'x'*(module.RESPONSE_LIMIT+1)
        with self.assertRaisesRegex(RuntimeError, 'Original draft HTTP child failed'):
            self.transport()(self.engine, self.init, None, time.monotonic()+3)

    def test_credential_adapter_cannot_replace_original_engine_snapshot(self):
        transport = None
        def credential(reference):
            transport.engine['endpoint'] = 'http://127.0.0.1:1'
            return None
        transport = self.transport(credentials=credential)
        self.assertEqual(transport(self.engine, self.init, None, time.monotonic()+3), (200,self.response), 'Credential resolution cannot replace the detached original engine')
        self.assertEqual(len(self.requests),1)

    def test_constructor_requires_linux_and_callable_adapters(self):
        for credentials, cancelled in ((None,lambda:False), (lambda reference:None,None)):
            with self.subTest(credentials=callable(credentials), cancelled=callable(cancelled)), self.assertRaisesRegex(ValueError, 'Linux original HTTP supervision and explicit adapters are required'):
                Transport(self.engine, credentials, cancelled)
        with patch('draft_http.sys.platform', 'unsupported-fixture-platform'):
            with self.assertRaisesRegex(ValueError, 'Linux original HTTP supervision and explicit adapters are required'):
                self.transport()

    def test_initialization_shape_and_fields_refuse_before_credentials(self):
        credentials = Mock(return_value=None)
        transport = self.transport(credentials=credentials)
        variants = []
        for change in ({'method':'GET'}, {'extra':True}, {'headers':{}}, {'headers':{'set-uuid':'another'}},
                       {'form':{}}, {'form':{'name':'','options':'[]'}}, {'form':{'name':'x'*513,'options':'[]'}},
                       {'form':{'name':'synthetic','options':{}}}):variants.append({**self.init, **change})
        for command in variants:
            with self.subTest(command=command), patch('draft_http.subprocess.Popen', side_effect=AssertionError('Invalid initialization spawned child')), self.assertRaises(ValueError):
                transport(self.engine, command, None, time.monotonic()+3)
            self.assertEqual(credentials.call_count, 0, 'Invalid initialization reached credentials')
        with patch('draft_http.subprocess.Popen', side_effect=AssertionError('Invalid initialization spawned child')), self.assertRaisesRegex(ValueError, 'Original HTTP initialization shape differs'):
            transport(self.engine, self.init, io.BytesIO(b''), time.monotonic()+3)
        self.assertEqual(credentials.call_count, 0, 'Invalid initialization reached credentials')

    def test_upload_descriptors_refuse_before_credentials(self):
        credentials = Mock(return_value=None)
        transport = self.transport(credentials=credentials)
        for change in ({'field':'other'}, {'bytes':True}, {'bytes':-1}, {'sha256':'another'}, {'filename':'../other.jpg'}, {'filename':'no-extension'}):
            command = copy.deepcopy(self.upload);command['multipart'].update(change)
            with self.subTest(change=change), patch('draft_http.subprocess.Popen', side_effect=AssertionError('Invalid upload spawned child')), self.assertRaises(ValueError):
                transport(self.engine, command, io.BytesIO(self.raw), time.monotonic()+3)
            self.assertEqual(credentials.call_count, 0, 'Invalid upload reached credentials')
        with patch('draft_http.subprocess.Popen', side_effect=AssertionError('Invalid upload spawned child')), self.assertRaisesRegex(ValueError, 'Original HTTP upload descriptor differs'):
            transport(self.engine, self.upload, None, time.monotonic()+3)
        self.assertEqual(credentials.call_count, 0, 'Invalid upload reached credentials')

    def test_short_or_nonbyte_stream_refuses_and_stops_child(self):
        for stream in (io.BytesIO(self.raw[:-1]), io.StringIO('x'*len(self.raw))):
            with self.subTest(stream=type(stream).__name__), self.assertRaisesRegex(ValueError, 'Original HTTP image stream ended early or differs'):
                self.transport()(self.engine, self.upload, stream, time.monotonic()+3)

    def test_extra_image_byte_refuses_complete_stream_claim(self):
        with self.assertRaisesRegex(ValueError, 'Original HTTP image stream exceeds its descriptor'):
            self.transport()(self.engine, self.upload, io.BytesIO(self.raw+b'x'), time.monotonic()+3)

    def test_actual_response_deadline_stops_owned_child(self):
        self.mode = 'held';self.original_spawn = subprocess.Popen
        try:
            with patch('draft_http.subprocess.Popen', side_effect=self.observed_spawn):
                with self.assertRaisesRegex(TimeoutError, 'Original draft HTTP deadline exceeded'):
                    self.transport()(self.engine, self.init, None, time.monotonic()+0.3)
            self.assertTrue(self.entered.is_set(), 'Deadline probe must reach an actual request')
            self.assertTrue(self.closed.wait(timeout=2), 'Deadline must close the actual HTTP connection')
            self.assertIsNotNone(self.children[0].poll(), 'Deadline must reap the owned HTTP child')
        finally:self.release.set()

    def test_stalled_resolver_cannot_start_a_late_request(self):
        original = Path(module.__file__).read_text()
        with tempfile.TemporaryDirectory(prefix='odm-http-resolver-') as directory:
            root = Path(directory);marker = root/'resolver-entered';script = root/'delayed-http.py'
            original = original.replace('from engine_effects import ', 'sys.path.insert(0,'+repr(str(Path(module.__file__).parent))+')\nfrom engine_effects import ',1)
            inserted = ('    import socket\n    original_resolver=socket.getaddrinfo\n'
                        '    def held_resolver(*args,**kwargs):\n'
                        '        Path('+repr(str(marker))+').touch()\n'
                        '        time.sleep(1)\n        return original_resolver(*args,**kwargs)\n'
                        '    socket.getaddrinfo=held_resolver\n')
            anchor = '    endpoint = urlsplit(engine[\'endpoint\'])\n'
            self.assertEqual(original.count(anchor),1);script.write_text(original.replace(anchor,inserted+anchor,1))
            self.original_spawn = subprocess.Popen
            def spawn(args, **kwargs):
                args = list(args);args[2] = str(script)
                child = self.observed_spawn(args, **kwargs)
                child.wait = Mock(wraps=child.wait)
                return child
            with patch('draft_http.subprocess.Popen', side_effect=spawn):
                with self.assertRaisesRegex(TimeoutError, 'Original draft HTTP deadline exceeded'):
                    self.transport()(self.engine, self.init, None, time.monotonic()+0.3)
            self.assertTrue(marker.exists(), 'Probe must reach the actual resolver call')
            self.assertGreater(self.children[0].wait.call_count, 0, 'Stalled resolver child must be reaped before return')
            self.assertIsNotNone(self.children[0].poll(), 'Stalled resolver child must exit before return')
            time.sleep(1.1)
            self.assertEqual(self.requests, [], 'Abandoned resolver cannot start a late HTTP request')

    def test_owned_stop_signals_before_waiting(self):
        class Owned:
            killed = False
            def poll(self):return None
            def kill(self):self.killed = True
            def wait(self, timeout):
                if not self.killed:raise AssertionError('Owned live child wait preceded its stop signal')
                return -9
        Transport._stop(Owned())

    def test_owned_stop_never_signals_an_exited_child(self):
        class Owned:
            def poll(self):return 0
            def kill(self):raise AssertionError('Exited child received another signal')
            def wait(self, timeout):return 0
        Transport._stop(Owned())

    def test_actual_body_cancellation_stops_a_partial_upload(self):
        self.mode = 'held_body';cancelled = threading.Event();count = 32*1024*1024
        checksum = hashlib.sha256()
        for _ in range(32):checksum.update(b'\0'*(1024*1024))
        command = copy.deepcopy(self.upload);command['multipart'].update(bytes=count, sha256=checksum.hexdigest())
        self.original_spawn = subprocess.Popen
        def cancel():
            if self.entered.wait(timeout=3):cancelled.set()
        thread = threading.Thread(target=cancel);thread.start()
        try:
            with tempfile.TemporaryFile() as stream:
                stream.truncate(count);stream.seek(0)
                with patch('draft_http.subprocess.Popen', side_effect=self.observed_spawn):
                    with self.assertRaisesRegex(InterruptedError, 'Original draft HTTP transport cancelled'):
                        self.transport(cancelled=cancelled.is_set)(self.engine, command, stream, time.monotonic()+3)
                self.assertLess(stream.tell(),count,'Cancelled stalled upload cannot consume all original bytes')
            self.assertIsNotNone(self.children[0].poll(),'Body cancellation must reap the owned child')
        finally:self.release.set();thread.join(timeout=3)

    def test_actual_runtime_bridge_saves_original_replies_and_holds_commit(self):
        import test_runtime_preparation as fixture
        from runtime_draft import Draft
        checks = fixture.Checks();checks.setUp();self.mode = 'engine'
        try:
            checks.spec['engine'] = copy.deepcopy(self.engine)
            transport = self.transport()
            draft = Draft(checks.preparation, lambda *args:True, transport, timeout=4)
            checks.runtime.pipeline = draft
            with checks.runtime.owner():
                self.assertTrue(checks.runtime.run_one(), 'Actual runtime must call original HTTP draft')
                for operation in ('upload:0', 'upload:1'):
                    result = draft.advance(checks.request['requestId'])
                    self.assertEqual((result['state'],result['operation']), ('acknowledged',operation))
                result = draft.advance(checks.request['requestId'])
                self.assertEqual(result['state'],'draft_complete_commit_held')
                self.assertEqual(checks.runtime.status()['heldStarted'],1)
            self.assertEqual(len(self.requests),3,'Runtime bridge must send only original initialization and images')
            for index,raw in enumerate(checks.raw):
                self.assertIn(raw,self.requests[index+1]['body'],'Actual HTTP must retain each original image')
            plan = checks.read('engine/plan.json')
            self.assertEqual(self.requests[0]['headers']['set-uuid'],plan['taskUuid'])
            self.assertEqual(plan['binding']['originalAdmission'],checks.entry.admission)
            self.assertFalse((checks.folder/'engine/command-00003.intent.json').exists(),'HTTP bridge cannot issue processing commit')
            for index in range(3):self.assertTrue((checks.folder/f'engine/command-{index:05d}.reply.json').exists())
            self.assertFalse(result['commitPermission'])
            self.assertEqual(result['engineCustodyVerification'],'unassessed')
        finally:checks.tearDown()

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
                      "sys.path.insert(0,"+repr(str(Path(module.__file__).parent))+ ")\nimport draft_http\n"
                      "original=subprocess.Popen\n"
                      "def observed(*args,**kwargs):\n"
                      " child=original(*args,**kwargs)\n"
                      " start=Path('/proc')/str(child.pid)/'stat'\n"
                      " value={'pid':child.pid,'start':start.read_text().rsplit(')',1)[1].split()[19]}\n"
                      " path=Path("+repr(str(marker))+ ");pending=path.with_suffix('.pending')\n"
                      " pending.write_text(json.dumps(value));pending.rename(path)\n return child\n"
                      "draft_http.subprocess.Popen=observed\n"
                      "def leave():\n"
                      " while not Path("+repr(str(exit_flag))+").exists():time.sleep(.01)\n"
                      " os._exit(19)\n"
                      "threading.Thread(target=leave,daemon=True).start()\n"
                      "draft_http.Transport("+repr(self.engine)+",lambda reference:None)("+repr(self.engine)+","+repr(self.init)+",None,time.monotonic()+4)\n")
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

    def test_child_stdout_and_stderr_bounds_precede_response_decode(self):
        self.original_spawn = subprocess.Popen
        for channel,count in (('stdout',module.WIRE_LIMIT+1),('stderr',module.ERROR_LIMIT+1)):
            script = ("import sys,struct\nn=struct.unpack('!I',sys.stdin.buffer.read(4))[0]\n"
                      "sys.stdin.buffer.read(n)\n"
                      "sys."+channel+".buffer.write(b'x'*"+str(count)+")\nsys."+channel+".buffer.flush()\n")
            def spawn(args, **kwargs):
                return self.observed_spawn([sys.executable,'-B','-c',script], **kwargs)
            with self.subTest(channel=channel), patch('draft_http.subprocess.Popen', side_effect=spawn), \
                 patch('draft_http.decode_response', side_effect=AssertionError('Oversized child output reached response decoder')):
                with self.assertRaisesRegex(ValueError,'Original HTTP child output exceeds its bound'):
                    self.transport()(self.engine,self.init,None,time.monotonic()+3)
            self.assertIsNotNone(self.children[-1].poll(),'Output-bound refusal must reap the owned child')

    def test_child_metadata_bound_precedes_payload_read(self):
        def input_bytes(count):
            if count==4:return (module.METADATA_LIMIT+1).to_bytes(4,'big')
            raise AssertionError('Oversized child metadata reached payload read')
        with patch('draft_http.watch_parent', return_value=None), patch('draft_http.exact_input', side_effect=input_bytes):
            with self.assertRaisesRegex(ValueError,'Original HTTP metadata exceeds its bound'):
                module.child(-1)

    def test_incomplete_child_frame_refuses_at_original_eof(self):
        class Source(io.BytesIO):
            calls = 0
            def read(self,count):
                self.calls+=1
                if self.calls>2:raise AssertionError('Incomplete child input continued after original EOF')
                return super().read(count)
        with patch('draft_http.sys.stdin', SimpleNamespace(buffer=Source(b'abc'))):
            with self.assertRaisesRegex(ValueError,'Original HTTP child input is incomplete'):
                module.exact_input(4)

    def test_child_environment_does_not_inherit_unrelated_credentials(self):
        self.original_spawn = subprocess.Popen
        def spawn(args, **kwargs):
            self.assertNotIn('OPENPLAN_SYNTHETIC_UNRELATED_SECRET',kwargs['env'],'HTTP child cannot inherit unrelated credentials')
            return self.observed_spawn(args,**kwargs)
        with patch.dict(os.environ,{'OPENPLAN_SYNTHETIC_UNRELATED_SECRET':'synthetic-only'}), patch('draft_http.subprocess.Popen',side_effect=spawn):
            self.assertEqual(self.transport()(self.engine,self.init,None,time.monotonic()+3),(200,self.response))


if __name__ == '__main__':
    unittest.main()
