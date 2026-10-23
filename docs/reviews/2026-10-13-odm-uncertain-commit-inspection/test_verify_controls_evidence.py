"""Synthetic verifier evidence checks. Never import or execute worker modules."""
import errno
import importlib.util
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
SPEC = importlib.util.spec_from_file_location('uncertain_commit_controls_evidence', HERE / 'verify_controls.py')
CONTROLS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CONTROLS)
SOURCES = (
    'uncertain_commit_inspection.py', 'runtime_observation.py', 'runtime_draft.py',
    'engine_effects.py', 'runtime_preparation.py',
)


class EvidenceChecks(unittest.TestCase):
    def setUp(self):
        previous_umask = os.umask(0o077)
        self.addCleanup(os.umask, previous_umask)
        directory = tempfile.TemporaryDirectory(prefix='odm-verifier-evidence-')
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.out = self.root / 'evidence'
        self.out.mkdir()
        self.module = self.root / 'workers/odm_worker/uncertain_commit_inspection.py'

    def assert_invocation(self, child, test=None):
        name = 'test_uncertain_commit_inspection' + ('.Checks.' + test if test else '')
        child.assert_called_once_with(
            [sys.executable, '-B', '-m', 'unittest', '-v', name], cwd=self.module.parent,
            capture_output=True, text=True, timeout=30,
            env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'},
        )

    # Owned directories make the actual artifact writes raise IsADirectoryError.
    def block_artifacts(self, out, names):
        for name in names:
            (out / name).mkdir()

    # A directory is a refusal fixture, never a successful evidence artifact.
    def assert_artifacts(self, out, expected, denied=()):
        for name, payload in expected.items():
            path = out / name
            if name in denied:
                self.assertTrue(path.is_dir(), name + ' must retain its blocking directory')
            else:
                self.assertTrue(path.is_file(), name + ' must be a regular file')
                self.assertEqual(path.read_bytes(), payload, name)

    # Each named cause proves an attempted blocked write, without assuming order.
    def assert_timeout_write_errors(self, timeout, denied):
        notes = [note for note in timeout.__notes__ if note.startswith('TIMEOUT EVIDENCE FAILURE: ')]
        self.assertEqual(len(notes), 1)
        for name in denied:
            self.assertIn('EVIDENCE FAILURE: ' + name + ': IsADirectoryError(', notes[0])
        self.assertIn('ExceptionGroup(', notes[0])
        self.assertEqual(notes[0].count('RuntimeError('), len(denied))
        self.assertEqual(notes[0].count('IsADirectoryError('), len(denied))

    def assert_ordinary_write_errors(self, group, out, denied):
        self.assertEqual(len(group.exceptions), len(denied))
        paths = []
        for failure in group.exceptions:
            self.assertIs(type(failure), RuntimeError)
            cause = failure.__cause__
            self.assertIs(type(cause), IsADirectoryError)
            self.assertEqual(cause.errno, errno.EISDIR)
            paths.append(cause.filename)
            self.assertEqual(str(failure), 'EVIDENCE FAILURE: ' + Path(cause.filename).name + ': ' + repr(cause))
        self.assertCountEqual(paths, [str(out / name) for name in denied])

    def test_timeout_stream_matrix_keeps_identity_raw_bytes_and_readable_streams(self):
        streams = (
            (b'stdout\xff\x00\r\n', b'stderr\xfe\n', b'stdout\xff\x00\r\n', b'stderr\xfe\n', 'stdout\\xff\x00\r\n', 'stderr\\xfe\n'),
            ('stdout\N{SNOWMAN}\r\n', 'stderr\N{GREEK SMALL LETTER PI}\n', b'stdout\xe2\x98\x83\r\n', b'stderr\xcf\x80\n', 'stdout\N{SNOWMAN}\r\n', 'stderr\N{GREEK SMALL LETTER PI}\n'),
            (None, None, b'', b'', '', ''),
            (b'bytes\xff', 'text\N{SNOWMAN}', b'bytes\xff', b'text\xe2\x98\x83', 'bytes\\xff', 'text\N{SNOWMAN}'),
            (None, b'stderr only\x80', b'', b'stderr only\x80', '', 'stderr only\\x80'),
            ('stdout only', None, b'stdout only', b'', 'stdout only', ''),
            ('stdout\ud800\n', 'stderr\udfff\n', b'stdout\xed\xa0\x80\n', b'stderr\xed\xbf\xbf\n', 'stdout\\ud800\n', 'stderr\\udfff\n'),
        )
        for index, (stdout, stderr, expected_stdout, expected_stderr, readable_stdout, readable_stderr) in enumerate(streams):
            with self.subTest(index=index):
                label = 'partial-' + str(index)
                timeout = subprocess.TimeoutExpired(['synthetic-child'], 30, output=stdout, stderr=stderr)
                with patch.object(CONTROLS.subprocess, 'run', side_effect=timeout) as child:
                    with self.assertRaises(subprocess.TimeoutExpired) as caught:
                        CONTROLS.execute(self.module, self.out, label, 'synthetic_case')
                self.assertIs(caught.exception, timeout)
                self.assertIs(timeout.stdout, stdout)
                self.assertIs(timeout.stderr, stderr)
                self.assertEqual(timeout.cmd, ['synthetic-child'])
                self.assertEqual(timeout.timeout, 30)
                self.assert_invocation(child, 'synthetic_case')
                expected_log = (
                    'TIMEOUT: ' + label + '; limit=30 seconds\n'
                    'Raw streams: exact bytes; strings encoded as UTF-8 with surrogatepass; None is empty.\n'
                    '--- stdout (' + type(stdout).__name__ + ') ---\n' + readable_stdout
                    + '\n--- stderr (' + type(stderr).__name__ + ') ---\n' + readable_stderr
                )
                self.assert_artifacts(self.out, {
                    label + '-stdout-private.bin': expected_stdout,
                    label + '-stderr-private.bin': expected_stderr,
                    label + '-private.log': expected_log.encode('utf-8'),
                })
                self.assertIn('CONTROL TIMEOUT: ' + label, '\n'.join(timeout.__notes__))

    def test_ordinary_nonzero_keeps_classifier_input_and_both_diagnostics(self):
        stdout = 'child stdout\n'
        stderr = (
            'FAIL: synthetic_case (test_uncertain_commit_inspection.Checks.synthetic_case)\n'
            'AssertionError: synthetic diagnostic\nFAILED (failures=1)\n'
        )
        result = subprocess.CompletedProcess(['synthetic-child'], 1, stdout, stderr)
        with patch.object(CONTROLS.subprocess, 'run', return_value=result) as child:
            code, output = CONTROLS.execute(self.module, self.out, 'ordinary')
        self.assert_invocation(child)
        self.assertEqual((code, output), (1, stdout + stderr))
        self.assertTrue(CONTROLS.intended(code, output, 'synthetic_case', 'synthetic diagnostic', 'failures'))
        expected_log = (
            'RETURN CODE: 1; control=ordinary\n'
            'Raw streams: exact bytes; strings encoded as UTF-8 with surrogatepass; None is empty.\n'
            '--- stdout (str) ---\n' + stdout + '\n--- stderr (str) ---\n' + stderr
        )
        self.assert_artifacts(self.out, {
            'ordinary-stdout-private.bin': stdout.encode('utf-8'),
            'ordinary-stderr-private.bin': stderr.encode('utf-8'),
            'ordinary-private.log': expected_log.encode('utf-8'),
        })
        log = (self.out / 'ordinary-private.log').read_text()
        self.assertTrue(log.startswith('RETURN CODE: 1; control=ordinary\n'))
        self.assertIn(stdout, log)
        self.assertIn(stderr, log)

    def test_timeout_attempts_all_writes_and_reports_each_independent_failure(self):
        filenames = ('failed-stdout-private.bin', 'failed-stderr-private.bin', 'failed-private.log')
        expected = dict(zip(filenames, (b'out\xff', b'err\xfe', (
            b'TIMEOUT: failed; limit=30 seconds\n'
            b'Raw streams: exact bytes; strings encoded as UTF-8 with surrogatepass; None is empty.\n'
            b'--- stdout (bytes) ---\nout\\xff\n--- stderr (bytes) ---\nerr\\xfe'
        ))))
        for index, denied in enumerate(((filenames[0],), (filenames[1],), (filenames[2],), filenames)):
            with self.subTest(denied=denied):
                out = self.out / str(index)
                out.mkdir()
                timeout = subprocess.TimeoutExpired('synthetic-child', 30, output=b'out\xff', stderr=b'err\xfe')
                self.block_artifacts(out, denied)
                with patch.object(CONTROLS.subprocess, 'run', side_effect=timeout):
                    with self.assertRaises(subprocess.TimeoutExpired) as caught:
                        CONTROLS.execute(self.module, out, 'failed')
                self.assertIs(caught.exception, timeout)
                self.assert_artifacts(out, expected, denied)
                self.assert_timeout_write_errors(timeout, denied)

    def test_evidence_write_failure_never_returns_success_or_nonzero_result(self):
        filenames = ('ordinary-stdout-private.bin', 'ordinary-stderr-private.bin', 'ordinary-private.log')
        for code in (0, 1):
            for index, denied in enumerate(((filenames[0],), (filenames[1],), (filenames[2],), filenames)):
                with self.subTest(code=code, denied=denied):
                    out = self.out / (str(code) + '-' + str(index))
                    out.mkdir()
                    result = subprocess.CompletedProcess('synthetic-child', code, 'out\n', 'err\n')
                    self.block_artifacts(out, denied)
                    with patch.object(CONTROLS.subprocess, 'run', return_value=result):
                        with self.assertRaises(ExceptionGroup) as caught:
                            CONTROLS.execute(self.module, out, 'ordinary')
                    self.assert_ordinary_write_errors(caught.exception, out, denied)
                    expected_log = (
                        'RETURN CODE: ' + str(code) + '; control=ordinary\n'
                        'Raw streams: exact bytes; strings encoded as UTF-8 with surrogatepass; None is empty.\n'
                        '--- stdout (str) ---\nout\n\n--- stderr (str) ---\nerr\n'
                    )
                    self.assert_artifacts(out, dict(zip(filenames, (
                        b'out\n', b'err\n', expected_log.encode('utf-8'),
                    ))), denied)

    # Copy source text for controller bindings and census; no worker is imported.
    def copied_repo(self):
        directory = tempfile.TemporaryDirectory(prefix='controller-copy-', dir=self.root)
        self.addCleanup(directory.cleanup)
        repo = Path(directory.name)
        worker = repo / 'workers/odm_worker'
        worker.mkdir(parents=True)
        originals = {}
        for name in (*SOURCES, 'test_uncertain_commit_inspection.py'):
            path = worker / name
            originals[path] = (REPO / 'workers/odm_worker' / name).read_bytes()
            path.write_bytes(originals[path])
        return repo, originals

    def test_controller_restores_five_sources_and_test_after_timeout_or_write_failure(self):
        for stage in ('baseline', 'first-mutant'):
            for failure in ('timeout', 'timeout-write-errors', 'successful-child-write-error', 'nonzero-child-write-error', 'classifier'):
                with self.subTest(stage=stage, failure=failure):
                    repo, originals = self.copied_repo()
                    out = repo / 'evidence'
                    label = 'baseline' if stage == 'baseline' else 'uncertain-ack-promoted'
                    fail_at = 1 if stage == 'baseline' else 4
                    timeout = subprocess.TimeoutExpired('synthetic-child', 30, output=b'partial out\xff', stderr=b'partial err\xfe')
                    count = 0

                    def child(*args, **kwargs):
                        nonlocal count
                        count += 1
                        if count < fail_at:
                            return subprocess.CompletedProcess(args[0], 0, '', 'Ran 21 tests\n\nOK\n')
                        self.assertEqual(count, fail_at, 'Controller must stop at the primary failure')
                        for path, payload in originals.items():
                            if path.name in SOURCES:
                                path.write_bytes(payload + b'\n# Synthetic child dirtied this copied source.\n')
                        self.block_artifacts(out, denied)
                        if failure.startswith('timeout'):
                            raise timeout
                        code = 0 if failure == 'successful-child-write-error' else 1
                        return subprocess.CompletedProcess(args[0], code, 'synthetic stdout\n', 'synthetic stderr\n')

                    denied = set()
                    if failure == 'timeout-write-errors':
                        denied = {label + '-stdout-private.bin', label + '-stderr-private.bin', label + '-private.log'}
                    elif failure.endswith('write-error'):
                        denied = {label + '-private.log'}
                    expected = subprocess.TimeoutExpired if failure.startswith('timeout') else (
                        ExceptionGroup if failure.endswith('write-error') else AssertionError)
                    with patch.object(CONTROLS.subprocess, 'run', side_effect=child):
                        with self.assertRaises(expected) as caught:
                            CONTROLS.run(repo, out)
                    self.assertEqual(count, fail_at)
                    if failure.startswith('timeout'):
                        self.assertIs(caught.exception, timeout)
                    if failure == 'timeout-write-errors':
                        self.assert_timeout_write_errors(timeout, denied)
                    elif failure.endswith('write-error'):
                        self.assert_ordinary_write_errors(caught.exception, out, denied)
                    for path, payload in originals.items():
                        self.assertEqual(path.read_bytes(), payload, path.name + ' must restore exactly')
                    if failure.startswith('timeout'):
                        stdout, stderr = b'partial out\xff', b'partial err\xfe'
                        expected_log = (
                            'TIMEOUT: ' + label + '; limit=30 seconds\n'
                            'Raw streams: exact bytes; strings encoded as UTF-8 with surrogatepass; None is empty.\n'
                            '--- stdout (bytes) ---\npartial out\\xff\n--- stderr (bytes) ---\npartial err\\xfe'
                        )
                    else:
                        stdout, stderr = b'synthetic stdout\n', b'synthetic stderr\n'
                        code = 0 if failure == 'successful-child-write-error' else 1
                        expected_log = (
                            'RETURN CODE: ' + str(code) + '; control=' + label + '\n'
                            'Raw streams: exact bytes; strings encoded as UTF-8 with surrogatepass; None is empty.\n'
                            '--- stdout (str) ---\nsynthetic stdout\n\n--- stderr (str) ---\nsynthetic stderr\n'
                        )
                    self.assert_artifacts(out, {
                        label + '-stdout-private.bin': stdout,
                        label + '-stderr-private.bin': stderr,
                        label + '-private.log': expected_log.encode('utf-8'),
                    }, denied)
                    if failure == 'classifier':
                        self.assertIn('synthetic stdout', (out / (label + '-private.log')).read_text())
                        wanted = 'complete task-read cohort failed' if stage == 'baseline' else 'did not fail at its intended assertion'
                        self.assertIn(wanted, str(caught.exception))


class WorkflowChecks(unittest.TestCase):
    # This guard reads actual step fields at their indentation, not names in prose.
    # It covers this workflow layout, not the complete YAML or GitHub expression grammar.
    def steps(self):
        text = (REPO / '.github/workflows/odm-worker-regression.yml').read_text()
        self.assertEqual(text.count('\n  odm-worker:\n'), 1)
        job = text.split('\n  odm-worker:\n', 1)[1]
        self.assertNotRegex(job, r'(?m)^  [\w-]+:')
        blocks = re.split(r'(?m)^      - ', job)[1:]
        steps = []
        for block in blocks:
            first, _, rest = block.partition('\n')
            fields = dict(re.findall(r'^        ([\w-]+): (.+)$', '        ' + first + '\n' + rest, re.MULTILINE))
            with_fields = dict(re.findall(r'^          ([\w-]+): (.+)$', rest, re.MULTILINE))
            steps.append((fields, with_fields, rest))
        return steps

    def test_upload_is_immediately_after_failed_control_and_scope_is_exact(self):
        steps = self.steps()
        indices = [i for i, (fields, _, _) in enumerate(steps) if fields.get('id') == 'uncertain_commit_controls']
        self.assertEqual(len(indices), 1)
        index = indices[0]
        control, _, body = steps[index]
        self.assertEqual(control['run'], '|')
        self.assertNotIn('continue-on-error', control)
        self.assertNotIn('if', control)
        self.assertEqual(body.split('        run: |\n', 1)[1], (
            '          python3 -B docs/reviews/2026-10-13-odm-uncertain-commit-inspection/verify_controls.py \\\n'
            '            --repo "$GITHUB_WORKSPACE" --out "$RUNNER_TEMP/odm-uncertain-commit-inspection-controls"\n'
        ))
        upload, settings, _ = steps[index + 1]
        self.assertEqual(upload, {
            'name': 'Upload failed uncertain commit control diagnostics',
            'if': "${{ failure() && steps.uncertain_commit_controls.outcome == 'failure' }}",
            'uses': 'actions/upload-artifact@v4',
        })
        self.assertEqual(settings, {
            'name': 'odm-uncertain-commit-inspection-failure',
            'path': '${{ runner.temp }}/odm-uncertain-commit-inspection-controls/',
            'if-no-files-found': 'error', 'retention-days': '14',
        })
        later, _, _ = steps[index + 2]
        self.assertEqual(later['name'], 'Supplied output archive custody controls')
        self.assertNotIn('if', later)
        self.assertNotIn('continue-on-error', later)

    def test_focused_check_is_wired_before_dependencies_and_worker_execution(self):
        steps = self.steps()
        commands = [fields.get('run') for fields, _, _ in steps]
        command = 'python3 -B docs/reviews/2026-10-13-odm-uncertain-commit-inspection/test_verify_controls_evidence.py'
        self.assertEqual(commands.count(command), 1)
        focused = commands.index(command)
        self.assertEqual(steps[focused - 1][0]['uses'], 'actions/setup-python@v5')
        self.assertEqual(steps[focused - 1][1]['python-version'], '"3.11"')
        self.assertEqual(steps[focused + 1][0]['name'], 'Install lightweight worker dependencies')
        self.assertEqual(steps[focused + 2][0]['name'], 'All aerial worker suites')
        self.assertNotIn('if', steps[focused][0])
        self.assertNotIn('continue-on-error', steps[focused][0])


if __name__ == '__main__':
    unittest.main(verbosity=2)
