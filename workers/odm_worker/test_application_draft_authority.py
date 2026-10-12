"""Compose actual saved application custody with current draft permission."""
import copy
import io
import json
import time
import unittest
from unittest.mock import patch
import zipfile

import application_draft_authority as module
from application_draft_authority import Authority
from engine_effects import commands
from runtime_dispatch_custody import Pipeline as DispatchPipeline
from runtime_preparation import JOB_FIELDS
from runtime_url_draft import Pipeline as UrlDraft
from runtime_url_intake import Intake
import test_application_dispatch_reader as fixture


class Checks(unittest.TestCase):
    def setUp(self):
        self.f = fixture.Checks();self.f.setUp()
        self.runtime = self.f.runtime;self.request = self.f.request
        self.engine = {'instanceId': 'supplied-original-engine', 'endpoint': 'http://127.0.0.1:1',
            'api': 'nodeodm-2.2.4-draft', 'version': '2.2.4', 'imageId': 'sha256:' + 'a'*64,
            'configurationSha256': 'b'*64, 'credentialReference': 'synthetic-no-secret'}
        self.raw = [b'Synthetic image A', b'Synthetic image B'];buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive:
            for name, raw in zip(('a.jpg', 'b.jpg'), self.raw):archive.writestr(name, raw)
        self.zipped = buffer.getvalue();self.attestations = [];self.sends = [];self.fetches = []
        self.attestation = True
        self.authority = Authority(self.f.reader, self.engine, self.attest)
        settings = {'applicationJob': {key: self.f.row[key] for key in JOB_FIELDS},
            'targetId': self.f.custody.target, 'maxBytes': 4096, 'engine': self.engine,
            'options': [{'name': 'synthetic-option', 'value': True}], 'filenames': None,
            'zipLimits': {'max_expanded_bytes': 4096, 'max_entries': 10, 'max_directory_bytes': 4096}}
        self.intake = Intake(self.runtime, self.f.root.parent/'sources', self.f.custody.target,
            lambda entry: copy.deepcopy(settings), self.fetch, timeout=4)
        self.draft = UrlDraft(self.intake, self.authority, self.send, timeout=4,
            authorize_with_deadline=True)
        self.pipeline = DispatchPipeline(self.draft, self.f.custody, self.f.reader.capture,
            capture_with_deadline=True)

    def tearDown(self):self.f.tearDown()

    def attest(self, engine, deadline, *, owned):
        self.attestations.append((copy.deepcopy(engine), deadline, owned()))
        return self.attestation

    def fetch(self, url, stream, remaining, deadline):
        self.fetches.append(url);stream.write(self.zipped);return len(self.zipped)

    def send(self, engine, command, stream, deadline):
        raw = stream.read() if stream else None
        self.sends.append((copy.deepcopy(engine), copy.deepcopy(command), raw, deadline))
        return (200, json.dumps({'uuid': command['headers']['set-uuid']}).encode()) if stream is None else (200, b'{"success":true}')

    def advance(self):
        with self.runtime.owner():self.f.started();return self.pipeline.advance(self.request['requestId'])

    def plan(self):
        return json.loads(next(self.f.root.glob('preparation-*/engine/plan.json')).read_text())

    def test_actual_pipeline_reads_current_access_before_each_original_command(self):
        self.advance()
        with self.runtime.owner():
            for _ in range(3):last = self.pipeline.advance(self.request['requestId'])
        self.assertEqual(len(self.f.calls), 4, 'Each original draft command must read current access')
        self.assertEqual(len(self.attestations), 3, 'Each original draft command must attest the engine')
        self.assertEqual([row[2] for row in self.sends], [None, *self.raw], 'Only exact original image bytes may reach transport')
        self.assertEqual(len(self.fetches), 1)
        self.assertEqual(last['draft']['state'], 'draft_complete_commit_held')
        self.assertIs(last['commitPermission'], False)
        self.assertFalse(list(self.f.root.glob('preparation-*/engine/command-00003.intent.json')))
        self.assertTrue(all(row[0] == self.engine and row[2] is True for row in self.attestations))
        self.assertTrue(all(gate[1] <= sent[3] for gate, sent in zip(self.attestations, self.sends)), 'Authority must share or shorten the transport deadline')

    def test_revoked_access_refuses_before_upload_intent_and_preserves_original(self):
        self.advance();saved = (self.f.custody.folder(self.request['requestId'])/'receipt.json').read_bytes()
        self.f.receipt['authorizedNow'] = False
        with self.runtime.owner(), self.assertRaisesRegex(PermissionError, '^Explicit draft permission was not confirmed$'):
            self.pipeline.advance(self.request['requestId'])
        self.assertEqual(len(self.sends), 1, 'Revoked access cannot send an upload')
        self.assertEqual(len(self.attestations), 1, 'Revoked access cannot reach engine attestation')
        self.assertFalse(list(self.f.root.glob('preparation-*/engine/command-00001.intent.json')))
        self.assertEqual((self.f.custody.folder(self.request['requestId'])/'receipt.json').read_bytes(), saved)

    def test_engine_refusal_cannot_issue_or_send_next_command(self):
        self.advance();self.attestation = False
        with self.runtime.owner(), self.assertRaises(PermissionError):self.pipeline.advance(self.request['requestId'])
        self.assertEqual(len(self.sends), 1, 'Unattested engine cannot send an upload')
        self.assertFalse(list(self.f.root.glob('preparation-*/engine/command-00001.intent.json')))

    def test_attestation_requires_boolean(self):
        self.advance()
        for value in (1, None, 'yes'):
            self.attestation = value
            with self.runtime.owner(), self.assertRaisesRegex(ValueError, '^Private draft engine attestation must return a boolean$'):
                plan = self.plan();self.authority(plan, 'init', commands(plan)['init'], deadline=time.monotonic()+2)
        self.assertEqual(len(self.sends), 1)

    def test_exact_command_and_commit_refuse_before_private_read(self):
        self.advance();plan = self.plan();before = len(self.f.calls)
        for operation, command in [('commit', commands(plan)['commit']), ('missing', {}),
            ('init', {}), (None, {}), ([], {})]:
            with self.runtime.owner(), self.assertRaisesRegex(ValueError, '^Only the exact original draft command can be authorized$'):
                self.authority(plan, operation, command, deadline=time.monotonic()+2)
        self.assertEqual(len(self.f.calls), before)

    def test_plan_shape_refuses_before_private_read(self):
        self.advance();plan = self.plan();plan['extra'] = True;before = len(self.f.calls)
        with self.runtime.owner(), self.assertRaisesRegex(ValueError, '^Original engine plan shape or source identity differs$'):
            self.authority(plan, 'init', commands(plan)['init'], deadline=time.monotonic()+2)
        self.assertEqual(len(self.f.calls), before)

    def test_engine_changes_refuse_before_private_read(self):
        self.advance();before = len(self.f.calls)
        for key, value in [('instanceId', 'other'), ('endpoint', 'http://127.0.0.1:2'),
            ('imageId', 'sha256:'+'c'*64), ('configurationSha256', 'd'*64), ('credentialReference', 'other')]:
            plan = self.plan();plan['engine'][key] = value
            with self.runtime.owner(), self.assertRaisesRegex(ValueError, '^Private draft engine differs from the configured original$'):
                self.authority(plan, 'init', commands(plan)['init'], deadline=time.monotonic()+2)
        self.assertEqual(len(self.f.calls), before)

    def test_binding_changes_refuse_before_current_read(self):
        self.advance();before = len(self.f.calls)
        for key in ('jobReference', 'originalRequest', 'originalAdmission', 'originalContext'):
            plan = self.plan();binding = plan['binding']
            if isinstance(binding[key], dict):binding[key] = {**binding[key], 'syntheticChanged': True}
            else:binding[key] = 'changed'
            with self.runtime.owner(), self.assertRaisesRegex(ValueError, '^Private draft scope differs from the saved application original$'):
                self.authority(plan, 'init', commands(plan)['init'], deadline=time.monotonic()+2)
        self.assertEqual(len(self.f.calls), before)

    def test_binding_shape_refuses_before_saved_read(self):
        self.advance();before = len(self.f.calls)
        for action in ('extra', 'missing', 'empty'):
            plan = self.plan()
            if action == 'extra':plan['binding']['extra'] = True
            elif action == 'missing':del plan['binding']['requestId']
            else:plan['binding']['requestId'] = ''
            with self.runtime.owner(), self.assertRaisesRegex(ValueError, '^Private draft original binding is required$'):
                self.authority(plan, 'init', commands(plan)['init'], deadline=time.monotonic()+2)
        self.assertEqual(len(self.f.calls), before)

    def test_constructor_requires_reader_attestor_and_engine(self):
        for reader, engine, attest in [(None, self.engine, self.attest), (self.f.reader, self.engine, None),
            (self.f.reader, {}, self.attest)]:
            with self.assertRaises(ValueError):Authority(reader, engine, attest)

    def test_missing_or_invalid_shared_deadline_refuses_before_read(self):
        self.advance();plan = self.plan();before = len(self.f.calls)
        for deadline in (None, False, float('nan'), float('inf')):
            with self.runtime.owner(), self.assertRaises(ValueError):
                self.authority(plan, 'init', commands(plan)['init'], deadline=deadline)
        self.assertEqual(len(self.f.calls), before)

    def test_attestation_receives_detached_engine_and_actual_deadline(self):
        self.advance();plan = self.plan();deadline = time.monotonic()+0.5;observed = []
        def attest(engine, given, *, owned):
            observed.append((copy.deepcopy(engine), given, owned()));engine['instanceId'] = 'changed alias';return True
        self.authority.attest = attest
        with self.runtime.owner():self.assertIs(self.authority(plan, 'init', commands(plan)['init'], deadline=deadline), True)
        self.assertEqual(observed, [(self.engine, deadline, True)], 'Attestation must receive the exact shared deadline and original engine')
        self.assertEqual(self.authority.engine, self.engine, 'Attestation cannot change the configured engine')

    def test_expiry_during_attestation_refuses_before_intent(self):
        self.advance();plan = self.plan();clock = patch('runtime_dispatch_custody.time.monotonic', return_value=1e12)
        def attest(engine, deadline, *, owned):clock.start();return True
        self.authority.attest = attest
        try:
            with self.runtime.owner(), self.assertRaises(TimeoutError):
                self.authority(plan, 'init', commands(plan)['init'], deadline=time.monotonic()+2)
        finally:clock.stop()
        self.assertFalse(list(self.f.root.glob('preparation-*/engine/command-00001.intent.json')))

    def test_owner_loss_after_attestation_refuses(self):
        self.advance();plan = self.plan()
        def attest(engine, deadline, *, owned):self.runtime._owned = False;return True
        self.authority.attest = attest
        with self.runtime.owner(), self.assertRaises(ValueError):
            self.authority(plan, 'init', commands(plan)['init'], deadline=time.monotonic()+2)
        self.assertFalse(list(self.f.root.glob('preparation-*/engine/command-00001.intent.json')))


if __name__ == '__main__':unittest.main()
