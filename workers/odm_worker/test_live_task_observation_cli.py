"""Explicit live command routing and actual loopback interruption boundaries."""
from contextlib import redirect_stderr, redirect_stdout, contextmanager
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import unittest
from unittest.mock import patch

import task_observation_cli as module
import test_original_task_http as fixtures


class Checks(unittest.TestCase):
    def setUp(self):
        fixtures.Checks.setUp(self)
        self.credential = self.fixture.base / 'credential.json'
        self.credential.write_text(json.dumps({'format': module.CREDENTIAL_FORMAT,
            'credentialReference': self.plan['engine']['credentialReference'], 'token': self.token}))
        self.credential.chmod(0o600)
    tearDown = fixtures.Checks.tearDown

    def arguments(self):
        return {'fetch': True, 'daemon_socket': Path('/synthetic/daemon.sock'),
            'daemon_uid': 0, 'credential_file': self.credential, 'owned': lambda: True}

    def call(self, **changes):
        return module.execute(self.fixture.root, self.records, timeout=1.5, **{**self.arguments(), **changes})

    def argv(self):
        return ['--engine-root', str(self.fixture.root), '--records-root', str(self.records),
            '--fetch-original', '--daemon-socket', '/synthetic/daemon.sock', '--daemon-uid', '0',
            '--credential-file', str(self.credential), '--timeout', '1.5']

    def test_original_fetch_routes_to_owned_read_and_retention(self):
        checks = []
        def attest(engine, deadline, *, owned):
            self.assertEqual(engine, self.plan['engine'])
            self.assertIs(owned(), True)
            checks.append(engine)
            return True
        with patch.object(module, 'Attestor', return_value=attest) as constructor:
            result = self.call()
        constructor.assert_called_once_with(self.plan['engine'], '/synthetic/daemon.sock', 0)
        expected = json.dumps(self.value, indent=2).encode() + b'\n'
        self.assertEqual(result['bodySha256'], hashlib.sha256(expected).hexdigest(), 'Live command summary must bind actual reply bytes')
        self.assertEqual(len(self.requests), 1, 'Explicit fetch must issue one actual GET')
        self.assertEqual(len(checks), 2, 'Explicit fetch must keep both original engine checks')
        self.assertEqual(module.execute(self.fixture.root, self.records, digest=result['bodySha256']), result)
        self.assertIs(result['publicationPermission'], False)
        self.assertNotIn(self.token, json.dumps(result), 'Live command cannot print credentials')

    def test_fetch_inputs_and_mixed_modes_refuse_before_plan_read(self):
        cases = [{'record_file': self.credential}, {'digest': '0' * 64}, {'fetch': 1},
            {'response_status': 200}, {'daemon_socket': None}, {'daemon_uid': None},
            {'daemon_uid': True}, {'daemon_uid': -1}, {'credential_file': None}, {'owned': None}]
        for changed in cases:
            with self.subTest(changed=changed), patch.object(module, 'read_json', side_effect=AssertionError('Invalid fetch inputs reached plan read')):
                with self.assertRaises(ValueError):
                    self.call(**changed)

    def test_local_modes_refuse_native_inputs_before_plan_read(self):
        for key, value in [('daemon_socket', '/private/socket'), ('daemon_uid', 0),
                           ('credential_file', self.credential), ('owned', lambda: True)]:
            with self.subTest(key=key), patch.object(module, 'read_json', side_effect=AssertionError('Native inputs reached local mode plan read')):
                with self.assertRaisesRegex(ValueError, 'fetch inputs are permitted'):
                    module.execute(self.fixture.root, self.records, digest='0' * 64, **{key: value})

    def test_ended_or_nonboolean_owner_refuses_before_plan_read(self):
        for decision in (False, 1, None):
            with self.subTest(decision=decision), patch.object(module, 'read_json', side_effect=AssertionError('Ended fetch owner reached plan read')):
                with self.assertRaises((ValueError, InterruptedError)):
                    self.call(owned=lambda: decision)

    def test_credential_file_binding_and_duplicate_keys_refuse(self):
        original = self.credential.read_bytes()
        valid = json.loads(original)
        for changed in ({'format': 'other'}, {'credentialReference': 'other'}, {'extra': True},
                        {'token': ''}, {'token': 1}, {'token': 'x' * 8193}):
            self.credential.write_text(json.dumps({**valid, **changed}))
            with self.subTest(changed=list(changed)), patch.object(module, 'Attestor', side_effect=AssertionError('Invalid credential reached native engine construction')), self.assertRaisesRegex(ValueError, 'credential binding differs|credential value differs'):
                self.call()
        self.credential.write_text(original.decode().replace('"format":', '"format":"other", "format":'))
        with patch.object(module, 'Attestor', side_effect=AssertionError('Invalid credential reached native engine construction')), self.assertRaisesRegex(ValueError, 'repeats a JSON key'):
            self.call()
        self.assertEqual(self.requests, [])
        self.assertEqual(list(self.records.iterdir()), [], 'Invalid credentials cannot publish metadata')

    def test_credential_bound_precedes_body_read(self):
        with self.credential.open('r+b') as stream:
            stream.truncate(module.CREDENTIAL_LIMIT + 1)
        original = module.reader
        @contextmanager
        def bounded(*args):
            with original(*args) as (stream, info):
                class NoRead:
                    def read(self, *unused):
                        raise AssertionError('Oversized credential reached body read')
                yield NoRead(), info
        with patch.object(module, 'reader', side_effect=bounded):
            with self.assertRaisesRegex(ValueError, 'credential file exceeds'):
                self.call()

    def test_credential_alias_and_permissions_refuse(self):
        alias = self.fixture.base / 'credential-alias.json'
        alias.symlink_to(self.credential)
        with patch.object(module, 'Attestor', side_effect=AssertionError('Unsafe credential file reached native engine construction')), self.assertRaisesRegex(ValueError, 'without aliases'):
            self.call(credential_file=alias)
        self.credential.chmod(0o644)
        with patch.object(module, 'Attestor', side_effect=AssertionError('Unsafe credential file reached native engine construction')), self.assertRaisesRegex(ValueError, 'private'):
            self.call()

    def test_public_credential_parent_refuses(self):
        directory = self.fixture.base / 'public-config'
        directory.mkdir(mode=0o755)
        directory.chmod(0o755)
        path = directory / 'credential.json'
        path.write_bytes(self.credential.read_bytes())
        path.chmod(0o600)
        with patch.object(module, 'Attestor', side_effect=AssertionError('Public credential directory reached native engine construction')), self.assertRaisesRegex(ValueError, 'private'):
            self.call(credential_file=path)

    def test_credential_read_does_not_restart_deadline(self):
        original = module.reader
        original_time = time.monotonic
        late = False
        @contextmanager
        def delayed(*args):
            nonlocal late
            with original(*args) as value:
                yield value
            late = True
        with patch.object(module, 'reader', side_effect=delayed), patch.object(module.time, 'monotonic', side_effect=lambda: original_time() + (10 if late else 0)), patch.object(module, 'Attestor', side_effect=AssertionError('Late credential reached native engine construction')):
            with self.assertRaises(TimeoutError):
                self.call()
        self.assertEqual(self.requests, [])

    def test_signal_owner_and_original_handlers_restore(self):
        previous = {name: signal.getsignal(name) for name in (signal.SIGINT, signal.SIGTERM)}
        calls = []
        def execute(*args, **kwargs):
            self.assertTrue(kwargs['fetch'])
            self.assertIs(kwargs['owned'](), True)
            signal.getsignal(signal.SIGTERM)(signal.SIGTERM, None)
            self.assertIs(kwargs['owned'](), False, 'Operator signal must end fetch ownership')
            calls.append(True)
            raise InterruptedError('Synthetic original-read interruption')
        try:
            with patch.object(module, 'execute', side_effect=execute), redirect_stdout(io.StringIO()) as output, redirect_stderr(io.StringIO()):
                self.assertEqual(module.main(self.argv()), 2)
            self.assertEqual(calls, [True])
            self.assertEqual(output.getvalue(), '', 'Interrupted command cannot print success')
            self.assertEqual({name: signal.getsignal(name) for name in previous}, previous, 'Command must restore the original signal handlers')
        finally:
            for name, handler in previous.items():
                signal.signal(name, handler)

    def test_actual_operator_signal_stops_loopback_read(self):
        self.mode = 'held'
        args = self.argv()
        args[-1] = '10'
        code = 'import sys\nsys.path.insert(0,' + repr(str(Path(module.__file__).parent)) + ')\nimport task_observation_cli as cli\ncli.Attestor=lambda *args: lambda *args,**kwargs: True\nraise SystemExit(cli.main(' + repr(args) + '))\n'
        owner = subprocess.Popen([sys.executable, '-B', '-c', code], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            self.assertTrue(self.entered.wait(timeout=2), 'Operator interruption must follow an actual GET')
            owner.send_signal(signal.SIGTERM)
            stdout, stderr = owner.communicate(timeout=1)
            self.assertEqual(owner.returncode, 2, 'Interrupted actual command must exit two')
            self.assertEqual(stdout, b'', 'Interrupted actual command cannot print success')
            self.assertTrue(self.closed.wait(timeout=1), 'Operator signal must close the actual connection')
            self.assertEqual(list(self.records.iterdir()), [], 'Interrupted actual read cannot publish metadata')
            self.assertNotIn(self.token.encode(), stderr)
        finally:
            if owner.poll() is None:
                owner.kill()
            owner.wait(timeout=3)
            for handle in (owner.stdout, owner.stderr):
                handle.close()

    def test_actual_bad_credentials_keep_private_diagnostics(self):
        for payload in (b'{"private-marker":"PRIVATE_CREDENTIAL_MARKER"}', b'[' * 2000 + b']' * 2000, b'\xff'):
            self.credential.write_bytes(payload)
            result = subprocess.run([sys.executable, '-B', str(Path(module.__file__).resolve()), *self.argv()], capture_output=True, text=True, timeout=3)
            self.assertEqual(result.returncode, 2, 'Malformed credential must refuse with code two')
            self.assertEqual(result.stdout, '')
            self.assertNotIn('PRIVATE_CREDENTIAL_MARKER', result.stderr)
            self.assertNotIn(str(self.credential), result.stderr)
        self.assertEqual(self.requests, [])

    def test_credential_decoder_depth_refuses(self):
        with patch.object(module.json, 'loads', side_effect=RecursionError('Synthetic decoder depth boundary')):
            with self.assertRaisesRegex(ValueError, 'credential JSON depth differs'):
                module.credential(self.credential, self.plan['engine']['credentialReference'], time.monotonic() + 1)

    def test_signal_during_handler_restoration_refuses_success(self):
        previous = {name: signal.getsignal(name) for name in (signal.SIGINT, signal.SIGTERM)}
        original = signal.signal
        injected = False
        def restore(name, handler):
            nonlocal injected
            if name == signal.SIGTERM and handler == previous[name] and not injected:
                injected = True
                signal.getsignal(name)(name, None)
            return original(name, handler)
        try:
            with patch.object(module, 'execute', return_value={'bodySha256': 'a' * 64}), patch.object(module.signal, 'signal', side_effect=restore), redirect_stdout(io.StringIO()) as output, redirect_stderr(io.StringIO()):
                code = module.main(self.argv())
            self.assertTrue(injected, 'Final-window signal must arrive during handler restoration')
            self.assertEqual(code, 2, 'Final-window cancellation must refuse success')
            self.assertEqual(output.getvalue(), '', 'Final-window cancellation cannot print a success summary')
            self.assertEqual({name: signal.getsignal(name) for name in previous}, previous)
        finally:
            for name, handler in previous.items():
                original(name, handler)


if __name__ == '__main__':
    unittest.main()
