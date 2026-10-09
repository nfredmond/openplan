"""Bounded raw reads and real HTTP checks, without a Storage service claim."""
import hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
import io
import threading
import unittest
from unittest.mock import Mock

from urllib3.exceptions import ProtocolError
import model_storage_readback as readback


class Raw:
    def __init__(self, data):
        self.stream = io.BytesIO(data)
        self.requests = []
    def read(self, amount, *, decode_content):
        assert 0 < amount <= readback.CHUNK_BYTES
        assert decode_content is False
        self.requests.append(amount)
        return self.stream.read(amount)


class Response:
    def __init__(self, data, status=200, headers=None):
        self.raw, self.status_code, self.headers = Raw(data), status, headers or {}
        self.closed = False
    def __enter__(self): return self
    def __exit__(self, *args): self.closed = True
    @property
    def content(self): raise AssertionError('Whole response buffering forbidden')


class ReadbackTests(unittest.TestCase):
    def setUp(self):
        self.data = b'abcd' * (readback.CHUNK_BYTES // 2 + 3)
        self.args = dict(base_url='http://127.0.0.1:54321', service_key='synthetic', bucket='run-artifacts',
                         object_path='run/source file.gz', sha256=hashlib.sha256(self.data).hexdigest(), size_bytes=len(self.data))
    def run_read(self, response):
        get = Mock(return_value=response)
        result = readback.verify_object(**self.args, get=get)
        self.assertTrue(response.closed)
        self.assertEqual(get.call_args.kwargs['stream'], True)
        self.assertFalse(get.call_args.kwargs['allow_redirects'])
        self.assertEqual(get.call_args.kwargs['headers']['Accept-Encoding'], 'identity')
        return result
    def test_exact_bytes_use_bounded_raw_reads(self):
        response = Response(self.data)
        self.assertTrue(self.run_read(response))
        self.assertGreater(len(response.raw.requests), 2)
    def test_absence_is_distinct_from_refused_status(self):
        self.assertFalse(self.run_read(Response(b'', 404)))
        for status in (301, 302, 403, 500, 206):
            response = Response(self.data, status)
            with self.subTest(status=status), self.assertRaisesRegex(readback.ObjectReadbackUnconfirmed, 'status'):
                self.run_read(response)
            self.assertTrue(response.closed)
    def test_wrong_truncated_and_excess_bytes_refuse(self):
        for data in (b'x'*len(self.data), self.data[:-1], self.data+b'x'):
            response = Response(data)
            with self.assertRaises(readback.ObjectReadbackUnconfirmed): self.run_read(response)
            self.assertTrue(response.closed)
    def test_encoding_and_length_refuse_before_body_read(self):
        for headers in ({'Content-Encoding':'gzip'}, {'Content-Length':'bogus'}, {'Content-Length':'1'}):
            response = Response(self.data, headers=headers)
            with self.assertRaises(readback.ObjectReadbackUnconfirmed): self.run_read(response)
            self.assertEqual(response.raw.requests, [])
    def test_interrupted_raw_stream_closes_response_and_refuses(self):
        response = Response(self.data)
        response.raw.read = Mock(side_effect=ProtocolError('synthetic truncated transport'))
        with self.assertRaisesRegex(readback.ObjectReadbackUnconfirmed, 'interrupted'):
            self.run_read(response)
        self.assertTrue(response.closed)

    def test_harmless_header_does_not_change_verification(self):
        self.assertTrue(self.run_read(Response(self.data, headers={'X-Synthetic-Note':'harmless'})))

    def test_invalid_identity_refuses_before_transport(self):
        for key, value in [('size_bytes',True), ('sha256','f'), ('object_path','a/../b'), ('base_url','https://user:secret@example.com')]:
            get = Mock()
            with self.subTest(key=key), self.assertRaises(ValueError):
                readback.verify_object(**{**self.args, key:value}, get=get)
            get.assert_not_called()
    def test_real_http_preserves_encoded_path_and_detects_payload(self):
        owner = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_GET(self):
                owner.assertEqual(self.path, '/storage/v1/object/authenticated/run-artifacts/run/source%20file.gz')
                owner.assertEqual(self.headers['Accept-Encoding'], 'identity')
                self.send_response(200)
                self.send_header('Content-Length', str(len(owner.data)))
                self.end_headers()
                self.wfile.write(owner.data)
        server = HTTPServer(('127.0.0.1',0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            args = {**self.args, 'base_url':'http://127.0.0.1:'+str(server.server_port)}
            self.assertTrue(readback.verify_object(**args))
        finally:
            server.shutdown(); thread.join(timeout=5); server.server_close()


if __name__ == '__main__': unittest.main()
