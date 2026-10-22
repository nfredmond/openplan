"""Owned original application reads and actual loopback task metadata."""
import copy
import hashlib
import json
import shutil
import time
import unittest
import uuid
from unittest.mock import patch

from application_draft_authority import Authority
from retained_source import json_bytes
from retained_task_observation import Observations
import runtime_observation as module
import test_application_draft_authority as application
import test_original_task_http as network


class Checks(unittest.TestCase):
    def setUp(self):
        self.application = application.Checks()
        self.application.setUp()
        self.addCleanup(self.application.tearDown)
        self.network = network.Checks()
        self.network.setUp()
        self.addCleanup(self.network.tearDown)
        self.application.engine['endpoint'] = self.network.plan['engine']['endpoint']
        self.application.authority = Authority(self.application.f.reader, self.application.engine, self.application.attest)
        self.application.draft.authorize = self.application.authority
        self.application.advance()
        self.plan = self.application.plan()
        self.root = next(self.application.f.root.glob('preparation-*'))
        self.network.value.update(uuid=self.plan['taskUuid'], name=self.plan['name'],
            imagesCount=len(self.plan['uploads']), options=copy.deepcopy(self.plan['options']) + [
                {'name': name, 'value': True} for name in ('pc-ept', 'cog', 'gltf')])
        self.runtime = self.application.runtime
        self.request_id = self.application.request['requestId']
        self.observer = module.Observer(self.application.f.reader, lambda reference: None, self.application.attest, timeout=2)

    def call(self):
        with self.runtime.owner():
            return self.observer.observe(self.request_id)

    def test_original_read_checks_access_and_retains_exact_reply(self):
        before = len(self.application.f.calls)
        attest_before = len(self.application.attestations)
        result = self.call()
        self.assertEqual(len(self.application.f.calls) - before, 3, 'Runtime must check current access around read and publication')
        self.assertEqual(len(self.application.attestations) - attest_before, 2)
        self.assertEqual(len(self.network.requests), 1, 'Runtime must issue one actual original task GET')
        body = json.dumps(self.network.value, indent=2).encode() + b'\n'
        self.assertEqual(result['task']['bodySha256'], hashlib.sha256(body).hexdigest(), 'Runtime summary must bind actual original reply bytes')
        saved = Observations(self.root / 'engine', self.plan, records_root=self.root / 'task-observations').load(result['task']['bodySha256'])
        self.assertEqual(saved['bodyBytes'], len(body))
        self.assertIs(result['commitPermission'], False)
        self.assertIs(result['callbackPermission'], False)
        self.assertIs(result['publicationPermission'], False)
        self.assertEqual(result['task']['originalActorAuthorization'], 'unassessed')
        self.assertEqual(result['task']['processingQualityVerification'], 'unassessed')
        self.assertFalse(list((self.root / 'engine').glob('command-00003.intent.json')))

    def test_unowned_runtime_refuses_before_reads(self):
        before = len(self.application.f.calls)
        with self.assertRaisesRegex(ValueError, 'lifetime owner'):
            self.observer.observe(self.request_id)
        self.assertEqual(len(self.application.f.calls), before)
        self.assertEqual(self.network.requests, [])

    def test_changed_plan_binding_refuses_before_current_access(self):
        plan = copy.deepcopy(self.plan)
        plan['binding']['originalContext']['originalActorId'] = 'other'
        (self.root / 'engine' / 'plan.json').write_bytes(json_bytes(plan))
        prepared = json.loads((self.root / 'prepared.json').read_bytes())
        prepared['enginePlanSha256'] = hashlib.sha256(json_bytes(plan)).hexdigest()
        (self.root / 'prepared.json').write_bytes(json_bytes(prepared))
        before = len(self.application.f.calls)
        with self.assertRaisesRegex(ValueError, 'application binding differs'):
            self.call()
        self.assertEqual(len(self.application.f.calls), before)
        self.assertEqual(self.network.requests, [])

    def test_changed_valid_engine_plan_refuses_before_current_access(self):
        original = (self.root / 'engine' / 'plan.json').read_bytes()
        before = len(self.application.f.calls)
        variants = [('name', 'Another valid task name'), ('taskUuid', str(uuid.uuid4())),
                    ('engine', {**self.plan['engine'], 'instanceId': 'Another valid engine'})]
        try:
            for field, value in variants:
                plan = {**self.plan, field: value}
                (self.root / 'engine' / 'plan.json').write_bytes(json_bytes(plan))
                with self.assertRaisesRegex(ValueError, 'prepared runtime record'):
                    self.call()
                self.assertEqual(len(self.application.f.calls), before,
                                 'A mixed valid plan must refuse before current application reads')
                self.assertEqual(self.network.requests, [], 'A mixed valid plan cannot read another engine task')
        finally:
            (self.root / 'engine' / 'plan.json').write_bytes(original)

    def test_prepared_record_must_bind_its_complete_original_preparation(self):
        path = self.root / 'prepared.json'
        original = path.read_bytes()
        saved = json.loads(original)
        before = len(self.application.f.calls)
        try:
            for field, value in [('enginePlanSha256', '0'*64), ('planSha256', '0'*64),
                    ('taskUuid', str(uuid.uuid4())), ('sourceManifestSha256', '0'*64),
                    ('state', 'unassessed')]:
                path.write_bytes(json_bytes({**saved, field: value}))
                with self.assertRaisesRegex(ValueError, 'prepared runtime record'):
                    self.call()
                self.assertEqual(len(self.application.f.calls), before,
                                 'Invalid preparation identity must refuse before current access')
        finally:
            path.write_bytes(original)

    def test_revoked_initial_access_refuses_before_engine_read(self):
        self.application.f.receipt['authorizedNow'] = False
        before = len(self.application.attestations)
        with self.assertRaisesRegex(PermissionError, 'current application access refused'):
            self.call()
        self.assertEqual(len(self.application.attestations), before, 'Revoked initial access must precede engine checks')
        self.assertEqual(self.network.requests, [])
        self.assertFalse((self.root / 'task-observations').exists())

    def test_revocation_after_get_refuses_before_record(self):
        original = self.observer.reader.observe
        calls = []
        def read(*args, **kwargs):
            calls.append(True)
            if len(calls) == 2:
                self.application.f.receipt['authorizedNow'] = False
            return original(*args, **kwargs)
        with patch.object(self.observer.reader, 'observe', side_effect=read):
            with self.assertRaisesRegex(PermissionError, 'current application access refused'):
                self.call()
        self.assertEqual(len(self.network.requests), 1)
        self.assertFalse((self.root / 'task-observations').exists(), 'Post-read revocation cannot publish metadata')

    def test_revocation_after_record_refuses_without_deleting_it(self):
        original = self.observer.reader.observe
        calls = []
        def read(*args, **kwargs):
            calls.append(True)
            if len(calls) == 3:
                self.application.f.receipt['authorizedNow'] = False
            return original(*args, **kwargs)
        with patch.object(self.observer.reader, 'observe', side_effect=read):
            with self.assertRaisesRegex(PermissionError, 'current application access refused'):
                self.call()
        records = list((self.root / 'task-observations').glob('*.json'))
        self.assertEqual(len(records), 2, 'Final revocation must retain already durable plan/reply records')
        self.assertEqual(len(self.network.requests), 1)

    def test_wrong_metadata_refuses_before_record_directory(self):
        self.network.value['uuid'] = 'other'
        with self.assertRaisesRegex(ValueError, 'original UUID or name'):
            self.call()
        self.assertFalse((self.root / 'task-observations').exists(), 'Wrong task reply cannot create a metadata directory')

    def test_engine_refusal_stops_before_network(self):
        self.application.attestation = False
        with self.assertRaisesRegex(ValueError, 'engine check refused'):
            self.call()
        self.assertEqual(self.network.requests, [])

    def test_owner_loss_in_engine_check_stops_network(self):
        def attest(engine, deadline, *, owned):
            self.runtime._owned = False
            return True
        self.observer.attest = attest
        with self.assertRaisesRegex(InterruptedError, 'ownership ended'):
            self.call()
        self.assertEqual(self.network.requests, [])

    def test_timeout_rejection_precedes_private_read(self):
        for timeout in (False, 0, float('nan'), float('inf')):
            with self.assertRaisesRegex(ValueError, 'positive and finite'):
                module.Observer(self.application.f.reader, lambda reference: None, self.application.attest, timeout=timeout)

    def test_adapter_types_are_required(self):
        for reader, resolve, attest in ((None, lambda reference: None, self.application.attest),
                                        (self.application.f.reader, None, self.application.attest),
                                        (self.application.f.reader, lambda reference: None, None)):
            with self.assertRaisesRegex(ValueError, 'explicit task adapters'):
                module.Observer(reader, resolve, attest)

    def test_existing_metadata_alias_refuses(self):
        other = self.application.f.root.parent / 'other-records'
        other.mkdir(mode=0o700)
        (self.root / 'task-observations').symlink_to(other)
        with self.assertRaisesRegex(ValueError, 'without aliases'):
            self.call()
        self.assertEqual(list(other.iterdir()), [])

    def test_job_attachment_does_not_promote_state_or_callback(self):
        job = {'request': copy.deepcopy(self.application.request), 'state': 'draft_pending', 'original': True}
        with self.runtime.owner():
            self.observer(job)
        self.assertEqual(job['state'], 'draft_pending', 'Task observation cannot promote the original job state')
        self.assertIs(job['original'], True)
        self.assertEqual(job['taskObservation']['task']['reportedState'], 'failed')
        self.assertIs(job['taskObservation']['callbackPermission'], False)

    def test_relocated_private_reply_reopens_without_new_fetch(self):
        result = self.call()
        target = self.application.f.root.parent / 'copied-preparation'
        shutil.copytree(self.root, target)
        before = len(self.network.requests)
        saved = Observations(target / 'engine', self.plan, records_root=target / 'task-observations').load(result['task']['bodySha256'])
        self.assertEqual(saved['bodySha256'], result['task']['bodySha256'])
        self.assertEqual(len(self.network.requests), before, 'Local copied record read cannot fetch a new reply')

    def test_changed_job_scope_refuses_before_private_reads(self):
        request = {**self.application.request, 'missionTitle': 'Changed title'}
        job = {'request': request, 'state': 'draft_pending'}
        before = len(self.application.f.calls)
        with self.runtime.owner(), self.assertRaisesRegex(ValueError, 'job request differs'):
            self.observer(job)
        self.assertEqual(len(self.application.f.calls), before)
        self.assertEqual(self.network.requests, [])
        self.assertNotIn('taskObservation', job)



    def test_cancellation_adapter_type_refuses_before_private_reads(self):
        with self.assertRaisesRegex(ValueError,'cancellation adapter'):
            module.Observer(self.application.f.reader,lambda reference:None,self.application.attest,cancelled=None)
    def test_active_task_get_closes_after_supplied_cancellation(self):
        import threading
        decision=threading.Event();self.network.mode='held';self.observer.timeout=10;self.observer.reader.timeout=10
        self.observer.cancelled=decision.is_set
        def cancel_then_release():
            self.network.entered.wait(timeout=2);decision.set()
            self.network.closed.wait(timeout=.5);self.network.release.set()
        thread=threading.Thread(target=cancel_then_release,daemon=True)
        thread.start()
        try:
            with self.assertRaisesRegex(InterruptedError,'cancelled'):self.call()
            self.assertTrue(self.network.entered.is_set(),'Cancellation fixture reaches actual task GET')
            self.assertTrue(self.network.closed.wait(timeout=1),'Cancelled task GET closes actual connection')
        finally:self.network.release.set();thread.join(timeout=3)

if __name__ == '__main__':
    unittest.main()
