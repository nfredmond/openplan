"""Retained TUS state against a deterministic protocol peer, not native Storage."""
import hashlib
import fcntl
import json
from pathlib import Path
import tempfile
import unittest

import requests
import model_storage_resumable as upload
from test_model_storage_readback import Response


class Peer:
    def __init__(self):
        self.data = bytearray()
        self.complete = False
        self.length = None
        self.location = 'http://127.0.0.1:54321/storage/v1/upload/resumable/session-1'
        self.calls = []
        self.lose_patch = False
        self.wrong_offset = False
        self.corrupt = False
        self.lose_create = False
    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        assert kwargs['stream'] is True and kwargs['allow_redirects'] is False
        if method == 'GET':
            data = bytes(self.data)
            if self.corrupt and data: data = b'x' + data[1:]
            return Response(data, 200 if self.complete else 404)
        headers = kwargs['headers']
        assert headers['Tus-Resumable'] == '1.0.0'
        assert headers['x-upsert'] == 'false'
        reply = {'Tus-Resumable':'1.0.0'}
        if method == 'POST':
            assert kwargs['data'] == b''
            self.length = int(headers['Upload-Length'])
            self.complete = self.length == 0
            if self.lose_create:
                self.lose_create = False
                raise requests.Timeout('lost creation response')
            return Response(b'', 201, {**reply, 'Location':self.location})
        assert url == self.location
        if method == 'HEAD':
            return Response(b'', 200, {**reply, 'Upload-Offset':str(len(self.data)), 'Upload-Length':str(self.length)})
        assert method == 'PATCH'
        assert int(headers['Upload-Offset']) == len(self.data)
        assert 0 < len(kwargs['data']) <= upload.CHUNK_BYTES
        self.data.extend(kwargs['data'])
        self.complete = len(self.data) == self.length
        if self.lose_patch:
            self.lose_patch = False
            raise requests.Timeout('lost chunk response after commit')
        return Response(b'', 204, {**reply, 'Upload-Offset':str(len(self.data) + int(self.wrong_offset))})


class UploadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source.dat'
        self.content = b'a' * (upload.CHUNK_BYTES + 17)
        self.source.write_bytes(self.content)
        self.peer = Peer()
        self.args = dict(source=self.source, state_dir=self.root/'state', base_url='http://127.0.0.1:54321',
                         service_key='not-retained-secret', bucket='run-artifacts', object_path='run/sha256/source',
                         sha256=hashlib.sha256(self.content).hexdigest(), size_bytes=len(self.content), request=self.peer.request)
    def state(self): return json.loads((self.root/'state/upload.json').read_text())
    def test_complete_upload_and_repeated_readback_do_not_reupload(self):
        uri = upload.upload_file(**self.args)
        self.assertEqual(uri, 'storage://run-artifacts/run/sha256/source')
        self.assertEqual(bytes(self.peer.data), self.content)
        self.assertEqual(self.state()['status'], 'verified')
        self.assertNotIn('not-retained-secret', (self.root/'state/upload.json').read_text())
        self.assertEqual([m for m,_,_ in self.peer.calls], ['GET','POST','HEAD','PATCH','PATCH','GET'])
        self.peer.calls.clear()
        self.assertEqual(upload.upload_file(**self.args), uri)
        self.assertEqual([m for m,_,_ in self.peer.calls], ['GET'])
    def test_lost_chunk_reply_resumes_at_server_offset(self):
        self.peer.lose_patch = True
        with self.assertRaises(upload.UploadUnconfirmed): upload.upload_file(**self.args)
        self.assertEqual(self.state()['offset'], 0)
        self.assertEqual(len(self.peer.data), upload.CHUNK_BYTES)
        self.peer.calls.clear()
        upload.upload_file(**self.args)
        patches = [kwargs for method,_,kwargs in self.peer.calls if method == 'PATCH']
        self.assertEqual(len(patches), 1)
        self.assertEqual(patches[0]['headers']['Upload-Offset'], str(upload.CHUNK_BYTES))
        self.assertEqual(patches[0]['data'], self.content[upload.CHUNK_BYTES:])
        self.assertEqual(self.state()['status'], 'verified')
    def test_lost_creation_reply_preserves_intent_and_can_create_empty_session(self):
        self.peer.lose_create = True
        with self.assertRaises(upload.UploadUnconfirmed): upload.upload_file(**self.args)
        self.assertIsNone(self.state()['upload_url'])
        self.assertEqual(self.peer.data, b'')
        upload.upload_file(**self.args)
        self.assertEqual(self.state()['status'], 'verified')
    def test_changed_local_source_refused_before_network(self):
        self.source.write_bytes(b'b'*len(self.content))
        with self.assertRaisesRegex(upload.UploadUnconfirmed, 'hash differs'): upload.upload_file(**self.args)
        self.assertEqual(self.peer.calls, [])
    def test_saved_identity_cannot_be_repurposed(self):
        self.peer.lose_patch = True
        with self.assertRaises(upload.UploadUnconfirmed): upload.upload_file(**self.args)
        self.peer.calls.clear()
        with self.assertRaisesRegex(upload.UploadUnconfirmed, 'identity differs'):
            upload.upload_file(**{**self.args, 'object_path':'another/object'})
        self.assertEqual(self.peer.calls, [])
    def test_foreign_upload_location_refused_before_head_or_patch(self):
        self.peer.location = 'https://other.example/storage/v1/upload/resumable/session-1'
        with self.assertRaisesRegex(upload.UploadUnconfirmed, 'leaves configured'): upload.upload_file(**self.args)
        self.assertEqual([m for m,_,_ in self.peer.calls], ['GET','POST'])
    def test_wrong_offset_and_wrong_final_bytes_never_mark_verified(self):
        self.peer.wrong_offset = True
        with self.assertRaisesRegex(upload.UploadUnconfirmed, 'exact uploaded'): upload.upload_file(**self.args)
        self.assertNotEqual(self.state()['status'], 'verified')
        self.peer.wrong_offset = False; self.peer.corrupt = True
        with self.assertRaises(upload.UploadUnconfirmed): upload.upload_file(**self.args)
        self.assertNotEqual(self.state()['status'], 'verified')
    def test_lost_final_reply_recovers_by_readback_without_more_patch(self):
        def request(method, url, **kwargs):
            response = self.peer.request(method, url, **kwargs)
            if method == 'PATCH' and self.peer.complete:
                raise requests.Timeout('lost final reply')
            return response
        with self.assertRaises(upload.UploadUnconfirmed):
            upload.upload_file(**{**self.args, 'request':request})
        self.peer.calls.clear()
        upload.upload_file(**self.args)
        self.assertEqual([m for m,_,_ in self.peer.calls], ['GET'])
        self.assertEqual(self.state()['status'], 'verified')

    def test_wrong_protocol_version_refuses_before_payload_upload(self):
        def request(method, url, **kwargs):
            response = self.peer.request(method, url, **kwargs)
            if method == 'HEAD': response.headers['Tus-Resumable'] = '0.0.0'
            return response
        with self.assertRaisesRegex(upload.UploadUnconfirmed, 'protocol response'):
            upload.upload_file(**{**self.args, 'request':request})
        self.assertNotIn('PATCH', [m for m,_,_ in self.peer.calls])

    def test_concurrent_state_owner_refuses_before_network(self):
        (self.root/'state').mkdir()
        with (self.root/'state/upload.lock').open('w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(BlockingIOError): upload.upload_file(**self.args)
        self.assertEqual(self.peer.calls, [])

    def test_harmless_content_type_and_empty_file(self):
        self.source.write_bytes(b'')
        upload.upload_file(**{**self.args, 'sha256':hashlib.sha256(b'').hexdigest(), 'size_bytes':0, 'content_type':'text/plain'})
        self.assertEqual(self.state()['status'], 'verified')
        self.assertNotIn('PATCH', [m for m,_,_ in self.peer.calls])


if __name__ == '__main__': unittest.main()
