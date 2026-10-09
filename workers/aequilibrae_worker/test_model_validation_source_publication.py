"""Full declared source sets through the actual resumable client and a fake peer."""
import base64
import hashlib
import json
from pathlib import Path
import unittest
from urllib.parse import unquote

import model_validation_source_publication as publication
from model_storage_resumable import UploadUnconfirmed
import test_model_validation_source_files as source_tests
from test_model_storage_resumable import Peer
from test_model_storage_readback import Response


class MultiPeer:
    def __init__(self):
        self.sessions, self.objects, self.creations = {}, {}, []
        self.lose_once = False
    def request(self, method, url, **kwargs):
        if method == 'GET':
            name = unquote(url.split('/authenticated/run-artifacts/', 1)[1])
            return Response(self.objects.get(name,b''), 200 if name in self.objects else 404)
        if method == 'POST':
            metadata = dict(part.split(' ',1) for part in kwargs['headers']['Upload-Metadata'].split(','))
            name = base64.b64decode(metadata['objectName']).decode()
            peer = Peer()
            peer.location = url + '/session-' + str(len(self.sessions))
            self.sessions[peer.location] = (name, peer)
            self.creations.append(name)
            return peer.request(method, url, **kwargs)
        name, peer = self.sessions[url]
        if method == 'PATCH' and self.lose_once:
            peer.lose_patch = True; self.lose_once = False
        try:
            return peer.request(method, url, **kwargs)
        finally:
            if peer.complete: self.objects[name] = bytes(peer.data)


class PublicationTests(unittest.TestCase):
    setUp = source_tests.SourceFilesTests.setUp
    retain = source_tests.SourceFilesTests.retain

    def prepare(self):
        self.retained = self.retain()
        self.peer = MultiPeer()
        self.publish_args = dict(retained=self.retained, expected_context=self.args['context'],
                                 state_dir=self.root/'publication', base_url='http://127.0.0.1:54321',
                                 service_key='synthetic', request=self.peer.request)

    def test_complete_set_keeps_manifest_bytes_and_publishes_it_last(self):
        self.prepare()
        result = publication.publish(**self.publish_args)
        manifest = Path(self.retained['manifest_path']).read_bytes()
        catalog = json.loads(manifest)
        unique = {entry['artifact']['sha256'] for entry in catalog['entries']}
        self.assertEqual(result['object_count'], len(unique))
        self.assertEqual(len(self.peer.objects), len(unique) + 1)
        self.assertEqual(result['role_count'], 23)
        name = result['manifest_uri'].removeprefix('storage://run-artifacts/')
        self.assertEqual(self.peer.creations[-1], name)
        self.assertEqual(self.peer.objects[name], manifest)
        self.assertEqual(result['publication_state'], 'remote_verified')
        self.assertEqual(catalog['publication_state'], 'retained_locally')
        self.assertEqual(result['scientific_acceptance'], 'unassessed')
        for entry in catalog['entries']:
            data = self.peer.objects[name.removesuffix('manifest.json') + entry['object_name']]
            self.assertEqual(hashlib.sha256(data).hexdigest(), entry['artifact']['sha256'])
        before = list(self.peer.creations)
        self.assertEqual(publication.publish(**self.publish_args), result)
        self.assertEqual(self.peer.creations, before)

    def test_interrupted_object_leaves_manifest_absent_then_recovers(self):
        self.prepare(); self.peer.lose_once = True
        with self.assertRaises(UploadUnconfirmed): publication.publish(**self.publish_args)
        self.assertFalse(any(name.endswith('/manifest.json') for name in self.peer.objects))
        first = self.peer.creations[0]
        result = publication.publish(**self.publish_args)
        self.assertEqual(self.peer.creations.count(first), 1)
        self.assertTrue(result['manifest_uri'].endswith('/manifest.json'))

    def test_changed_context_and_manifest_hash_refuse_before_upload(self):
        self.prepare()
        context = {**self.args['context'], 'method':'activitysim'}
        with self.assertRaisesRegex(ValueError, 'context differs'):
            publication.publish(**{**self.publish_args, 'expected_context':context})
        Path(self.retained['manifest_path']).write_bytes(b'x'*self.retained['manifest_size_bytes'])
        with self.assertRaisesRegex(ValueError, 'document bytes differ'):
            publication.publish(**self.publish_args)
        self.assertEqual(self.peer.creations, [])

    def test_rehashed_catalog_cannot_omit_a_declared_role(self):
        self.prepare()
        path = Path(self.retained['manifest_path'])
        catalog = json.loads(path.read_bytes())
        catalog['entries'] = [e for e in catalog['entries'] if e['role'] != '/match_audit/network_sha256']
        content = json.dumps(catalog).encode(); path.write_bytes(content)
        self.retained.update(manifest_sha256=hashlib.sha256(content).hexdigest(), manifest_size_bytes=len(content))
        with self.assertRaisesRegex(ValueError, 'missing binding'): publication.publish(**self.publish_args)
        self.assertEqual(self.peer.creations, [])

    def test_rehashed_catalog_cannot_change_evidence_phase(self):
        self.prepare()
        path = Path(self.retained['manifest_path'])
        catalog = json.loads(path.read_bytes())
        catalog['entries'][0]['phase'] = 'invented'
        content = json.dumps(catalog).encode(); path.write_bytes(content)
        self.retained.update(manifest_sha256=hashlib.sha256(content).hexdigest(), manifest_size_bytes=len(content))
        with self.assertRaisesRegex(ValueError, 'differs from declared'):
            publication.publish(**self.publish_args)
        self.assertEqual(self.peer.creations, [])

    def test_wrong_object_bytes_never_publish_manifest(self):
        self.prepare()
        catalog = json.loads(Path(self.retained['manifest_path']).read_bytes())
        row = next(e for e in catalog['entries'] if e['role']=='/comparison_basis/model_output_artifact')
        (self.destination/row['object_name']).write_bytes(b'x'*row['artifact']['bytes'])
        with self.assertRaisesRegex(UploadUnconfirmed, 'hash differs'): publication.publish(**self.publish_args)
        self.assertFalse(any(name.endswith('/manifest.json') for name in self.peer.creations))

    def test_publication_state_cannot_switch_destination(self):
        self.prepare(); self.peer.lose_once = True
        with self.assertRaises(UploadUnconfirmed): publication.publish(**self.publish_args)
        count = len(self.peer.creations)
        with self.assertRaisesRegex(ValueError, 'publication identity differs'):
            publication.publish(**{**self.publish_args, 'base_url':'http://127.0.0.1:54322'})
        self.assertEqual(len(self.peer.creations), count)


if __name__ == '__main__': unittest.main()
