"""Actual original journals with supplied permission and commit replies."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import copy
import json
import threading
import unittest
from unittest.mock import patch

from engine_effects import Effects
import runtime_commit as module
import test_runtime_draft as fixtures


class Checks(unittest.TestCase):
    def setUp(self):
        self.f = fixtures.Checks()
        self.f.setUp()
        self.draft = self.f.draft()
        self.permissions = []
        self.sends = []

    def tearDown(self):
        self.f.tearDown()

    def authorize(self, plan, operation, command, *, deadline):
        self.permissions.append((copy.deepcopy(plan), operation, copy.deepcopy(command), deadline))
        return True

    def send(self, plan, deadline, *, owned):
        self.assertTrue((self.f.folder / 'engine/command-00003.intent.json').exists(),
                        'Original commit intent must be durable before actual transport')
        self.assertIs(owned(), True)
        self.sends.append((copy.deepcopy(plan), deadline))
        return 200, json.dumps({'uuid': plan['taskUuid']}, indent=2).encode() + b'\n'

    def commit(self, authorize=None, send=None):
        return module.Commit(self.draft, authorize or self.authorize, send or self.send)

    def prepare(self, count=3):
        self.f.start()
        for _ in range(count):
            self.draft.advance(self.f.request['requestId'])

    def test_incomplete_original_drafts_hold_before_permission_or_transport(self):
        with self.f.runtime.owner():
            self.prepare(1)
            result = self.commit().advance(self.f.request['requestId'])
        self.assertEqual(result['state'], 'held_incomplete_draft')
        self.assertEqual(self.permissions, [], 'Incomplete drafts cannot obtain processing permission')
        self.assertEqual(self.sends, [])

    def test_one_exact_commit_retains_reply_and_replay_sends_nothing(self):
        with self.f.runtime.owner():
            self.prepare()
            first = self.commit().advance(self.f.request['requestId'])
            reply = self.f.read('engine/command-00003.reply.json')
            second = self.commit().advance(self.f.request['requestId'])
        self.assertEqual(len(self.permissions), 1, 'Retained commit replay cannot obtain another grant')
        self.assertEqual(first, second)
        self.assertEqual(len(self.sends), 1, 'Retained commit reply cannot trigger another POST')
        self.assertEqual(self.permissions[0][1], 'commit')
        self.assertEqual(self.permissions[0][3], self.sends[0][1], 'Commit permission and transport share the actual deadline')
        self.assertEqual(reply['bodyBytes'], len(json.dumps({'uuid': first['taskUuid']}, indent=2).encode()) + 1)
        self.assertEqual(first['state'], 'commit_reply_retained')
        self.assertIs(first['callbackPermission'], False)
        self.assertIs(first['publicationPermission'], False)
        self.assertEqual(first['processingQualityVerification'], 'unassessed')

    def test_permission_requires_exact_true_before_intent(self):
        with self.f.runtime.owner():
            self.prepare()
            for decision in (False, None, 1, {'allowed': True}):
                with self.assertRaisesRegex(PermissionError, 'Explicit original processing permission'):
                    self.commit(authorize=lambda *args, **kwargs: decision).advance(self.f.request['requestId'])
                self.assertFalse((self.f.folder / 'engine/command-00003.intent.json').exists(),
                                 'Denied processing permission cannot create an original commit intent')
        self.assertEqual(self.sends, [])

    def test_lost_acknowledgment_keeps_uncertain_commit_without_second_post(self):
        def lost(plan, deadline, *, owned):
            self.sends.append((plan, deadline))
            raise RuntimeError('Synthetic commit acknowledgment loss')
        with self.f.runtime.owner():
            self.prepare()
            with self.assertRaisesRegex(RuntimeError, 'Synthetic commit acknowledgment loss'):
                self.commit(send=lost).advance(self.f.request['requestId'])
            result = self.commit().advance(self.f.request['requestId'])
        self.assertEqual(result['state'], 'held_uncertain')
        self.assertEqual(len(self.sends), 1, 'Uncertain original commit cannot be posted again')
        self.assertEqual(len(self.permissions), 1, 'Uncertain original commit cannot obtain another grant')
        self.assertFalse((self.f.folder / 'engine/command-00003.reply.json').exists())

    def test_wrong_original_commit_reply_stays_unresolved(self):
        def wrong(plan, deadline, *, owned):
            self.sends.append((plan, deadline))
            return 200, b'{"uuid":"wrong"}'
        with self.f.runtime.owner():
            self.prepare()
            with self.assertRaises(ValueError):
                self.commit(send=wrong).advance(self.f.request['requestId'])
            self.assertEqual(self.commit().advance(self.f.request['requestId'])['state'], 'held_uncertain')
        self.assertEqual(len(self.sends), 1, 'A wrong reply cannot authorize an automatic second commit')

    def test_response_shape_must_be_tuple_before_retention(self):
        def wrong(plan, deadline, *, owned):
            return [200, json.dumps({'uuid': plan['taskUuid']}).encode()]
        with self.f.runtime.owner():
            self.prepare()
            with self.assertRaisesRegex(ValueError, 'response shape differs'):
                self.commit(send=wrong).advance(self.f.request['requestId'])
        self.assertFalse((self.f.folder / 'engine/command-00003.reply.json').exists())

    def test_adapters_cannot_replace_original_plan_or_command(self):
        def authorize(plan, operation, command, *, deadline):
            plan['name'] = 'Changed authorization alias'
            command['path'] = '/changed'
            return True
        def send(plan, deadline, *, owned):
            task = plan['taskUuid']
            plan['name'] = 'Changed transport alias'
            return 200, json.dumps({'uuid': task}).encode()
        with self.f.runtime.owner():
            self.prepare()
            original = self.f.read('engine/plan.json')
            self.commit(authorize=authorize, send=send).advance(self.f.request['requestId'])
        self.assertEqual(self.f.read('engine/plan.json'), original, 'Commit adapters cannot replace the saved original plan')
        self.assertEqual(self.f.read('engine/command-00003.intent.json')['command']['path'],
                         '/task/new/commit/' + original['taskUuid'], 'Authorization cannot replace the original commit command')

    def test_expired_permission_refuses_before_commit_intent(self):
        timer = patch('runtime_commit.time.monotonic', return_value=1e12)
        def late(*args, **kwargs):
            timer.start()
            return True
        with self.f.runtime.owner():
            self.prepare()
            try:
                with self.assertRaises(TimeoutError):
                    self.commit(authorize=late).advance(self.f.request['requestId'])
            finally:
                timer.stop()
        self.assertFalse((self.f.folder / 'engine/command-00003.intent.json').exists(),
                         'Expired processing permission cannot issue an original intent')

    def test_owner_loss_during_permission_refuses_before_intent(self):
        def lost(*args, **kwargs):
            self.f.runtime._owned = False
            return True
        with self.f.runtime.owner():
            self.prepare()
            try:
                with self.assertRaisesRegex(ValueError, 'lifetime owner'):
                    self.commit(authorize=lost).advance(self.f.request['requestId'])
            finally:
                self.f.runtime._owned = True
        self.assertFalse((self.f.folder / 'engine/command-00003.intent.json').exists())

    def test_owner_loss_after_transport_retains_intent_and_refuses_reply(self):
        def lost(plan, deadline, *, owned):
            self.sends.append((plan, deadline))
            self.f.runtime._owned = False
            return 200, json.dumps({'uuid': plan['taskUuid']}).encode()
        with self.f.runtime.owner():
            self.prepare()
            try:
                with self.assertRaisesRegex(ValueError, 'lifetime owner'):
                    self.commit(send=lost).advance(self.f.request['requestId'])
            finally:
                self.f.runtime._owned = True
            self.assertEqual(self.commit().advance(self.f.request['requestId'])['state'], 'held_uncertain')
        self.assertEqual(len(self.sends), 1)
        self.assertFalse((self.f.folder / 'engine/command-00003.reply.json').exists(),
                         'Ended ownership cannot acknowledge a processing reply')

    def test_concurrent_committers_share_one_durable_intent_and_post(self):
        entered = threading.Event()
        contender = threading.Event()
        release = threading.Event()
        writer = module.writer
        def authorize(*args, **kwargs):
            result = self.authorize(*args, **kwargs)
            if len(self.permissions) == 1:
                entered.set()
                if not release.wait(5):
                    raise AssertionError('First processing grant was not released')
            else:
                contender.set()
            return result
        @contextmanager
        def observed_writer(root, deadline):
            if entered.is_set():
                contender.set()
            with writer(root, deadline):
                yield
        with self.f.runtime.owner():
            self.prepare()
            commit = self.commit(authorize=authorize)
            with patch.object(module, 'writer', side_effect=observed_writer), ThreadPoolExecutor(max_workers=2) as pool:
                first = pool.submit(commit.advance, self.f.request['requestId'])
                try:
                    self.assertTrue(entered.wait(5))
                    second = pool.submit(commit.advance, self.f.request['requestId'])
                    self.assertTrue(contender.wait(5))
                finally:
                    release.set()
                results = [first.result(timeout=5), second.result(timeout=5)]
        self.assertEqual(results[0], results[1], 'Concurrent original committers must retain the same coordination outcome')
        self.assertEqual(len(self.sends), 1, 'Concurrent original committers cannot send duplicate POSTs')
        self.assertEqual(len(self.permissions), 1)

    def test_existing_intent_is_never_sent_from_stale_snapshot(self):
        original = Effects.issue
        def existing(effects, operation):
            intent, _first = original(effects, operation)
            return intent, False
        with self.f.runtime.owner():
            self.prepare()
            with patch.object(Effects, 'issue', side_effect=existing, autospec=True):
                result = self.commit().advance(self.f.request['requestId'])
        self.assertEqual(result['state'], 'held_uncertain')
        self.assertEqual(self.sends, [], 'An existing original intent cannot be posted from a stale snapshot')

    def test_out_of_order_original_receipts_refuse(self):
        original = Effects.snapshot
        def changed(effects):
            value = original(effects)
            value['commands'][0]['state'] = 'unissued'
            return value
        with self.f.runtime.owner():
            self.prepare()
            with patch.object(Effects, 'snapshot', side_effect=changed, autospec=True), \
                    self.assertRaisesRegex(ValueError, 'Original processing command order differs'):
                self.commit().advance(self.f.request['requestId'])
        self.assertEqual(self.permissions, [])

    def test_job_hook_requires_original_request_and_never_reports_completion(self):
        with self.f.runtime.owner():
            self.prepare()
            changed = {'request': {**self.f.request, 'missionTitle': 'Changed original'}}
            with self.assertRaisesRegex(ValueError, 'job request differs'):
                self.commit()(changed)
            self.assertEqual(self.sends, [])
            job = {'request': copy.deepcopy(self.f.request)}
            self.commit()(job)
        self.assertEqual(job['state'], 'processing_pending', 'Commit acknowledgment cannot report processing completion')
        self.assertIs(job['commit']['publicationPermission'], False)

    def test_constructor_requires_explicit_adapters_and_finite_timeout(self):
        for draft, authorize, send in [(None, self.authorize, self.send), (self.draft, None, self.send),
                                      (self.draft, self.authorize, None)]:
            with self.assertRaises(ValueError):
                module.Commit(draft, authorize, send)
        for timeout in (None, False, 0, -1, float('nan'), float('inf')):
            with self.assertRaisesRegex(ValueError, 'positive and finite'):
                module.Commit(self.draft, self.authorize, self.send, timeout=timeout)

    def test_malformed_job_hook_refuses_before_journal_or_transport(self):
        with self.f.runtime.owner():
            self.prepare()
            for job in (None, {}, {'request': None}):
                with self.assertRaisesRegex(ValueError, 'needs its original job request'):
                    self.commit()(job)
        self.assertEqual(self.permissions, [])
        self.assertEqual(self.sends, [])


if __name__ == '__main__':
    unittest.main()
