"""One actual loopback POST with exact replies and owned interruption."""
from concurrent.futures import ThreadPoolExecutor
import copy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import select
import sys
from unittest.mock import patch
import threading
import time
import unittest
from urllib.parse import parse_qs, urlsplit

import original_commit_http as module
import test_task_observation as fixtures


class Checks(unittest.TestCase):
    def setUp(self):
        fixtures.Checks.setUp(self)
        self.requests = []
        self.children = []
        self.entered = threading.Event()
        self.closed = threading.Event()
        self.release = threading.Event()
        self.held = False
        self.status = 200
        self.short = False
        self.body = json.dumps({'uuid': self.plan['taskUuid']}, indent=2).encode() + b'\n'
        self.attestations = []
        self.resolutions = []
        self.token = 'Synthetic commit token & query'
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_POST(self):
                size = int(self.headers.get('Content-Length', '0'))
                fixture.requests.append({'path': self.path, 'body': self.rfile.read(size),
                                         'headers': dict(self.headers)})
                fixture.entered.set()
                if fixture.held:
                    readable, _, _ = select.select([self.connection], [], [], 3)
                    if readable:
                        try:
                            if not self.connection.recv(1):
                                fixture.closed.set()
                        except ConnectionResetError:
                            fixture.closed.set()
                    fixture.release.wait(3)
                try:
                    self.send_response(fixture.status)
                    self.send_header('Content-Length', str(len(fixture.body) + (9 if fixture.short else 0)))
                    self.send_header('Connection', 'close')
                    self.end_headers()
                    self.wfile.write(fixture.body)
                    self.wfile.flush()
                    self.close_connection = True
                except (BrokenPipeError, ConnectionResetError):
                    pass

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=lambda: self.server.serve_forever(poll_interval=.02), daemon=True)
        self.thread.start()
        self.plan['engine']['endpoint'] = 'http://127.0.0.1:' + str(self.server.server_address[1])
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.addCleanup(self.release.set)
        def reap():
            for child in self.children:
                if child.poll() is None:
                    child.kill()
                child.wait(timeout=5)
        self.addCleanup(reap)

    tearDown = fixtures.Checks.tearDown

    def attest(self, engine, deadline):
        self.attestations.append((copy.deepcopy(engine), deadline))
        return True

    def resolve(self, reference):
        self.resolutions.append(reference)
        return self.token

    def transport(self, **kwargs):
        return module.Transport(self.plan, self.resolve, kwargs.pop('attest', self.attest), **kwargs)

    def commit(self, transport=None, *, owned=lambda: True, timeout=2):
        return (transport or self.transport())(self.plan, time.monotonic() + timeout, owned=owned)

    def test_one_exact_original_post_and_complete_reply(self):
        status, body = self.commit()
        self.assertEqual((status, body), (200, self.body), 'Commit transport must retain the exact original reply')
        self.assertEqual(len(self.requests), 1, 'Exactly one original processing POST must arrive')
        request = self.requests[0]
        self.assertEqual(urlsplit(request['path']).path, '/task/new/commit/' + self.plan['taskUuid'],
                         'Commit must target the original task UUID')
        self.assertEqual(parse_qs(urlsplit(request['path']).query), {'token': [self.token]})
        self.assertEqual(request['body'], b'', 'Original commit has no supplied payload')
        self.assertEqual(self.resolutions, [self.plan['engine']['credentialReference']])
        self.assertEqual(len(self.attestations), 2, 'Commit must attest the original engine before and after transport')

    def test_wrong_uuid_error_and_duplicate_reply_refuse(self):
        for body in [b'{"uuid":"wrong"}', json.dumps({'uuid': self.plan['taskUuid'], 'error': 'failure'}).encode(),
                     ('{"uuid":"' + self.plan['taskUuid'] + '","uuid":"' + self.plan['taskUuid'] + '"}').encode()]:
            self.body = body
            with self.assertRaises(ValueError):
                self.commit()
        self.assertEqual(len(self.requests), 3, 'Rejected commit replies cannot trigger automatic retries')

    def test_non_success_and_partial_body_refuse_without_retry(self):
        self.status = 302
        with self.assertRaises(ValueError):
            self.commit()
        self.status = 200
        self.short = True
        with self.assertRaises(ValueError):
            self.commit()
        self.assertEqual(len(self.requests), 2, 'A redirect or partial reply cannot trigger another POST')

    def test_unowned_and_precancelled_calls_stop_before_credentials_or_http(self):
        with self.assertRaises(InterruptedError):
            self.commit(owned=lambda: False)
        with self.assertRaises(InterruptedError):
            self.commit(self.transport(cancelled=lambda: True))
        self.assertEqual(self.resolutions, [], 'Stopped commit cannot resolve credentials')
        self.assertEqual(self.requests, [], 'Stopped commit cannot begin an external request')
        self.assertEqual(self.attestations, [], 'Stopped commit cannot query engine attestation')

    def test_engine_refusal_prevents_commit_request(self):
        with self.assertRaises(ValueError):
            self.commit(self.transport(attest=lambda *_args: False))
        self.assertEqual(self.requests, [], 'Unattested engine cannot receive a processing commit')
        self.assertEqual(self.resolutions, [])

    def test_owner_loss_closes_stalled_actual_request(self):
        self.held = True
        owned = [True]
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(self.commit, owned=lambda: owned[0])
            self.assertTrue(self.entered.wait(2), 'Actual commit request must reach the held response')
            owned[0] = False
            with self.assertRaises(InterruptedError):
                pending.result(timeout=2)
        self.assertTrue(self.closed.wait(2), 'Lost commit ownership must close the actual stalled connection')
        self.assertEqual(len(self.requests), 1)

    def test_final_engine_refusal_cannot_acknowledge_commit_reply(self):
        count = []
        def attest(engine, deadline):
            count.append(engine)
            return len(count) == 1
        with self.assertRaisesRegex(ValueError, 'engine check refused'):
            self.commit(self.transport(attest=attest))
        self.assertEqual(len(self.requests), 1, 'Final engine refusal cannot retry the already sent commit')

    def test_parent_metadata_bound_precedes_child_creation(self):
        plan = copy.deepcopy(self.plan)
        plan['engine']['instanceId'] = 'x' * module.METADATA_LIMIT
        transport = module.Transport(plan, self.resolve, lambda *_args: True)
        with patch.object(module.subprocess, 'Popen', side_effect=AssertionError('Oversized original metadata reached child creation')), \
                self.assertRaisesRegex(ValueError, 'metadata exceeds its bound'):
            transport(plan, time.monotonic() + 2, owned=lambda: True)
        self.assertEqual(self.requests, [], 'Oversized original metadata cannot create an external request')

    def test_child_shape_uuid_and_credential_refuse_before_http(self):
        ordinary = {'engine': self.plan['engine'], 'taskUuid': self.plan['taskUuid'],
                    'token': None, 'deadline': time.monotonic() + 2}
        variants = [({**ordinary, 'extra': True}, 'metadata differs'),
                    ({**ordinary, 'taskUuid': 'wrong'}, 'UUID differs'),
                    ({**ordinary, 'token': 1}, 'credential value differs')]
        for value, reason in variants:
            payload = json.dumps(value).encode()
            parts = [(len(payload)).to_bytes(4, 'big'), payload]
            with patch.object(module, 'exact_input', side_effect=lambda count: parts.pop(0)), \
                    patch.object(module, 'watch_parent'), self.assertRaisesRegex(ValueError, reason):
                module.child(1)
        self.assertEqual(self.requests, [], 'Invalid child metadata cannot reach the commit endpoint')


    def test_changed_plan_refuses_before_credentials_or_network(self):
        changed = copy.deepcopy(self.plan)
        changed['name'] = 'different'
        with self.assertRaisesRegex(ValueError, 'Original commit plan differs'):
            self.transport()(changed, time.monotonic() + 1, owned=lambda: True)
        self.assertEqual(self.requests, [])

    def test_engine_check_false_or_nonboolean_refuses(self):
        for decision in (False, 1, 'yes', None):
            with self.subTest(decision=decision), self.assertRaisesRegex(ValueError, 'engine check refused'):
                self.commit(self.transport(attest=lambda engine, deadline: decision))
        self.assertEqual(self.requests, [], 'Refused engine check must precede any HTTP')

    def test_credential_none_and_invalid_values(self):
        self.token = None
        self.assertEqual(self.commit()[0], 200)
        self.assertEqual(urlsplit(self.requests[0]['path']).query, '', 'No token must produce no credential query')
        for token in ('', 1, 'x' * 8193):
            self.token = token
            with self.subTest(tokenType=type(token).__name__), \
                    patch.object(module.subprocess, 'Popen', side_effect=AssertionError('Invalid original credential reached child creation')), \
                    self.assertRaisesRegex(ValueError, 'credential value differs'):
                self.commit()
        self.assertEqual(len(self.requests), 1)

    def test_credential_resolution_error_is_not_exposed(self):
        def resolve(reference):
            raise RuntimeError('PRIVATE_CREDENTIAL_MARKER')
        transport = module.Transport(self.plan, resolve, self.attest)
        with self.assertRaisesRegex(ValueError, '^Original commit credential resolution failed$'):
            self.commit(transport)
        self.assertEqual(self.requests, [])

    def test_nonboolean_cancellation_refuses(self):
        with self.assertRaisesRegex(ValueError, 'cancellation must be a boolean'):
            self.commit(self.transport(cancelled=lambda: 0))
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
                    self.commit()
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
                self.commit(owned=lambda: decision)
        self.assertEqual(self.requests, [])

    def test_deadline_refuses_before_network(self):
        with self.assertRaises(TimeoutError):
            self.transport()(self.plan, time.monotonic() - 1, owned=lambda: True)
        self.assertEqual(self.requests, [])

if __name__ == '__main__':
    unittest.main()
