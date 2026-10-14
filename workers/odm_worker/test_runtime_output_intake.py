"""Current-access composition with actual loopback archive bytes and private records."""
import copy
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
import threading
import time
import unittest
from unittest.mock import patch
import zipfile

import runtime_output_intake as module
from runtime_observation import Observer
from runtime_admission import Runtime
from runtime_dispatch_custody import Custody
from application_dispatch_reader import Reader
import test_application_draft_authority as application


class Checks(unittest.TestCase):
    def setUp(self):
        self.app = application.Checks()
        self.app.setUp()
        self.addCleanup(self.app.tearDown)
        self.requests = []
        self.status = 200
        self.delay = 0
        self.cancelled = False
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive:
            archive.writestr('odm_orthophoto/ortho.tif', b'Synthetic raster bytes')
            archive.writestr('odm_texturing/model.obj', b'Synthetic mesh bytes')
        self.raw = buffer.getvalue()
        fixture = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_GET(self):
                fixture.requests.append(self.path)
                if self.path == '/task/'+fixture.plan['taskUuid']+'/info':
                    body = json.dumps(fixture.value).encode()
                    status = 200
                elif self.path == '/task/'+fixture.plan['taskUuid']+'/download/all.zip':
                    time.sleep(fixture.delay)
                    body = fixture.raw
                    status = fixture.status
                else:
                    body = b'Unexpected route'
                    status = 404
                self.send_response(status)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.close_server)
        self.app.engine['endpoint'] = 'http://127.0.0.1:'+str(self.server.server_port)
        self.app.authority = application.Authority(self.app.f.reader, self.app.engine, self.app.attest)
        self.app.draft.authorize = self.app.authority
        self.app.advance()
        self.plan = self.app.plan()
        self.root = next(self.app.f.root.glob('preparation-*'))
        self.runtime = self.app.runtime
        self.request_id = self.app.request['requestId']
        self.value = {'uuid': self.plan['taskUuid'], 'name': self.plan['name'],
            'imagesCount': len(self.plan['uploads']), 'options': copy.deepcopy(self.plan['options'])+[
                {'name': name, 'value': True} for name in ('pc-ept', 'cog', 'gltf')],
            'status': {'code': 40}, 'progress': 100, 'processingTime': 1500,
            'dateCreated': 1791869373554}
        self.observer = Observer(self.app.f.reader, lambda reference: None, self.app.attest, timeout=4)
        with self.runtime.owner():
            self.observed = self.observer.observe(self.request_id)
        self.requests.clear()
        self.app.attestations.clear()
        self.intake = self.new_intake()

    def close_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def new_intake(self, **changes):
        options = {'max_archive_bytes': 4096, 'max_expanded_bytes': 4096,
            'max_entries': 10, 'max_directory_bytes': 4096, 'timeout': 4,
            'cancelled': lambda: self.cancelled}
        return module.Intake(self.observer, **{**options, **changes})

    def call(self, intake=None, observation_hash=None):
        with self.runtime.owner():
            return (intake or self.intake).advance(self.request_id,
                observation_hash or self.observed['task']['bodySha256'])

    def source(self):
        receipt = json.loads((self.root/'output-intake/completed.json').read_bytes())
        return self.root/'output-intake'/receipt['objectRelativePath']

    def test_exact_download_custody_checks_current_access_and_grants_nothing(self):
        before = len(self.app.f.calls)
        result = self.call()
        self.assertEqual(len(self.app.f.calls)-before, 5, 'Intake must check current access around download and private publication')
        self.assertEqual(len(self.app.attestations), 2, 'Intake must attest the original engine around actual GET')
        self.assertEqual(self.requests, ['/task/'+self.plan['taskUuid']+'/download/all.zip'])
        self.assertEqual((self.root/'output-archive/archive.zip').read_bytes(), self.raw, 'Original output bytes must remain exact')
        self.assertEqual(result['archive']['archive']['sha256'], hashlib.sha256(self.raw).hexdigest())
        self.assertEqual(len(result['archive']['archive']['members']), 2)
        for key in ('archiveTaskProvenanceVerification', 'requestedDeliverableCompletenessVerification', 'processingQualityVerification'):
            self.assertEqual(result['archive'][key], 'unassessed')
        self.assertIs(result['publicationPermission'], False)
        self.assertIs(result['callbackPermission'], False)

    def test_complete_replay_needs_no_incoming_object_or_engine_contact(self):
        first = self.call()
        self.source().unlink()
        before = len(self.app.f.calls)
        inode = (self.root/'output-archive/archive.zip').stat().st_ino
        self.observer.resolve = lambda reference: self.fail('Complete replay cannot resolve another engine credential')
        replay = self.call()
        self.assertEqual(replay, first)
        self.assertEqual(len(self.requests), 1, 'Complete output replay cannot issue another GET')
        self.assertEqual(len(self.app.f.calls)-before, 3, 'Retained output still needs current access')
        self.assertEqual((self.root/'output-archive/archive.zip').stat().st_ino, inode)

    def test_complete_receipt_with_no_remaining_bytes_refuses_without_refetch(self):
        self.call()
        self.source().unlink()
        (self.root/'output-archive/archive.zip').unlink()
        with self.assertRaisesRegex(ValueError, 'complete output bytes are missing'):
            self.call()
        self.assertEqual(len(self.requests), 1)

    def test_changed_incoming_bytes_refuse_even_when_archive_survives(self):
        self.call()
        self.source().write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'complete output bytes differ'):
            self.call()
        self.assertEqual(len(self.requests), 1)

    def test_missing_complete_receipt_cannot_refetch_a_prepared_archive(self):
        self.call()
        (self.root/'output-intake/completed.json').unlink()
        with self.assertRaisesRegex(ValueError, 'no original byte receipt'):
            self.call()
        self.assertEqual(len(self.requests), 1)

    def test_missing_frozen_plan_refuses_existing_records(self):
        self.call()
        (self.root/'output-intake/plan.json').unlink()
        with self.assertRaisesRegex(ValueError, 'no frozen plan'):
            self.call()
        self.assertEqual(len(self.requests), 1)

    def test_current_revocation_refuses_before_archive_get(self):
        self.app.f.receipt['authorizedNow'] = False
        with self.assertRaisesRegex(PermissionError, 'current application access refused'):
            self.call()
        self.assertEqual(self.requests, [])
        self.assertFalse((self.root/'output-intake').exists())

    def test_revocation_after_get_leaves_no_complete_receipt(self):
        original = self.observer.attest
        calls = []
        def revoke(*args, **kwargs):
            result = original(*args, **kwargs)
            calls.append(result)
            if len(calls) == 2:
                self.app.f.receipt['authorizedNow'] = False
            return result
        self.observer.attest = revoke
        with self.assertRaises(PermissionError):
            self.call()
        self.assertFalse((self.root/'output-intake/completed.json').exists(), 'Revoked download cannot publish a complete byte receipt')
        self.assertFalse((self.root/'output-archive').exists())

    def test_owner_loss_after_hashing_refuses_receipt_publication(self):
        original = module.digest
        def lost(*args, **kwargs):
            result = original(*args, **kwargs)
            self.runtime._owned = False
            return result
        with self.runtime.owner():
            try:
                with patch.object(module, 'digest', lost), self.assertRaisesRegex(ValueError, 'lifetime owner'):
                    self.intake.advance(self.request_id, self.observed['task']['bodySha256'])
            finally:
                self.runtime._owned = True
        self.assertFalse((self.root/'output-intake/completed.json').exists())

    def test_pre_cancellation_and_nonboolean_decision_refuse(self):
        for decision, error, diagnostic in [(True, InterruptedError, 'intake cancelled'), (1, ValueError, 'cancellation must be a boolean')]:
            with self.subTest(decision=decision), self.assertRaisesRegex(error, diagnostic):
                self.call(self.new_intake(cancelled=lambda: decision))
        self.assertEqual(self.requests, [])

    def test_uncompleted_observation_cannot_download(self):
        self.value['status'] = {'code': 30, 'errorMessage': 'Synthetic failure'}
        with self.runtime.owner():
            observed = self.observer.observe(self.request_id)
        self.requests.clear()
        with self.assertRaisesRegex(ValueError, 'retained reported completion'):
            self.call(observation_hash=observed['task']['bodySha256'])
        self.assertEqual(self.requests, [])

    def test_changed_observation_or_limits_cannot_replace_frozen_plan(self):
        self.call()
        self.value['dateCreated'] += 1
        with self.runtime.owner():
            observed = self.observer.observe(self.request_id)
        self.requests.clear()
        with self.assertRaisesRegex(ValueError, 'Existing source custody record differs'):
            self.call(observation_hash=observed['task']['bodySha256'])
        with self.assertRaisesRegex(ValueError, 'Existing source custody record differs'):
            self.call(self.new_intake(max_archive_bytes=8192))
        self.assertEqual(self.requests, [])

    def test_two_unconfirmed_attempts_hold_before_third_get(self):
        self.status = 503
        for _attempt in range(2):
            with self.assertRaisesRegex(ValueError, 'did not complete'):
                self.call()
        with self.assertRaisesRegex(ValueError, 'attempt count reached'):
            self.call()
        self.assertEqual(len(self.requests), 2, 'Unconfirmed attempts must remain bounded before a third GET')
        self.assertFalse((self.root/'output-intake/completed.json').exists())

    def test_unknown_attempt_object_refuses_before_network(self):
        self.call()
        (self.root/'output-intake/objects/unknown.bin').write_bytes(b'x')
        with self.assertRaisesRegex(ValueError, 'unknown attempt object'):
            self.call()
        self.assertEqual(len(self.requests), 1)

    def test_disk_space_refuses_before_archive_get(self):
        with patch.object(module.shutil, 'disk_usage', return_value=shutil._ntuple_diskusage(4096, 4096, 0)), self.assertRaisesRegex(ValueError, 'Insufficient free space'):
            self.call()
        self.assertEqual(self.requests, [])

    def test_exposed_limits_cannot_change_the_frozen_operation_by_alias(self):
        exposed = self.intake.limits
        exposed['max_archive_bytes'] = 1
        self.assertEqual(self.intake.limits['max_archive_bytes'], 4096, 'Original output limits must not retain a mutable exposed alias')
        self.call()

    def test_download_budget_is_not_shortened_to_one_rpc_read_timeout(self):
        self.app.f.reader.timeout = 5
        original = module.Transport
        forwarded = []
        fixture = self
        class RecordedTransport(original):
            def __call__(self, plan, output, max_bytes, deadline, *, owned):
                remaining = deadline-time.monotonic()
                fixture.assertGreater(remaining, fixture.app.f.reader.timeout,
                    'Whole archive download must retain its stage budget beyond one RPC read')
                forwarded.append(remaining)
                return super().__call__(plan, output, max_bytes, deadline, owned=owned)
        with patch.object(module, 'Transport', RecordedTransport):
            result = self.call(self.new_intake(timeout=120))
        self.assertEqual(len(forwarded), 1, 'Budget probe must delegate one actual original transfer')
        self.assertEqual(result['archive']['archive']['sha256'], hashlib.sha256(self.raw).hexdigest(), 'Configured output budget must preserve actual original bytes')

    def interrupted_child(self, boundary):
        """Exit a separate owned process after durable bytes, then release its locks."""
        config = self.app.f.root.parent/'output-child-context.json'
        config.write_text(json.dumps({'root': str(self.runtime.root),
            'installationId': self.runtime.installation['installationId'],
            'targetId': self.app.f.custody.target, 'receipt': self.app.f.receipt,
            'requestId': self.request_id, 'observationHash': self.observed['task']['bodySha256']}))
        config.chmod(0o600)
        result = subprocess.run([sys.executable, '-B', str(Path(__file__).resolve()),
            '--owned-child', str(config), boundary], capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 44, 'Owned process must interrupt only at the intended durable boundary')

    def test_lost_complete_receipt_reply_recovers_without_another_get(self):
        self.interrupted_child('receipt')
        self.assertTrue((self.root/'output-intake/completed.json').exists())
        self.assertFalse((self.root/'output-archive').exists())
        result = self.call()
        self.assertEqual(result['archive']['archive']['sha256'], hashlib.sha256(self.raw).hexdigest())
        self.assertEqual(len(self.requests), 1, 'Lost complete receipt reply must recover saved bytes without refetch')

    def test_link_interruption_recovers_without_incoming_bytes(self):
        self.interrupted_child('link')
        self.assertEqual((self.root/'output-archive/archive.zip').stat().st_nlink, 2)
        self.source().unlink()
        result = self.call()
        self.assertEqual((self.root/'output-archive/archive.zip').stat().st_nlink, 1, 'Interrupted archive publication alias must be removed')
        self.assertEqual(result['archive']['archive']['sha256'], hashlib.sha256(self.raw).hexdigest())
        self.assertEqual(len(self.requests), 1, 'Interrupted archive linking must recover without original incoming bytes or another GET')

    def test_copied_runtime_keeps_original_output_under_current_access(self):
        first = self.call()
        copied = self.app.f.root.parent/'copied-runtime'
        shutil.copytree(self.runtime.root, copied)
        shutil.rmtree(next(copied.glob('preparation-*'))/'output-intake/objects')
        runtime = Runtime(copied, self.runtime.installation['installationId'], max_queued=2, pipeline=lambda job: None)
        reader = Reader(Custody(runtime, self.app.f.custody.target, timeout=4), self.app.f.transport, timeout=4)
        observer = Observer(reader, lambda reference: self.fail('Copied output cannot resolve another engine credential'), self.app.attest, timeout=4)
        intake = module.Intake(observer, max_archive_bytes=4096, max_expanded_bytes=4096, max_entries=10, max_directory_bytes=4096, timeout=4)
        with runtime.owner():
            result = intake.advance(self.request_id, self.observed['task']['bodySha256'])
        self.assertEqual(result, first, 'Copied original output must preserve its original receipt under current access')
        self.assertEqual(len(self.requests), 1)

    def test_constructor_refuses_adapter_budget_and_timeout_types(self):
        with self.assertRaisesRegex(ValueError, 'current observer'):
            module.Intake(None, max_archive_bytes=4096, max_expanded_bytes=4096)
        for options in ({'cancelled': None}, {'timeout': True}, {'timeout': 0}, {'timeout': float('nan')},
                        {'max_archive_bytes': True}, {'max_expanded_bytes': 0}, {'max_entries': -1},
                        {'max_directory_bytes': 'many'}, {'max_archive_bytes': 2**63-1}):
            with self.subTest(options=options), self.assertRaises(ValueError):
                self.new_intake(**options)

    def test_complete_receipt_shape_is_not_inferred_from_surviving_bytes(self):
        self.call()
        path = self.root/'output-intake/completed.json'
        original = path.read_bytes()
        for fields in ({'format': 'other'}, {'planSha256': '0'*64}, {'bytes': True},
                       {'sha256': 'invalid'}, {'objectRelativePath': '../outside.bin'}, {'extra': True}):
            try:
                path.write_bytes(module.json_bytes({**json.loads(original), **fields}))
                with self.subTest(fields=fields), self.assertRaisesRegex(ValueError, 'complete output receipt differs'):
                    self.call()
            finally:
                path.write_bytes(original)
        self.assertEqual(len(self.requests), 1)

    def test_saved_attempt_storage_cannot_exceed_bytes_or_object_limits(self):
        self.call()
        objects = self.root/'output-intake/objects'
        left = objects/('archive-'+'a'*32+'.bin')
        right = objects/('archive-'+'b'*32+'.bin')
        left.write_bytes(b'x'*8192)
        left.chmod(0o600)
        with self.assertRaisesRegex(ValueError, 'attempts exceed the frozen storage limit'):
            self.call()
        left.write_bytes(b'')
        right.write_bytes(b'')
        right.chmod(0o600)
        with self.assertRaisesRegex(ValueError, 'attempts exceed the frozen storage limit'):
            self.call()
        self.assertEqual(len(self.requests), 1)

    def test_wrong_download_count_cannot_publish_a_complete_receipt(self):
        fixture = self
        class WrongCount:
            def __init__(self, *args, **kwargs):
                pass

            def __call__(self, plan, output, remaining, deadline, *, owned):
                output.write(fixture.raw)
                return len(fixture.raw)+1
        with patch.object(module, 'Transport', WrongCount), self.assertRaisesRegex(ValueError, 'count differs from written bytes'):
            self.call()
        self.assertFalse((self.root/'output-intake/completed.json').exists())

    def test_changed_stored_size_before_hashing_cannot_publish_receipt(self):
        original = module.digest
        altered = []
        def changed(root, name, *args, **kwargs):
            if not altered:
                replacement = io.BytesIO()
                with zipfile.ZipFile(replacement, 'w') as archive:
                    archive.writestr('odm_orthophoto/ortho.tif', b'Synthetic raster bytes')
                    archive.writestr('odm_texturing/model.obj', b'Synthetic mesh bytes')
                    archive.writestr('changed.txt', b'Changed after network confirmation')
                (root/name).write_bytes(replacement.getvalue())
                altered.append(True)
            return original(root, name, *args, **kwargs)
        with patch.object(module, 'digest', changed), self.assertRaisesRegex(ValueError, 'stored byte count differs'):
            self.call()
        self.assertFalse((self.root/'output-intake/completed.json').exists())

    def test_exhausted_byte_budget_does_not_create_another_attempt(self):
        self.status = 503
        with self.assertRaises(ValueError):
            self.call()
        objects = self.root/'output-intake/objects'
        next(objects.iterdir()).write_bytes(b'x'*8192)
        with self.assertRaises(ValueError):
            self.call()
        self.assertEqual(len(list(objects.iterdir())), 1, 'Exhausted output storage must not create another attempt')
        self.assertEqual(len(self.requests), 1)

    def test_retained_archive_summary_must_match_original_download_receipt(self):
        original = module.retain
        def wrong(*args, **kwargs):
            result = original(*args, **kwargs)
            result['archive']['sha256'] = '0'*64
            return result
        with patch.object(module, 'retain', wrong), self.assertRaisesRegex(ValueError, 'archive differs from its original download'):
            self.call()


def owned_child(config_path, boundary):
    """Use supplied RPC receipts and the parent's actual loopback engine server."""
    config = json.loads(Path(config_path).read_bytes())
    runtime = Runtime(Path(config['root']), config['installationId'], max_queued=2, pipeline=lambda job: None)
    reader = Reader(Custody(runtime, config['targetId'], timeout=4),
        lambda arguments, deadline, owned: json.dumps(config['receipt']).encode(), timeout=4)
    observer = Observer(reader, lambda reference: None, lambda engine, deadline, owned: owned(), timeout=4)
    intake = module.Intake(observer, max_archive_bytes=4096, max_expanded_bytes=4096,
        max_entries=10, max_directory_bytes=4096, timeout=4)
    if boundary == 'receipt':
        original = module.publish
        def lost(root, name, payload, **options):
            original(root, name, payload, **options)
            if name == 'completed.json':
                os._exit(44)
        module.publish = lost
    elif boundary == 'link':
        original = os.link
        def lost(source, destination, **options):
            original(source, destination, **options)
            if str(destination).endswith('/archive.zip'):
                os._exit(44)
        os.link = lost
    else:
        raise ValueError('Unknown owned output interruption')
    with runtime.owner():
        intake.advance(config['requestId'], config['observationHash'])
    return 46


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == '--owned-child':
        sys.exit(owned_child(sys.argv[2], sys.argv[3]))
    unittest.main()
