"""Actual original journals, current reader and supervised loopback task GET."""
import copy
import hashlib
import json
import time
import unittest
from unittest.mock import patch

from engine_effects import Effects
from retained_source import json_bytes, writer
from retained_task_observation import Observations
from runtime_commit import Commit
from runtime_draft import Draft
from runtime_observation import Observer
from runtime_preparation import Preparation
import uncertain_commit_inspection as module
import test_runtime_observation as fixtures
import retained_source


class Checks(unittest.TestCase):
    def setUp(self):
        self.f = fixtures.Checks()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        self.app = self.f.application
        self.posts = []
        self.grants = []
        self.preparation = Preparation(self.f.runtime,
            lambda entry: self.app.draft._inputs(entry, time.monotonic() + 4), timeout=4)
        def refuse(*args, **kwargs):
            raise AssertionError('Inspection cannot reach draft writes or refetch source bytes')
        self.commit = Commit(Draft(self.preparation, refuse, refuse, timeout=4),
            self.authorize, self.send, timeout=4)
        self.inspection = module.Inspection(self.commit, self.f.observer)

    def authorize(self, *args, **kwargs):
        self.grants.append((args, kwargs))
        return True

    def send(self, plan, deadline, *, owned):
        self.posts.append(plan['taskUuid'])
        raise ConnectionError('Synthetic acknowledgment lost after commit POST')

    def prepare(self, *, lose=True):
        for _ in range(2):
            self.app.pipeline.advance(self.f.request_id)
        if lose:
            with self.assertRaisesRegex(ConnectionError, 'acknowledgment lost'):
                self.commit.advance(self.f.request_id)

    def read(self):
        return self.inspection.inspect(self.f.request_id)

    def test_uncertain_commit_inspects_exact_task_without_another_post_or_reply(self):
        with self.f.runtime.owner():
            self.prepare()
            before = len(self.app.f.calls)
            attest_before = len(self.app.attestations)
            result = self.read()
            held = self.commit.advance(self.f.request_id)
        self.assertEqual(result['commitAcknowledgmentState'], 'unresolved', 'Task GET must not acknowledge a missing commit reply')
        self.assertEqual(len(self.app.f.calls) - before, 3, 'Inspection must use current application access around the actual GET')
        self.assertEqual(len(self.app.attestations) - attest_before, 2)
        self.assertEqual(len(self.f.network.requests), 1)
        self.assertEqual(len(self.posts), 1, 'Inspection cannot repeat the original commit')
        self.assertEqual(len(self.grants), 1)
        self.assertEqual(held['state'], 'held_uncertain')
        self.assertFalse((self.f.root / 'engine/command-00003.reply.json').exists(), 'Inspection cannot fabricate exact commit acknowledgment bytes')
        task = result['taskObservation']['task']
        raw = json.dumps(self.f.network.value, indent=2).encode() + b'\n'
        self.assertEqual(task['bodySha256'], hashlib.sha256(raw).hexdigest())
        saved = Observations(self.f.root / 'engine', self.f.plan,
            records_root=self.f.root / 'task-observations').load(task['bodySha256'])
        self.assertEqual(saved['bodyBytes'], len(raw))
        self.assertIs(result['commitRetryPermission'], False)
        self.assertIs(result['callbackPermission'], False)
        self.assertIs(result['publicationPermission'], False)
        self.assertEqual(result['processingQualityVerification'], 'unassessed')

    def test_incomplete_draft_returns_without_current_read(self):
        with self.f.runtime.owner():
            result = self.read()
        self.assertEqual(result['commitAcknowledgmentState'], 'held_incomplete_draft', 'Incomplete original uploads must hold before GET')
        self.assertIsNone(result['taskObservation'])
        self.assertEqual(self.f.network.requests, [])

    def test_unissued_commit_returns_without_current_read(self):
        with self.f.runtime.owner():
            self.prepare(lose=False)
            result = self.read()
        self.assertEqual(result['commitAcknowledgmentState'], 'unissued', 'Unissued original commit must not inspect a processing effect')
        self.assertEqual(self.f.network.requests, [])
        self.assertEqual(self.posts, [])

    def test_acknowledged_commit_returns_without_current_read(self):
        def acknowledged(plan, deadline, *, owned):
            self.posts.append(plan['taskUuid'])
            return 200, json_bytes({'uuid': plan['taskUuid']})
        self.commit.transport = acknowledged
        with self.f.runtime.owner():
            self.prepare(lose=False)
            self.commit.advance(self.f.request_id)
            result = self.read()
        self.assertEqual(result['commitAcknowledgmentState'], 'acknowledged')
        self.assertEqual(self.f.network.requests, [], 'Exact acknowledged commit must return without task GET')

    def test_original_processing_dispatch_is_required_before_get(self):
        with self.f.runtime.owner():
            self.prepare()
            path = self.f.root / 'processing-dispatch/original-plan.json'
            value = json.loads(path.read_bytes())
            value['enginePlanSha256'] = 'f' * 64
            path.write_bytes(json_bytes(value))
            with self.assertRaisesRegex(ValueError, 'original dispatch differs'):
                self.read()
        self.assertEqual(self.f.network.requests, [])

    def test_wrong_observation_plan_is_refused(self):
        original = Observer.observe
        def wrong(observer, request_id):
            result = original(observer, request_id)
            result['task']['originalPlanSha256'] = 'f' * 64
            return result
        with self.f.runtime.owner():
            self.prepare()
            with patch.object(Observer, 'observe', wrong), self.assertRaisesRegex(ValueError, 'original observation differs'):
                self.read()

    def test_current_revocation_refuses_without_another_post(self):
        with self.f.runtime.owner():
            self.prepare()
            self.app.f.receipt['authorizedNow'] = False
            with self.assertRaisesRegex(PermissionError, 'current application access refused'):
                self.read()
        self.assertEqual(len(self.posts), 1)
        self.assertEqual(self.f.network.requests, [])

    def test_same_runtime_and_real_adapter_types_are_required(self):
        with self.assertRaisesRegex(ValueError, 'commit and current task observer'):
            module.Inspection(None, self.f.observer)
        with self.assertRaisesRegex(ValueError, 'commit and current task observer'):
            module.Inspection(self.commit, None)
        original = self.f.observer.reader.dispatch.runtime
        try:
            self.f.observer.reader.dispatch.runtime = object()
            with self.assertRaisesRegex(ValueError, 'same owned runtime'):
                module.Inspection(self.commit, self.f.observer)
        finally:
            self.f.observer.reader.dispatch.runtime = original

    def test_unowned_inspection_refuses_before_current_read(self):
        with self.f.runtime.owner():
            self.prepare()
        before = len(self.app.f.calls)
        with self.assertRaisesRegex(ValueError, 'lifetime owner'):
            self.read()
        self.assertEqual(len(self.app.f.calls), before)
        self.assertEqual(self.f.network.requests, [])

    def test_changed_runtime_refuses_before_get(self):
        original = self.f.observer.reader.dispatch.runtime
        with self.f.runtime.owner():
            self.prepare()
            try:
                self.f.observer.reader.dispatch.runtime = object()
                with self.assertRaisesRegex(ValueError, 'same owned runtime'):
                    self.read()
            finally:
                self.f.observer.reader.dispatch.runtime = original
        self.assertEqual(self.f.network.requests, [])

    def test_late_exact_reply_is_retained_separately_from_task_metadata(self):
        original = Observer.observe
        raw = json.dumps({'uuid': self.f.plan['taskUuid']}, indent=3).encode() + b'\n'
        def acknowledged(observer, request_id):
            result = original(observer, request_id)
            effects, _root = self.commit.draft._effects(request_id, time.monotonic() + 4)
            effects.save_reply('commit', 200, raw)
            return result
        with self.f.runtime.owner():
            self.prepare()
            with patch.object(Observer, 'observe', acknowledged):
                result = self.read()
            effects, _root = self.commit.draft._effects(self.f.request_id, time.monotonic() + 4)
            self.assertEqual(effects.snapshot()['commands'][-1]['state'], 'acknowledged')
        self.assertEqual(result['commitAcknowledgmentState'], 'acknowledged', 'Final exact reply arrival must remain distinct from task GET')
        saved = json.loads((self.f.root / 'engine/command-00003.reply.json').read_bytes())
        self.assertEqual(saved['bodySha256'], hashlib.sha256(raw).hexdigest())
        self.assertIsNotNone(result['taskObservation'])
        self.assertIs(result['publicationPermission'], False)

    def test_ended_ownership_after_observation_refuses_return(self):
        original = Observer.observe
        def ended(observer, request_id):
            result = original(observer, request_id)
            self.f.runtime._owned = False
            return result
        with self.f.runtime.owner():
            self.prepare()
            try:
                with patch.object(Observer, 'observe', ended), self.assertRaisesRegex(ValueError, 'lifetime owner'):
                    self.read()
            finally:
                self.f.runtime._owned = True
        self.assertFalse((self.f.root / 'engine/command-00003.reply.json').exists())

    def test_expired_observation_refuses_return(self):
        original = Observer.observe
        timer = patch.object(module.time, 'monotonic', return_value=1e12)
        def expired(observer, request_id):
            result = original(observer, request_id)
            timer.start()
            return result
        with self.f.runtime.owner():
            self.prepare()
            try:
                with patch.object(Observer, 'observe', expired), self.assertRaises(TimeoutError):
                    self.read()
            finally:
                timer.stop()

    def test_observer_timeout_uses_remaining_commit_budget(self):
        original = Observer.observe
        seen = []
        self.f.observer.timeout = 100
        def timed(observer, request_id):
            seen.append(observer.timeout)
            return original(observer, request_id)
        with self.f.runtime.owner():
            self.prepare()
            with patch.object(Observer, 'observe', timed):
                self.read()
        self.assertGreater(seen[0], 0)
        self.assertLessEqual(seen[0], self.commit.timeout, 'Inspection cannot extend the commit budget for its task read')

    @staticmethod
    def slow_validation(original):
        def bounded(root, name, limit, deadline, output=None):
            while time.monotonic() < deadline:
                time.sleep(.005)
            return original(root, name, limit, deadline, output=output)
        return bounded

    def test_shared_budget_bounds_actual_slow_preparation_validation(self):
        with self.f.runtime.owner():
            self.prepare()
            self.preparation.timeout = .4
            self.commit.timeout = .04
            began = time.monotonic()
            with patch.object(retained_source, 'digest', self.slow_validation(retained_source.digest)):
                with self.assertRaises(TimeoutError):
                    self.read()
            elapsed = time.monotonic() - began
        self.assertLess(elapsed, .25, 'Inspection budget must bound slow preparation source validation')
        self.assertEqual(self.f.network.requests, [])

    def test_shared_budget_bounds_actual_slow_snapshot_validation(self):
        with self.f.runtime.owner():
            self.prepare()
            effects, root = self.commit.draft._effects(self.f.request_id, time.monotonic() + 4)
            self.commit.timeout = .04
            began = time.monotonic()
            # Setup must not consume the independent cap measured by this probe.
            effects.deadline = began + .4
            effects.timeout = .4
            effects.source_arguments['timeout'] = .4
            with patch.object(self.commit.draft, '_effects', return_value=(effects, root)), patch.object(retained_source, 'digest', self.slow_validation(retained_source.digest)):
                with self.assertRaises(TimeoutError):
                    self.read()
            elapsed = time.monotonic() - began
        self.assertLess(elapsed, .25, 'Inspection budget must bound slow snapshot source validation')
        self.assertEqual(self.f.network.requests, [])

    def test_preparation_deadline_types_refuse_before_supplier(self):
        with self.f.runtime.owner():
            self.prepare()
            with patch.object(self.preparation, 'supply', side_effect=AssertionError('Invalid preparation deadline reached supplier')):
                for deadline in (True, float('nan'), float('inf'), 'later'):
                    with self.subTest(deadline=deadline), self.assertRaisesRegex(ValueError, 'shared deadline must be finite'):
                        self.preparation.resume(self.f.request_id, deadline=deadline)

    def test_effect_deadline_types_refuse_before_source_validation(self):
        with self.f.runtime.owner():
            self.prepare()
            effects, _root = self.commit.draft._effects(self.f.request_id, time.monotonic() + 4)
            with patch.object(effects, '_source_receipt', side_effect=AssertionError('Invalid effect deadline reached source validation')):
                for deadline in (True, float('nan'), float('inf'), 'later'):
                    with self.subTest(deadline=deadline), self.assertRaisesRegex(ValueError, 'shared deadline must be finite'):
                        effects.snapshot(deadline=deadline)

    def test_effect_snapshot_shared_deadline_bounds_actual_lock_wait(self):
        with self.f.runtime.owner():
            self.prepare()
            effects, _root = self.commit.draft._effects(self.f.request_id, time.monotonic() + 4)
            with writer(effects.root, time.monotonic() + 1):
                began = time.monotonic()
                with self.assertRaises(TimeoutError):
                    effects.snapshot(deadline=began + .04)
                elapsed = time.monotonic() - began
        self.assertLess(elapsed, .25, 'Shared snapshot budget must bound its actual journal lock wait')

    def test_source_timeout_types_are_not_normalized_by_deadline_clamping(self):
        with self.f.runtime.owner():
            self.prepare()
            effects, _root = self.commit.draft._effects(self.f.request_id, time.monotonic() + 4)
            for value in (True, 0, -1, float('nan'), 'later'):
                effects.source_arguments['timeout'] = value
                with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'source validation timeout must be positive and finite'):
                    effects.snapshot(deadline=time.monotonic() + .04)

    def test_job_hook_preserves_state_and_requires_original_request(self):
        with self.f.runtime.owner():
            self.prepare()
            job = {'request': copy.deepcopy(self.app.request), 'state': 'processing_held'}
            self.inspection(job)
            self.assertEqual(job['state'], 'processing_held', 'Reported task metadata cannot promote the original held job')
            changed = copy.deepcopy(job)
            changed['request']['missionTitle'] = 'Another original'
            with self.assertRaisesRegex(ValueError, 'job request differs'):
                self.inspection(changed)
            with self.assertRaisesRegex(ValueError, 'requires its original job request'):
                self.inspection(None)
        self.assertEqual(len(self.posts), 1)


if __name__ == '__main__':
    unittest.main()
