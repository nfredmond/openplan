"""Actual supervised loopback POSTs, interruptions and incomplete responses."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import base64
import json
import threading
import time
import unittest
from unittest.mock import patch

import progress_http as module


class Checks(unittest.TestCase):
    def setUp(self):
        self.requests = []; self.status = 200; self.reply = b'{"ok":true}'; self.declared = None
        self.received = threading.Event(); self.closed = threading.Event()
        self.stall = False
        fixture = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass
            def do_POST(self):
                fixture.requests.append((self.path, dict(self.headers), self.rfile.read(int(self.headers['Content-Length']))))
                self.send_response(fixture.status)
                self.send_header('Content-Length', str(len(fixture.reply) if fixture.declared is None else fixture.declared))
                if fixture.status == 302:
                    self.send_header('Location', '/other-endpoint')
                self.end_headers(); self.wfile.flush(); fixture.received.set()
                if fixture.stall:
                    # Once the owned child closes, the request socket reaches EOF.
                    self.connection.settimeout(3)
                    try:
                        if self.rfile.read(1) == b'': fixture.closed.set()
                    except OSError:
                        pass
                    return
                try:
                    self.wfile.write(fixture.reply); self.wfile.flush()
                except OSError:
                    pass
                self.close_connection = True
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True); self.thread.start()
        self.addCleanup(self.cleanup)
        self.url = f'http://127.0.0.1:{self.server.server_port}/callback?original=scope'
        self.credentials = []
        def resolve(reference):
            self.credentials.append(reference); return 'synthetic-only'
        self.transport = module.Transport(self.url, 'original-key', resolve,
            allowed_networks=('127.0.0.1/32',), allowed_ports=(self.server.server_port,))
        self.body = b'{\n  "original": "\xc3\xa9tude"\n}\n'

    def cleanup(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(timeout=5)

    def call(self, **options):
        return self.transport(self.url, 'original-key', self.body, time.monotonic()+4,
            owned=options.get('owned', lambda: True))

    def test_actual_post_preserves_path_bearer_body_and_response(self):
        self.assertEqual(self.call(), (200, self.reply), 'Complete receiver response stays exact')
        self.assertEqual(len(self.requests), 1, 'Transport makes one POST')
        path, headers, body = self.requests[0]
        self.assertEqual(path, '/callback?original=scope', 'Transport preserves the original callback path and query')
        self.assertEqual(headers['Authorization'], 'Bearer synthetic-only', 'Transport resolves the original callback bearer')
        self.assertEqual(body, self.body, 'Transport preserves exact original UTF-8 body bytes')
        self.assertEqual(self.credentials, ['original-key'])

    def test_redirect_is_returned_without_following_or_forwarding_bearer(self):
        self.status = 302
        self.assertEqual(self.call(), (302, self.reply), 'Redirect is an unacknowledged receiver response')
        self.assertEqual(len(self.requests), 1, 'Callback redirect cannot forward the bearer to another endpoint')

    def test_precancelled_unowned_and_expired_calls_start_no_child_or_credential_read(self):
        for owned, cancelled, deadline, kind in [
                (lambda: False, lambda: False, time.monotonic()+4, InterruptedError),
                (lambda: True, lambda: True, time.monotonic()+4, InterruptedError),
                (lambda: True, lambda: False, time.monotonic()-1, TimeoutError)]:
            self.transport.policy.cancelled = cancelled
            with (patch.object(module.subprocess, 'Popen', side_effect=AssertionError('No abandoned child')),
                    self.assertRaises(kind)):
                self.transport(self.url, 'original-key', self.body, deadline, owned=owned)
        self.assertEqual(self.credentials, [], 'Preflight interruption precedes credential resolution')

    def test_ownership_loss_during_response_stops_actual_child_and_socket(self):
        self.stall = True
        with self.assertRaisesRegex(InterruptedError, 'Progress HTTP ownership ended'):
            self.call(owned=lambda: not self.received.is_set())
        self.assertTrue(self.closed.wait(2), 'Ownership loss closes the real callback response socket')

    def test_cancellation_during_response_stops_actual_child_and_socket(self):
        self.stall = True
        self.transport.policy.cancelled = self.received.is_set
        with self.assertRaisesRegex(InterruptedError, 'Source transport cancelled'):
            self.call()
        self.assertTrue(self.closed.wait(2), 'Cancellation closes the real callback response socket')

    def test_deadline_stops_stalled_response_without_partial_acknowledgement(self):
        self.stall = True
        original_clock = time.monotonic
        deadline = original_clock()+120
        def expired_after_headers():
            return deadline+1 if self.received.is_set() else original_clock()
        with (patch.object(module.time, 'monotonic', new=expired_after_headers),
                self.assertRaises(TimeoutError)):
            self.transport(self.url, 'original-key', self.body, deadline, owned=lambda: True)
        self.assertTrue(self.closed.wait(2), 'The stalled callback child releases its actual socket')

    def test_short_and_oversized_response_cannot_be_confirmed(self):
        self.declared = len(self.reply)+1
        with self.assertRaisesRegex(ValueError, 'Progress HTTP child did not complete'):
            self.call()
        self.declared = None; self.reply = b'x'*(module.REPLY_LIMIT+1)
        with self.assertRaisesRegex(ValueError, 'Progress HTTP child did not complete'):
            self.call()

    def test_changed_endpoint_reference_body_and_credential_refuse_before_network(self):
        with self.assertRaisesRegex(ValueError, 'Progress HTTP original endpoint or credential reference differs'):
            self.transport(self.url+'/other', 'original-key', self.body, time.monotonic()+4, owned=lambda: True)
        with self.assertRaisesRegex(ValueError, 'Progress HTTP original endpoint or credential reference differs'):
            self.transport(self.url, 'other-key', self.body, time.monotonic()+4, owned=lambda: True)
        with self.assertRaisesRegex(ValueError, 'Progress HTTP exact body bytes exceed their bound'):
            self.transport(self.url, 'original-key', b'x'*(module.BODY_LIMIT+1), time.monotonic()+4, owned=lambda: True)
        self.transport.credentials = lambda _: 'bad\r\nsecret'
        with self.assertRaisesRegex(ValueError, 'Progress HTTP credential value differs'):
            self.call()
        def failed_resolution(_):
            raise RuntimeError('synthetic private provider detail')
        self.transport.credentials = failed_resolution
        with self.assertRaisesRegex(ValueError, '^Progress HTTP credential resolution failed$'):
            self.call()
        self.assertEqual(self.requests, [], 'Invalid original transport scope reaches no endpoint')

    def test_private_address_requires_explicit_policy(self):
        self.transport.policy.networks = ()
        with self.assertRaisesRegex(ValueError, 'Progress HTTP child did not complete'):
            self.call()
        self.assertEqual(self.requests, [], 'Unapproved private callback address makes no POST')

    def test_nonboolean_owner_and_invalid_constructor_refuse(self):
        for owned in [None, lambda: 1]:
            with self.assertRaisesRegex(ValueError, 'Progress HTTP requires boolean lifetime ownership'):
                self.call(owned=owned)
        for reference, credentials in [('', lambda _: 'token'), ('key', None)]:
            with self.assertRaises(ValueError):
                module.Transport(self.url, reference, credentials,
                    allowed_networks=('127.0.0.1/32',), allowed_ports=(self.server.server_port,))

    def test_invalid_response_envelopes_cannot_become_acknowledgements(self):
        for value in [dict(status=True, bodyBase64=''), dict(status=600, bodyBase64=''),
                dict(status=200, bodyBase64=7), dict(status=200, bodyBase64='bad~~'), dict(status=200, bodyBase64='eA==!!'),
                dict(status=200, bodyBase64='', unknown=True),
                dict(status=200, bodyBase64=base64.b64encode(b'x'*(module.REPLY_LIMIT+1)).decode())]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                module.decode_response(json.dumps(value).encode())
        for raw in [b'', b'{"status":200,"bodyBase64":""}'+b' '*module.WIRE_LIMIT,
                b'{"status":200,"status":201,"bodyBase64":""}']:
            with self.subTest(raw=raw[:25]), self.assertRaises(ValueError):
                module.decode_response(raw)


if __name__ == '__main__':
    unittest.main()
