"""Processing permission uses the saved original and current supplied receipts."""
import copy
from contextlib import contextmanager
import hashlib
import json
import time
import unittest
from retained_source import json_bytes

from application_processing_authority import Authority
from engine_effects import commands
import test_application_draft_authority as fixture


class Checks(unittest.TestCase):
    def setUp(self):
        self.f = fixture.Checks()
        self.f.setUp()
        self.f.advance()
        self.authority = Authority(self.f.f.reader, self.f.engine, self.f.attest)

    def tearDown(self):
        self.f.tearDown()

    def permit(self, plan=None, operation='commit', command=None):
        plan = self.f.plan() if plan is None else plan
        command = commands(plan)['commit'] if command is None else command
        return self.authority(plan, operation, command, deadline=time.monotonic() + 2)

    @contextmanager
    def prepared_digest_for(self, plan):
        path = next(self.f.f.root.glob('preparation-*/prepared.json'))
        original = path.read_bytes()
        value = json.loads(original)
        try:
            value['enginePlanSha256'] = hashlib.sha256(json_bytes(plan)).hexdigest()
            path.write_bytes(json_bytes(value))
            yield
        finally:
            path.write_bytes(original)

    def test_exact_commit_checks_current_access_around_engine_attestation(self):
        before = len(self.f.f.calls)
        attestations = len(self.f.attestations)
        with self.f.runtime.owner():
            self.assertIs(self.permit(), True)
        self.assertEqual(len(self.f.f.calls) - before, 2,
                         'Processing permission must check current access before and after attestation')
        self.assertEqual(len(self.f.attestations) - attestations, 1)
        self.assertEqual(len(self.f.sends), 1, 'Processing permission itself cannot send an engine command')

    def test_draft_commands_and_changed_commit_refuse_before_current_read(self):
        plan = self.f.plan()
        before = len(self.f.f.calls)
        with self.f.runtime.owner():
            for operation, command in [('init', commands(plan)['init']),
                    ('commit', {'method': 'POST', 'path': '/task/new/commit/changed'})]:
                with self.assertRaisesRegex(ValueError, 'Only the exact original processing commit'):
                    self.permit(plan, operation, command)
        self.assertEqual(len(self.f.f.calls), before, 'Invalid processing commands cannot query current access')

    def test_changed_valid_plan_cannot_reuse_original_application_binding(self):
        plan = self.f.plan()
        plan['name'] = 'Changed original task name'
        before = len(self.f.f.calls)
        with self.prepared_digest_for(plan), self.f.runtime.owner(), self.assertRaisesRegex(ValueError, 'saved original engine plan'):
            self.permit(plan)
        self.assertEqual(len(self.f.f.calls), before, 'Another valid task plan cannot obtain processing permission')

    def test_initial_revocation_refuses_before_engine_check(self):
        self.f.f.receipt['authorizedNow'] = False
        before = len(self.f.attestations)
        with self.f.runtime.owner():
            self.assertIs(self.permit(), False)
        self.assertEqual(len(self.f.attestations), before, 'Revoked access cannot reach processing engine attestation')

    def test_revocation_during_attestation_refuses_permission(self):
        def revoke(engine, deadline, *, owned):
            self.f.f.receipt['authorizedNow'] = False
            return True
        self.authority = Authority(self.f.f.reader, self.f.engine, revoke)
        with self.f.runtime.owner():
            self.assertIs(self.permit(), False, 'Revocation during attestation cannot grant processing permission')

    def test_engine_refusal_and_non_boolean_attestation_do_not_permit(self):
        with self.f.runtime.owner():
            self.f.attestation = False
            self.assertIs(self.permit(), False)
            for value in (1, None, 'yes'):
                self.f.attestation = value
                with self.assertRaisesRegex(ValueError, 'attestation must return a boolean'):
                    self.permit()

    def test_unowned_runtime_cannot_obtain_processing_permission(self):
        with self.assertRaisesRegex(ValueError, 'requires its lifetime owner'):
            self.permit()

    def test_changed_scope_and_engine_refuse_before_current_access(self):
        plan = self.f.plan()
        before = len(self.f.f.calls)
        with self.f.runtime.owner():
            for field, value, reason in [('binding', {**plan['binding'], 'jobReference': 'changed'}, 'saved application original'),
                    ('engine', {**plan['engine'], 'instanceId': 'changed'}, 'configured original')]:
                changed = copy.deepcopy(plan)
                changed[field] = value
                with self.prepared_digest_for(changed), self.assertRaisesRegex(ValueError, reason):
                    self.permit(changed)
        self.assertEqual(len(self.f.f.calls), before)

    def test_constructor_requires_private_reader_and_explicit_attestor(self):
        for reader, attest in [(None, self.f.attest), (self.f.f.reader, None)]:
            with self.assertRaisesRegex(ValueError, 'Private reader and explicit processing engine attestation'):
                Authority(reader, self.f.engine, attest)

    def test_actual_shared_deadline_is_required_before_current_access(self):
        plan = self.f.plan()
        before = len(self.f.f.calls)
        with self.f.runtime.owner(), self.assertRaisesRegex(ValueError, 'actual shared deadline'):
            self.authority(plan, 'commit', commands(plan)['commit'], deadline=None)
        self.assertEqual(len(self.f.f.calls), before)

    def test_original_binding_shape_is_required_before_private_reads(self):
        before = len(self.f.f.calls)
        original = self.f.plan()['binding']
        bindings = [{key: value for key, value in original.items() if key != 'requestId'},
                    {**original, 'requestId': ''}, {**original, 'extra': True}]
        with self.f.runtime.owner():
            for binding in bindings:
                plan = self.f.plan()
                plan['binding'] = binding
                with self.assertRaisesRegex(ValueError, 'original application binding is required'):
                    self.permit(plan)
        self.assertEqual(len(self.f.f.calls), before)

    def test_engine_attestation_cannot_change_original_or_extend_deadline(self):
        observed = []
        deadline = time.monotonic() + 1
        def change(engine, end, *, owned):
            observed.append((copy.deepcopy(engine), end, owned()))
            engine['instanceId'] = 'Changed attestor alias'
            return True
        self.authority.attest = change
        plan = self.f.plan()
        with self.f.runtime.owner():
            self.assertIs(self.authority(plan, 'commit', commands(plan)['commit'], deadline=deadline), True)
        self.assertEqual(observed, [(self.f.engine, deadline, True)],
                         'Processing attestation must receive its original engine and actual deadline')
        self.assertEqual(self.authority.engine, self.f.engine,
                         'Processing attestation cannot replace the configured engine through an alias')

    def test_configured_engine_cannot_authorize_another_saved_engine(self):
        engine = {**self.f.engine, 'instanceId': 'Another configured engine'}
        self.authority = Authority(self.f.f.reader, engine, self.f.attest)
        with self.f.runtime.owner(), self.assertRaisesRegex(ValueError, 'configured original'):
            self.permit()

    def test_changed_saved_plan_cannot_replace_original_application_scope(self):
        plan = self.f.plan()
        plan['binding']['jobReference'] = 'Changed original job reference'
        path = next(self.f.f.root.glob('preparation-*/engine/plan.json'))
        original = path.read_bytes()
        prepared_path = path.parent.parent / 'prepared.json'
        prepared_original = prepared_path.read_bytes()
        prepared = json.loads(prepared_original)
        prepared['enginePlanSha256'] = hashlib.sha256(json_bytes(plan)).hexdigest()
        prepared_path.write_bytes(json_bytes(prepared))
        try:
            path.write_bytes(json_bytes(plan))
            with self.f.runtime.owner(), self.assertRaisesRegex(ValueError, 'saved application original'):
                self.permit(plan)
        finally:
            path.write_bytes(original)
            prepared_path.write_bytes(prepared_original)

    def test_mixed_saved_engine_plan_cannot_replace_prepared_task(self):
        plan = self.f.plan()
        plan['name'] = 'Another valid saved plan'
        path = next(self.f.f.root.glob('preparation-*/engine/plan.json'))
        original = path.read_bytes()
        try:
            path.write_bytes(json_bytes(plan))
            with self.f.runtime.owner(), self.assertRaisesRegex(ValueError, 'prepared runtime record'):
                self.permit(plan)
        finally:
            path.write_bytes(original)

    def test_prepared_engine_digest_is_required_before_current_access(self):
        path = next(self.f.f.root.glob('preparation-*/prepared.json'))
        original = path.read_bytes()
        value = json.loads(original)
        before = len(self.f.f.calls)
        try:
            path.write_bytes(json_bytes({**value, 'enginePlanSha256': '0'*64}))
            with self.f.runtime.owner(), self.assertRaisesRegex(ValueError, 'prepared runtime record'):
                self.permit()
            self.assertEqual(len(self.f.f.calls), before, 'Changed preparation cannot query current processing access')
        finally:
            path.write_bytes(original)


if __name__ == '__main__':
    unittest.main()
