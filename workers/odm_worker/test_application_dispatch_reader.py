"""Private receipt validation with owned admissions and supplied RPC responses.

Transport and installed database behavior have their own separate proofs.
"""
import copy
from dataclasses import replace
import hashlib
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
import uuid

import application_dispatch_reader as module
from application_dispatch_reader import Reader
from runtime_admission import Runtime
from runtime_dispatch_custody import Custody


class Checks(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='odm-application-dispatch-')
        self.root = Path(self.temporary.name) / 'runtime';self.root.mkdir(mode=0o700)
        actor, workspace, mission, job = [str(uuid.uuid4()) for _ in range(4)]
        self.request = {'schemaVersion': 'natford-aerial-processing.v1', 'requestId': 'synthetic-original-request',
            'callbackUrl': 'http://127.0.0.1:1/callback?synthetic=private', 'missionTitle': 'Original étude près du métro',
            'externalRef': {'system': 'openplan', 'workspaceId': workspace, 'missionId': mission},
            'imagery': {'type': 'zip_url', 'url': 'http://127.0.0.1:1/original.zip?synthetic=private'}}
        self.payload = json.dumps(self.request, ensure_ascii=False, indent=2) + '\n'
        self.row = {'id': job, 'request_id': self.request['requestId'], 'workspace_id': workspace,
            'mission_id': mission, 'project_id': None, 'created_by': actor, 'preset_id': 'balanced', 'imagery_type': 'zip_url'}
        self.runtime = Runtime(self.root, 'synthetic-installation', max_queued=2, pipeline=lambda job: None)
        self.runtime.submit(self.request)
        self.custody = Custody(self.runtime, 'synthetic-target', timeout=4)
        self.receipt = {'format': module.FORMAT, 'installationId': 'synthetic-installation', 'targetId': 'synthetic-target',
            'applicationJob': self.row, 'payloadText': self.payload, 'payloadBytes': len(self.payload.encode()),
            'payloadSha256': hashlib.sha256(self.payload.encode()).hexdigest(), 'authorizedNow': True,
            'authorityObservedAt': '2026-10-12T00:00:00.123456+00:00', 'engineTransportPermission': False}
        self.calls = []
        def transport(arguments, deadline, *, owned=None):
            self.calls.append((copy.deepcopy(arguments), deadline, callable(owned) and owned()));return json.dumps(self.receipt, ensure_ascii=False).encode()
        self.transport = transport
        self.reader = Reader(self.custody, transport)

    def tearDown(self):
        self.temporary.cleanup()

    def started(self):
        entry = self.runtime.journal.get(self.request['requestId'])
        return self.runtime.journal.start(entry.request['requestId'], entry.job_reference, self.runtime.context)[0]

    def capture(self):
        with self.runtime.owner():
            return self.reader.capture(self.started())

    def test_exact_original_and_fixed_rpc_scope_reach_capture(self):
        payload, row = self.capture()
        self.assertEqual(payload, self.payload.encode(), 'Private reader must preserve exact UTF-8 original bytes')
        self.assertEqual(row, self.row, 'Private reader must preserve all eight original job fields')
        self.assertEqual(self.calls[0][0], {'p_request': self.request['requestId'], 'p_installation': 'synthetic-installation', 'p_target': 'synthetic-target'}, 'Private read must bind the operator installation and target')
        self.assertIs(self.calls[0][2], True, 'Private transport must receive the current runtime ownership adapter')
        row['created_by'] = 'changed alias'
        self.assertNotEqual(row, self.row, 'Decoded projection must not change the provider fixture')

    def test_constructor_requires_custody_adapter_and_finite_timeout(self):
        for dispatch, transport, timeout in [(None, self.transport, 1), (self.custody, None, 1), (self.custody, self.transport, False), (self.custody, self.transport, float('nan')), (self.custody, self.transport, 0)]:
            with self.subTest(timeout=timeout), self.assertRaises(ValueError):
                Reader(dispatch, transport, timeout=timeout)

    def test_owner_and_original_start_precede_transport(self):
        with self.assertRaisesRegex(ValueError, '^Runtime preparation requires its lifetime owner$'):
            self.reader.capture(self.runtime.journal.get(self.request['requestId']))
        with self.runtime.owner(), self.assertRaisesRegex(ValueError, '^Original owned start is required before preparation$'):
            self.reader.capture(self.runtime.journal.get(self.request['requestId']))
        self.assertEqual(self.calls, [], 'Unowned or unstarted capture must not read private RPC')

    def test_changed_admission_refuses_before_transport(self):
        with self.runtime.owner():
            entry = self.started()
            changed = replace(entry, started_context={**entry.started_context, 'changed': True})
            with self.assertRaisesRegex(ValueError, '^Private application dispatch original admission differs$'):
                self.reader.capture(changed)
        self.assertEqual(self.calls, [], 'Changed admission must not reach transport')

    def test_shared_deadline_clamps_before_transport(self):
        with self.runtime.owner():
            entry = self.started()
            with self.assertRaisesRegex(TimeoutError, '^Original dispatch deadline exceeded$'):
                self.reader.capture(entry, deadline=time.monotonic() - 1)
        self.assertEqual(self.calls, [], 'Expired outer deadline must prevent private read')

    def test_invalid_deadline_refuses_before_transport(self):
        with self.runtime.owner():
            entry = self.started()
            for deadline in (True, float('nan'), float('inf')):
                with self.subTest(deadline=deadline), self.assertRaisesRegex(ValueError, '^Private dispatch read deadline must be finite$'):
                    self.reader.capture(entry, deadline=deadline)
        self.assertEqual(self.calls, [])

    def test_late_response_refuses_before_receipt_validation(self):
        with self.runtime.owner():
            entry = self.started()
            with patch.object(self.custody, '_check', side_effect=[entry, entry, TimeoutError('Actual expired response')]), patch.object(self.reader, '_receipt', side_effect=AssertionError('Late read reached validation')):
                with self.assertRaisesRegex(TimeoutError, '^Actual expired response$'):
                    self.reader.capture(entry)

    def test_wire_bytes_bound_and_type_precede_json_parse(self):
        with self.runtime.owner():
            entry = self.started()
            raw = json.dumps(self.receipt).encode()
            with patch.object(module, 'WIRE_LIMIT', len(raw) - 1):
                for value in (raw, 'text', bytearray(raw), b''):
                    with self.subTest(kind=type(value).__name__), self.assertRaisesRegex(ValueError, '^Private application dispatch receipt bytes differ$'):
                        self.reader._receipt(entry, value)

    def test_duplicate_nonfinite_and_invalid_utf8_json_refuse(self):
        raw = json.dumps(self.receipt).encode()
        bad = [raw[:-1] + b',"authorizedNow":true}', raw.replace(b'"authorizedNow": true', b'"authorizedNow": NaN'), b'\xff']
        self.reader.transport = lambda *args: bad[0]
        with self.runtime.owner():
            entry = self.started()
            for value in bad:
                with self.subTest(kind=value[:1]), self.assertRaisesRegex(ValueError, '^Private application dispatch receipt JSON differs$'):
                    self.reader._receipt(entry, value)

    def test_scope_format_fields_and_flags_refuse(self):
        variants = [{**self.receipt, 'installationId': 'other'}, {**self.receipt, 'targetId': 'other'},
            {**self.receipt, 'format': 'other'}, {**self.receipt, 'engineTransportPermission': True},
            {**self.receipt, 'engineTransportPermission': 0}, {**self.receipt, 'authorizedNow': 1}, {**self.receipt, 'extra': True}]
        with self.runtime.owner():
            entry = self.started()
            for value in variants:
                with self.subTest(value=list(value)), self.assertRaisesRegex(ValueError, '^Private application dispatch receipt scope differs$'):
                    self.reader._receipt(entry, json.dumps(value).encode())

    def test_observation_timestamp_requires_valid_offset_time(self):
        with self.runtime.owner():
            entry = self.started()
            for value in ('2026-10-12 00:00:00+00:00', 'missing', '2026-10-12T00:00:00', '2026-02-31T00:00:00Z', '2026-10-12T00:00:00+25:00', None):
                with self.subTest(value=value), self.assertRaisesRegex(ValueError, '^Private application dispatch observation time differs$'):
                    self.reader._receipt(entry, json.dumps({**self.receipt, 'authorityObservedAt': value}).encode())

    def test_exact_job_projection_and_canonical_uuid_are_required(self):
        with self.runtime.owner():
            entry = self.started()
            with self.assertRaisesRegex(ValueError, '^Private application dispatch job identity differs$'):
                self.reader._receipt(entry, json.dumps({**self.receipt, 'applicationJob': {**self.row, 'id': 'different'}}).encode())
            with self.assertRaisesRegex(ValueError, '^Private application dispatch job projection differs$'):
                self.reader._receipt(entry, json.dumps({**self.receipt, 'applicationJob': {**self.row, 'extra': True}}).encode())

    def test_original_byte_count_hash_and_encoding_are_verified(self):
        variants = [{**self.receipt, 'payloadSha256': 'a' * 64}, {**self.receipt, 'payloadBytes': True},
            {**self.receipt, 'payloadBytes': 1}, {**self.receipt, 'payloadText': '\ud800'}, {**self.receipt, 'payloadText': None}]
        with self.runtime.owner():
            entry = self.started()
            for value in variants:
                with self.subTest(value=list(value)), self.assertRaisesRegex(ValueError, '^Private application dispatch original bytes differ$'):
                    self.reader._receipt(entry, json.dumps(value).encode())

    def test_full_request_and_admitted_scope_are_independently_validated(self):
        changed = json.dumps({**self.request, 'missionTitle': 'changed'}, ensure_ascii=False)
        self.receipt.update(payloadText=changed, payloadBytes=len(changed.encode()), payloadSha256=hashlib.sha256(changed.encode()).hexdigest())
        with self.assertRaisesRegex(ValueError, '^Original dispatch differs from admitted request$'):
            self.capture()

    def test_revoked_actor_refuses_first_capture_without_source_work(self):
        self.receipt['authorizedNow'] = False
        with self.assertRaisesRegex(PermissionError, '^Private application dispatch actor is no longer authorized$'):
            self.capture()
        self.assertFalse(self.custody.folder(self.request['requestId']).exists(), 'Revoked first capture must not save an original')

    def test_fresh_false_observation_preserves_saved_original_and_false_engine_permission(self):
        with self.runtime.owner():
            entry = self.started()
            payload, row = self.reader.capture(entry)
            self.custody.save(self.request['requestId'], payload, row)
            before = (self.custody.folder(self.request['requestId']) / 'receipt.json').read_bytes()
            self.receipt['authorizedNow'] = False
            observed = self.reader.observe(self.request['requestId'])
            self.assertIs(observed['authorizedNow'], False, 'Fresh revoked observation must remain false')
            self.assertIs(observed['engineTransportPermission'], False, 'Private observation must not permit an engine command')
            self.assertEqual((self.custody.folder(self.request['requestId']) / 'receipt.json').read_bytes(), before, 'Fresh read must preserve saved original bytes')

    def test_changed_original_actor_refuses_observation(self):
        with self.runtime.owner():
            entry = self.started()
            self.custody.save(self.request['requestId'], *self.reader.capture(entry))
            self.receipt['applicationJob'] = {**self.row, 'created_by': str(uuid.uuid4())}
            with self.assertRaisesRegex(ValueError, '^Private application dispatch saved original differs$'):
                self.reader.observe(self.request['requestId'])

    def test_missing_saved_original_refuses_before_fresh_query(self):
        with self.runtime.owner():
            self.started()
            with self.assertRaises(FileNotFoundError):
                self.reader.observe(self.request['requestId'])
        self.assertEqual(self.calls, [], 'Missing original cannot be replaced by another query')


if __name__ == '__main__':
    unittest.main()
