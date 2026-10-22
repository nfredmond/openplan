"""Exact progress delivery recovery using original owned dispatch fixtures."""
import copy
import hashlib
import json
import stat
import unittest
from unittest.mock import patch

import runtime_progress_delivery as module
from retained_source import json_bytes
import test_application_dispatch_reader as fixtures


class Checks(unittest.TestCase):
    def setUp(self):
        self.f = fixtures.Checks()
        self.f.setUp()
        self.addCleanup(self.f.tearDown)
        self.request_id = self.f.request['requestId']
        with self.f.runtime.owner():
            entry = self.f.started()
            raw, row = self.f.reader.capture(entry)
            self.f.custody.save(self.request_id, raw, row)
        self.reference = entry.job_reference
        self.payload = {'schemaVersion': self.f.request['schemaVersion'],
            'requestId': self.request_id, 'callbackId': '😀😀😀😀',
            'jobReference': self.reference, 'status': 'running',
            'occurredAt': '2026-10-14T01:00:00.123456789123Z', 'progress': 37,
            'message': 'Retained original étude'}
        self.raw = (json.dumps(self.payload, ensure_ascii=False, indent=2)+'\n').encode()
        self.calls = []
        self.replies = [(200, b'{"ok":true,"status":"running"}')]*4
        def transport(url, credential, body, deadline, *, owned):
            self.calls.append((url, credential, body, deadline, owned()))
            value = self.replies.pop(0)
            if isinstance(value, BaseException):
                raise value
            return value
        self.transport = transport
        self.delivery = module.Delivery(self.f.reader, transport, 'operator-callback-token', timeout=4)
        self.event = 'original-progress-37'
        self.root = self.delivery.folder(self.request_id, self.event)

    def prepare(self, raw=None):
        with self.f.runtime.owner():
            return self.delivery.prepare(self.request_id, self.event, self.raw if raw is None else raw)

    def advance(self):
        with self.f.runtime.owner():
            return self.delivery.advance(self.request_id, self.event)

    def test_exact_scope_body_and_current_access_precede_one_post(self):
        command = self.prepare()
        self.assertEqual(self.calls, [], 'Preparation does not issue external work')
        result = self.advance()
        self.assertEqual(result['state'], 'acknowledged', 'Valid receiver acknowledgement survives')
        self.assertEqual(len(self.calls), 1, 'One advance makes exactly one POST')
        self.assertEqual(self.calls[0][:3], (self.f.request['callbackUrl'], 'operator-callback-token', self.raw),
            'Transport receives the original endpoint, credential reference and exact UTF-8 bytes')
        self.assertIs(self.calls[0][4], True, 'Transport gets current lifetime ownership')
        self.assertEqual(command['binding']['originalApplicationJob'], self.f.row,
            'Delivery preserves original workspace, mission, job and actor')
        self.assertEqual(command['binding']['installationId'], 'synthetic-installation')
        self.assertEqual(command['binding']['targetId'], 'synthetic-target')
        self.assertEqual(command['binding']['eventKey'], self.event)
        self.assertEqual(command['bodySha256'], hashlib.sha256(self.raw).hexdigest(), 'Command binds exact payload hash')
        self.assertEqual(command['bodyBytes'], len(self.raw), 'Command binds exact payload byte count')
        self.assertIs(result['publicationPermission'], False, 'Acknowledgement grants no artifact publication')
        for path in self.root.iterdir():
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600, 'Every callback record stays private')

    def test_acknowledged_replay_never_posts_again(self):
        self.prepare()
        first = self.advance()
        before = {p.name: (p.stat().st_ino, p.read_bytes()) for p in self.root.iterdir()}
        replay = self.advance()
        self.assertEqual(len(self.calls), 1, 'Acknowledged replay cannot duplicate delivery')
        self.assertEqual(replay, first, 'Recovery returns the same acknowledged reply')
        self.assertEqual({p.name: (p.stat().st_ino, p.read_bytes()) for p in self.root.iterdir()}, before)

    def test_transport_interruption_retries_original_identity_and_bytes(self):
        self.prepare()
        self.replies.insert(0, ConnectionError('uncertain after remote receipt'))
        with self.assertRaisesRegex(ConnectionError, 'uncertain after remote receipt'):
            self.advance()
        self.assertTrue((self.root/'attempt-000000.json').exists(), 'Intent exists before uncertain transport')
        self.assertFalse((self.root/'reply-000000.json').exists())
        self.assertEqual(self.advance()['state'], 'acknowledged')
        self.assertEqual([call[2] for call in self.calls], [self.raw, self.raw],
            'Unknown delivery retries exactly the original callback bytes')

    def test_interruption_after_ack_before_receipt_uses_same_body(self):
        self.prepare()
        original = module.publish
        def interrupted(root, name, raw, **options):
            if name == 'reply-000000.json':
                raise InterruptedError('response received before local receipt')
            return original(root, name, raw, **options)
        with patch.object(module, 'publish', side_effect=interrupted), self.assertRaisesRegex(
                InterruptedError, 'response received before local receipt'):
            self.advance()
        self.replies.append((200, b'{"ok":true,"replayed":true,"status":"running"}'))
        self.assertEqual(self.advance()['state'], 'acknowledged')
        self.assertEqual([call[2] for call in self.calls], [self.raw, self.raw])

    def test_refused_reply_stops_later_posts(self):
        self.prepare()
        self.replies = [(409, b'{"error":"payload differs"}')]
        self.assertEqual(self.advance()['state'], 'refused', 'Explicit consumer refusal stops retries')
        self.assertEqual(self.advance()['state'], 'refused')
        self.assertEqual(len(self.calls), 1)

    def test_transient_and_unconfirmed_success_remain_retryable(self):
        for status, body in [(503, b'busy'), (200, b'{"ok":false}'), (200, b'not JSON'),
                (302, b'redirect'), (204, b'')]:
            with self.subTest(status=status, body=body):
                self.event = 'reply-'+str(status)+'-'+hashlib.sha256(body).hexdigest()
                self.root = self.delivery.folder(self.request_id, self.event)
                self.prepare()
                self.replies = [(status, body), (200, b'{"ok":true}')]
                self.assertEqual(self.advance()['state'], 'retry_pending', 'Unconfirmed delivery cannot become acknowledgement')
                self.assertEqual(self.advance()['state'], 'acknowledged')

    def test_changed_saved_command_cannot_reach_transport(self):
        self.prepare()
        path = self.root/'command.json'
        value = json.loads(path.read_bytes())
        value['credentialReference'] = 'other-token'
        path.write_bytes(json_bytes(value))
        with self.assertRaisesRegex(ValueError, 'Progress delivery original command differs'):
            self.advance()
        self.assertEqual(self.calls, [])

    def test_changed_reply_binding_cannot_suppress_delivery(self):
        self.prepare()
        self.advance()
        path = self.root/'reply-000000.json'
        value = json.loads(path.read_bytes()); value['commandSha256'] = '0'*64
        path.write_bytes(json_bytes(value))
        with self.assertRaisesRegex(ValueError, 'Progress delivery receiver reply binding differs'):
            self.advance()
        self.assertEqual(len(self.calls), 1)

    def test_changed_attempt_binding_refuses_replay(self):
        self.prepare(); self.advance()
        path = self.root/'attempt-000000.json'
        value = json.loads(path.read_bytes()); value['commandSha256'] = '0'*64
        path.write_bytes(json_bytes(value))
        with self.assertRaisesRegex(ValueError, 'Progress delivery attempt binding differs'):
            self.advance()

    def test_reply_without_original_attempt_refuses_another_post(self):
        self.prepare(); self.advance(); (self.root/'attempt-000000.json').unlink()
        with self.assertRaisesRegex(ValueError, 'Progress delivery reply requires its original attempt'):
            self.advance()
        self.assertEqual(len(self.calls), 1, 'Lost intent cannot cause another external attempt')

    def test_oversized_reply_is_not_allocated_as_a_saved_receipt(self):
        self.prepare(); self.replies = [(200, b'x'*(module.REPLY_LIMIT+1))]
        with self.assertRaisesRegex(ValueError, 'Progress delivery receiver reply exceeds its bound'):
            self.advance()
        self.assertFalse((self.root/'reply-000000.json').exists())

    def test_restarted_runtime_uses_saved_body_and_original_start(self):
        self.prepare()
        self.replies.insert(0, ConnectionError('restart with unknown delivery'))
        with self.assertRaises(ConnectionError):
            self.advance()
        from runtime_admission import Runtime
        from runtime_dispatch_custody import Custody
        from application_dispatch_reader import Reader
        runtime = Runtime(self.f.root, 'synthetic-installation', max_queued=2, pipeline=lambda _: None)
        reader = Reader(Custody(runtime, 'synthetic-target', timeout=4), self.f.transport)
        delivery = module.Delivery(reader, self.transport, 'operator-callback-token', timeout=4)
        with runtime.owner():
            result = delivery.advance(self.request_id, self.event)
        self.assertEqual(result['state'], 'acknowledged')
        self.assertEqual(self.calls[-1][2], self.raw, 'A replacement runtime does not generate a new body')
        self.assertNotEqual(runtime.context, self.f.runtime.context, 'The replacement runtime has its own identity')

    def test_existing_event_cannot_be_replaced_with_new_identity(self):
        self.prepare()
        value = copy.deepcopy(self.payload); value['callbackId'] = 'callback-replacement-0002'
        with self.assertRaisesRegex(ValueError, 'Existing source custody record differs'):
            self.prepare(json.dumps(value).encode())
        self.assertEqual(self.calls, [])

    def test_missing_command_with_existing_attempt_refuses_recreation(self):
        self.prepare(); self.advance(); (self.root/'command.json').unlink()
        with self.assertRaisesRegex(ValueError, 'Progress delivery records require their original command'):
            self.prepare()

    def test_current_actor_revocation_refuses_preparation_and_replay(self):
        self.prepare(); self.advance()
        self.f.receipt['authorizedNow'] = False
        with self.assertRaisesRegex(PermissionError, 'Progress delivery current application access refused'):
            self.prepare()
        with self.assertRaisesRegex(PermissionError, 'Progress delivery current application access refused'):
            self.advance()
        self.assertEqual(len(self.calls), 1, 'Revocation prevents another POST or delivery claim')

    def test_revocation_after_intent_prevents_external_request(self):
        self.prepare()
        original = module.publish
        def revoke(root, name, raw, **options):
            original(root, name, raw, **options)
            if name == 'attempt-000000.json':
                self.f.receipt['authorizedNow'] = False
        with patch.object(module, 'publish', side_effect=revoke), self.assertRaisesRegex(
                PermissionError, 'Progress delivery current application access refused'):
            self.advance()
        self.assertEqual(self.calls, [], 'Access is checked again after the durable intent')

    def test_revocation_after_response_retains_fact_without_claiming_current_access(self):
        self.prepare()
        def revoked(*args, **options):
            result = self.transport(*args, **options)
            self.f.receipt['authorizedNow'] = False
            return result
        self.delivery.transport = revoked
        with self.assertRaisesRegex(PermissionError, 'Progress delivery current application access refused'):
            self.advance()
        self.assertTrue((self.root/'reply-000000.json').exists(), 'Received response remains a historical fact')
        self.f.receipt['authorizedNow'] = True
        self.assertEqual(self.advance()['state'], 'acknowledged')
        self.assertEqual(len(self.calls), 1, 'Historical acknowledgement prevents another POST')

    def test_unowned_and_cancelled_delivery_refuse_before_post(self):
        self.prepare()
        with self.assertRaisesRegex(ValueError, 'Runtime preparation requires its lifetime owner'):
            self.delivery.advance(self.request_id, self.event)
        self.delivery.cancelled = lambda: True
        with self.assertRaisesRegex(InterruptedError, 'Progress delivery cancelled'):
            self.advance()
        self.assertEqual(self.calls, [])

    def test_terminal_artifact_foreign_and_invalid_payloads_refuse(self):
        alterations = [dict(status='queued'), dict(status='succeeded'), dict(artifacts=[]), dict(benchmarkSummary={}),
            dict(requestId='other-request'), dict(jobReference='other-job'), dict(schemaVersion='wrong'),
            dict(callbackId='short'), dict(occurredAt='not-a-time'), dict(progress=True),
            dict(occurredAt='2026-13-14T00:00:00Z'), dict(status=[]),
            dict(progress=101), dict(message='x'*2049)]
        for change in alterations:
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.prepare(json.dumps({**self.payload, **change}).encode())
        for raw in [b'{}', self.raw.replace(b'"progress": 37', b'"progress": 1e999'),
                self.raw.replace(b'"progress": 37', b'"progress": 37, "progress": 38'),
                b'\xff', self.raw + b' '*module.BODY_LIMIT]:
            with self.subTest(raw=raw[:20]), self.assertRaises(ValueError):
                self.prepare(raw)
        self.assertEqual(self.calls, [])

    def test_event_identity_and_cancellation_type_refuse(self):
        for event in ['', ' ', None, 'x'*257]:
            with self.subTest(event=event), self.assertRaises(ValueError):
                self.delivery.folder(self.request_id, event)
        self.prepare(); self.delivery.cancelled = lambda: 1
        with self.assertRaisesRegex(ValueError, 'Progress delivery cancellation must be a boolean'):
            self.advance()
        self.assertEqual(self.calls, [])

    def test_malformed_retained_reply_cannot_become_acknowledgement(self):
        self.prepare(); self.advance()
        path = self.root/'reply-000000.json'; original = path.read_bytes()
        for changed in [dict(status=True), dict(status=600), dict(attempt=False),
                dict(bodyBase64='bad~~'), dict(bodyBase64='eA==!!'), dict(bodyBase64=7),
                dict(bodyBase64=module.base64.b64encode(b'x'*(module.REPLY_LIMIT+1)).decode())]:
            value = json.loads(original); value.update(changed); path.write_bytes(json_bytes(value))
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                self.advance()
        path.write_bytes(original)

    def test_attempt_capacity_and_sequence_cannot_be_bypassed(self):
        self.prepare()
        self.delivery.max_attempts = 1
        self.replies = [(503, b'busy')]*2
        self.advance()
        with self.assertRaisesRegex(ValueError, 'Progress delivery attempt retention limit reached'):
            self.advance()
        self.delivery.max_attempts = 2
        (self.root/'attempt-000000.json').rename(self.root/'attempt-999999.json')
        with self.assertRaisesRegex(ValueError, 'Progress delivery attempt sequence differs'):
            self.advance()

    def test_constructor_requires_bounded_explicit_adapters(self):
        for options in [dict(timeout=False), dict(timeout=0), dict(timeout=float('nan')),
                dict(max_attempts=True), dict(max_attempts=0), dict(cancelled=None)]:
            with self.subTest(options=options), self.assertRaises(ValueError):
                module.Delivery(self.f.reader, self.transport, 'credential', **options)
        with self.assertRaises(ValueError):
            module.Delivery(None, self.transport, 'credential')
        with self.assertRaises(ValueError):
            module.Delivery(self.f.reader, None, 'credential')
        with self.assertRaises(ValueError):
            module.Delivery(self.f.reader, self.transport, '')


if __name__ == '__main__':
    unittest.main()
