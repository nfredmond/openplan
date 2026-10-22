"""Supervised loopback bodies and supplied engine checks, not engine provenance."""
from concurrent.futures import ThreadPoolExecutor
import copy
import io
import time
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import original_output_http as module
import test_task_observation as plans
import test_url_transport as network


class Checks(unittest.TestCase):
    def setUp(self):
        self.plan_fixture = plans.Checks()
        self.plan_fixture.setUp()
        self.addCleanup(self.plan_fixture.tearDown)
        self.network = network.Checks()
        self.network.setUp()
        self.addCleanup(self.network.tearDown)
        self.plan = copy.deepcopy(self.plan_fixture.plan)
        self.plan['engine']['endpoint'] = self.network.url
        self.checks = []
        self.resolutions = []
        self.cancelled = False
        self.owner = True
        self.token = None
        self.attested = True

    def resolve(self, reference):
        self.resolutions.append(reference)
        return self.token

    def attest(self, engine, deadline):
        self.checks.append((copy.deepcopy(engine), deadline))
        return self.attested

    def transport(self, **changes):
        return module.Transport(self.plan, changes.pop('resolve', self.resolve), changes.pop('attest', self.attest),
            **{'cancelled': lambda: self.cancelled, **changes})

    def call(self, transport=None, plan=None, output=None, limit=4096, deadline=None, owned=None):
        output = io.BytesIO() if output is None else output
        count = (transport or self.transport())(self.plan if plan is None else plan, output,
            limit, time.monotonic() + 3 if deadline is None else deadline,
            owned=(lambda: self.owner) if owned is None else owned)
        return count, output

    def test_fixed_original_get_streams_exact_bytes_with_two_engine_checks(self):
        count, output = self.call()
        self.assertEqual(output.getvalue(), self.network.raw, 'Archive adapter must retain exact supervised body bytes')
        self.assertEqual(count, len(self.network.raw))
        self.assertEqual(self.network.requests[0]['path'], '/task/' + self.plan['taskUuid'] + '/download/all.zip', 'Only the original task archive route may be requested')
        self.assertEqual(len(self.checks), 2, 'Archive transfer must attest the original engine before and after GET')
        self.assertEqual(self.checks[0][1], self.checks[1][1])
        self.assertEqual(self.resolutions, [self.plan['engine']['credentialReference']])

    def test_token_is_encoded_for_only_the_fixed_original_endpoint(self):
        self.token = 'synthetic token+&/#value'
        self.call()
        path = urlsplit(self.network.requests[0]['path'])
        self.assertEqual(path.path, '/task/' + self.plan['taskUuid'] + '/download/all.zip')
        self.assertEqual(parse_qs(path.query), {'token': [self.token]}, 'Credential must remain a query value on the original endpoint')

    def test_changed_plan_refuses_before_engine_or_network(self):
        changed = copy.deepcopy(self.plan)
        changed['name'] = 'Other original task'
        with self.assertRaisesRegex(ValueError, 'request plan differs'):
            self.call(plan=changed)
        self.assertEqual(self.checks, [])
        self.assertEqual(self.network.requests, [])

    def test_pre_cancelled_call_refuses_before_resolution_and_engine(self):
        self.cancelled = True
        with self.assertRaisesRegex(InterruptedError, 'download cancelled'):
            self.call()
        self.assertEqual(self.checks, [])
        self.assertEqual(self.resolutions, [])
        self.assertEqual(self.network.requests, [])

    def test_ended_owner_refuses_before_resolution_and_engine(self):
        self.owner = False
        with self.assertRaisesRegex(InterruptedError, 'ownership ended'):
            self.call()
        self.assertEqual(self.checks, [])
        self.assertEqual(self.network.requests, [])

    def test_ownership_and_cancellation_require_boolean_values(self):
        self.owner = 1
        with self.assertRaisesRegex(ValueError, 'ownership must be a boolean'):
            self.call()
        self.owner = True
        self.cancelled = 1
        with self.assertRaisesRegex(ValueError, 'cancellation must be a boolean'):
            self.call()

    def test_deadline_and_writer_bound_precede_engine_or_child(self):
        with self.assertRaises(TimeoutError):
            self.call(deadline=time.monotonic() - 1)
        for limit, output in [(False, io.BytesIO()), (0, io.BytesIO()), (2**63, io.BytesIO()), (1, object())]:
            with self.subTest(limit=limit), self.assertRaisesRegex(ValueError, 'bounded byte writer'):
                self.call(limit=limit, output=output)
        self.assertEqual(self.checks, [], 'Invalid writer or limits must be refused before engine checks')
        self.assertEqual(self.network.requests, [])

    def test_engine_check_requires_exact_true(self):
        for value in (False, None, 1, {'allowed': True}):
            self.attested = value
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'engine check refused'):
                self.call()
        self.assertEqual(self.network.requests, [], 'Unconfirmed engine cannot receive an archive request')

    def test_revoked_engine_after_body_refuses_success(self):
        def attest(engine, deadline):
            self.checks.append((engine, deadline))
            return len(self.checks) == 1
        with self.assertRaisesRegex(ValueError, 'engine check refused'):
            self.call(transport=self.transport(attest=attest))

    def test_bad_credential_and_resolver_error_do_not_launch_request(self):
        for value in (1, '', 'x' * 8193):
            self.token = value
            with self.subTest(value=type(value).__name__), self.assertRaisesRegex(ValueError, 'credential value differs'):
                self.call()
        def wrong(_reference):
            raise RuntimeError('Synthetic private credential detail')
        with self.assertRaisesRegex(ValueError, '^Original archive credential resolution failed$'):
            self.call(transport=module.Transport(self.plan, wrong, self.attest))
        self.assertEqual(self.network.requests, [])

    def test_redirect_partial_and_oversized_bodies_refuse(self):
        self.network.mode = 'partial_status'
        with self.assertRaisesRegex(ValueError, 'did not complete'):
            self.call()
        self.network.mode = 'truncated'
        with self.assertRaisesRegex(ValueError, 'did not complete'):
            self.call()
        self.network.mode = 'ordinary'
        with self.assertRaisesRegex(ValueError, 'did not complete'):
            self.call(limit=1)
        self.plan['engine']['endpoint'] = self.network.url + '/redirect'
        with self.assertRaisesRegex(ValueError, 'did not complete'):
            self.call()
        self.assertEqual(len(self.network.requests), 4, 'Original archive redirects must not reach another endpoint')

    def test_cancelled_body_closes_the_actual_response(self):
        self.network.mode = 'held_body'
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(self.call)
            try:
                self.assertTrue(self.network.entered.wait(2), 'Actual archive body must be entered before cancellation')
                self.cancelled = True
                self.assertTrue(self.network.closed.wait(1), 'Cancelled archive request must physically close its response before deadline')
                with self.assertRaisesRegex(InterruptedError, 'download cancelled'):
                    future.result(timeout=3)
            finally:
                self.network.release.set()

    def test_owner_loss_during_body_closes_the_actual_response(self):
        self.network.mode = 'held_body'
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(self.call)
            try:
                self.assertTrue(self.network.entered.wait(2))
                self.owner = False
                self.assertTrue(self.network.closed.wait(1), 'Ended archive ownership must physically close its response before deadline')
                with self.assertRaisesRegex(InterruptedError, 'ownership ended'):
                    future.result(timeout=3)
            finally:
                self.network.release.set()

    def test_boolean_local_write_cannot_confirm_a_one_byte_body(self):
        class BooleanWriter:
            def write(self, payload):
                return True
        self.network.raw = b'x'
        with self.assertRaisesRegex(ValueError, 'writer did not retain the complete chunk'):
            self.call(output=BooleanWriter())

    def test_empty_complete_http_body_is_not_archive_success(self):
        self.network.raw = b''
        with self.assertRaisesRegex(ValueError, 'complete byte count differs'):
            self.call()

    def test_constructor_requires_adapters_and_captured_literal_address(self):
        for resolve, attest in [(None, self.attest), (self.resolve, None)]:
            with self.assertRaisesRegex(ValueError, 'explicit adapters'):
                module.Transport(self.plan, resolve, attest)
        plan = copy.deepcopy(self.plan)
        plan['engine']['endpoint'] = 'http://uncaptured.example:3000'
        with self.assertRaisesRegex(ValueError, 'captured literal address'):
            module.Transport(plan, self.resolve, self.attest)


if __name__ == '__main__':
    unittest.main()
