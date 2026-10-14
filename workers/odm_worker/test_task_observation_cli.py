"""Actual local command invocation against private original-plan records."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import unittest
from unittest.mock import patch

import task_observation_cli as module
import test_retained_task_observation as fixtures


class Checks(unittest.TestCase):
    def setUp(self):
        fixtures.Checks.setUp(self)
        self.value['status']['errorMessage'] = 'synthetic-private-error-detail'
        self.body = json.dumps(self.value, indent=2).encode() + b'\n'
        self.reply = self.fixture.base / 'reply-private.json'
        self.reply.write_bytes(self.body)
        self.reply.chmod(0o600)
    tearDown = fixtures.Checks.tearDown

    def call(self, *, record=True, digest=None, **kwargs):
        return module.execute(self.fixture.root, self.records_root,
            record_file=self.reply if record else None, response_status=200 if record else None,
            digest=digest, **kwargs)

    def cli(self, *args):
        return subprocess.run([sys.executable, '-B', str(Path(module.__file__).resolve()),
            '--engine-root', str(self.fixture.root), '--records-root', str(self.records_root), *args],
            capture_output=True, text=True, cwd=self.fixture.base, timeout=10,
            env={**os.environ, 'PYTHONDONTWRITEBYTECODE':'1'})

    def test_actual_record_read_and_private_root_relocation(self):
        first = self.cli('--record-file', str(self.reply), '--response-status', '200')
        self.assertEqual(first.returncode, 0, 'Actual record command must succeed')
        result = json.loads(first.stdout)
        self.assertEqual(result['bodySha256'], hashlib.sha256(self.body).hexdigest(),
                         'Command summary must bind actual supplied reply bytes')
        read = self.cli('--read-digest', result['bodySha256'])
        self.assertEqual(read.returncode, 0, 'Actual read command must succeed')
        self.assertEqual(json.loads(read.stdout), result, 'Command read must retain the original bounded summary')
        engine = self.fixture.base / 'copied-engine'
        records = self.fixture.base / 'copied-records'
        shutil.copytree(self.fixture.root, engine)
        shutil.copytree(self.records_root, records)
        self.assertEqual(module.execute(engine, records, digest=result['bodySha256']), result,
                         'Relocated command roots must retain the original summary')

    def test_summary_excludes_raw_body_error_details_and_engine_configuration(self):
        result = self.call()
        self.assertEqual(set(result), set(module.SUMMARY_FIELDS))
        text = json.dumps(result)
        for field in ('bodyBase64', 'reportedErrorDetail', 'engine', 'requestedOptions', 'reportedOptions'):
            self.assertNotIn(field, result, 'Command summary must exclude private detail field ' + field)
        self.assertNotIn('synthetic-private-error-detail', text, 'Command summary cannot print raw private error detail')
        self.assertNotIn(str(self.fixture.root), text, 'Command summary cannot print private root paths')

    def test_mode_validation_precedes_any_plan_read(self):
        for record, digest in ((None, None), (self.reply, '0' * 64)):
            with patch.object(module, 'read_json', side_effect=AssertionError('Invalid mode reached plan read')):
                with self.assertRaisesRegex(ValueError, 'exactly one'):
                    module.execute(self.fixture.root, self.records_root, record_file=record, digest=digest)

    def test_explicit_status_type_and_read_status_refuse_before_plan_read(self):
        for record, status, digest in [(self.reply, v, None) for v in (None, True, '200', 200.0)] + [(None, 200, '0' * 64)]:
            with patch.object(module, 'read_json', side_effect=AssertionError('Invalid status reached plan read')):
                with self.assertRaisesRegex(ValueError, 'explicit integer response status'):
                    module.execute(self.fixture.root, self.records_root, record_file=record,
                                   response_status=status, digest=digest)

    def test_timeout_validation_precedes_any_plan_read(self):
        for timeout in (True, None, 0, -1, float('inf'), float('nan'), 10 ** 400):
            with patch.object(module, 'read_json', side_effect=AssertionError('Invalid timeout reached plan read')):
                with self.assertRaisesRegex(ValueError, 'timeout must be positive and finite'):
                    self.call(timeout=timeout)

    def test_supplied_file_size_refuses_before_reading_the_body(self):
        with self.reply.open('r+b') as stream:
            stream.truncate(1048577)
        original = module.reader
        from contextlib import contextmanager
        @contextmanager
        def bounded_reader(*args):
            with original(*args) as (stream, info):
                class NoBodyRead:
                    def read(self, *unused):
                        raise AssertionError('Oversized input reached body reading')
                yield NoBodyRead(), info
        with patch.object(module, 'reader', side_effect=bounded_reader):
            with self.assertRaisesRegex(ValueError, 'Supplied task reply exceeds'):
                self.call()
        self.assertEqual(list(self.records_root.iterdir()), [], 'Oversized input cannot write observation records')

    def test_supplied_body_paths_aliases_and_permissions_refuse(self):
        alias = self.fixture.base / 'reply-alias.json'
        alias.symlink_to(self.reply)
        with self.assertRaisesRegex(ValueError, 'without aliases'):
            module.execute(self.fixture.root, self.records_root, record_file=alias, response_status=200)
        self.reply.chmod(0o644)
        with self.assertRaisesRegex(ValueError, 'private'):
            self.call()

    def test_public_input_directory_refuses_even_with_a_private_reply(self):
        folder = self.fixture.base / 'public-input'
        folder.mkdir(mode=0o755)
        folder.chmod(0o755)
        reply = folder / 'private-reply.json'
        reply.write_bytes(self.body)
        reply.chmod(0o600)
        with self.assertRaisesRegex(ValueError, 'private'):
            module.execute(self.fixture.root, self.records_root, record_file=reply, response_status=200)
        self.assertEqual(list(self.records_root.iterdir()), [], 'Public input directory cannot publish metadata')

    def test_shared_deadline_covers_input_read_and_recording(self):
        original = module.reader
        original_time = time.monotonic
        late = False
        from contextlib import contextmanager
        @contextmanager
        def delayed_reader(*args):
            nonlocal late
            with original(*args) as value:
                yield value
            late = True
        with patch.object(module, 'reader', side_effect=delayed_reader), \
             patch.object(module.time, 'monotonic', side_effect=lambda: original_time() + (10 if late else 0)):
            with self.assertRaisesRegex(TimeoutError, 'deadline exceeded'):
                self.call()
        self.assertEqual(list(self.records_root.iterdir()), [], 'Late input cannot publish a record')

    def test_actual_failure_has_no_summary_or_private_diagnostic(self):
        self.reply.write_bytes(b'synthetic-secret-invalid-reply')
        result = self.cli('--record-file', str(self.reply), '--response-status', '200')
        self.assertEqual(result.returncode, 2, 'Actual refused command must exit two')
        self.assertEqual(result.stdout, '', 'Refused command cannot print a success summary')
        self.assertEqual(result.stderr, 'Task observation refused. Check the private roots, original plan, reply bytes and command inputs.\n')
        self.assertNotIn('synthetic-secret-invalid-reply', result.stderr)
        self.assertNotIn(str(self.reply), result.stderr)

    def test_parser_requires_roots_and_exactly_one_operation(self):
        roots = ['--engine-root', str(self.fixture.root), '--records-root', str(self.records_root)]
        record = ['--record-file', str(self.reply), '--response-status', '200']
        for args in [[], ['--engine-root', str(self.fixture.root)],
                     ['--record-file', str(self.reply), '--read-digest', '0' * 64],
                     roots, record, roots[:2] + record, roots[2:] + record]:
            result = subprocess.run([sys.executable, '-B', str(Path(module.__file__).resolve()), *args],
                capture_output=True, text=True, cwd=self.fixture.base, timeout=10)
            self.assertEqual(result.returncode, 2, 'Incomplete command must fail argument validation')
            self.assertEqual(result.stdout, '')
            self.assertTrue(result.stderr.startswith('usage:'),
                            'Incomplete command must fail in the argument parser')

    def test_record_replay_preserves_the_original_file_and_denied_claims(self):
        result = self.call()
        path = self.records_root / (result['bodySha256'] + '.json')
        original = path.read_bytes()
        inode = path.stat().st_ino
        self.assertEqual(self.call(), result)
        self.assertEqual(path.read_bytes(), original)
        self.assertEqual(path.stat().st_ino, inode, 'Command replay cannot replace its original record')
        for field in ('engineIdentityVerification', 'originalActorAuthorization', 'sourceCustodyVerification',
                      'effectiveExecutionSettingsVerification', 'processingQualityVerification', 'freshnessVerification'):
            self.assertEqual(result[field], 'unassessed', 'Command cannot promote ' + field)
        for field in ('transportPermission', 'publicationPermission'):
            self.assertIs(result[field], False, 'Command cannot grant ' + field)


if __name__ == '__main__':
    unittest.main()
