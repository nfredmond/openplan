"""Probe the actual controller's result parser with synthetic runner transcripts.

Only disposable files change. This tests classification, not unittest execution.
"""
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from types import SimpleNamespace


def main(output):
    controller = Path(__file__).parents[1]/'2026-10-15-t3code-concepts/scripts/verify_collector_controls.py'
    original = controller.read_bytes()
    tree = ast.parse(original)
    runner = next(node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef) and node.name == 'run')
    method, needle = 'test_expected_boundary', 'required assertion diagnostic'
    failure = f'FAIL: {method} (__main__.CollectorTests.{method})\nAssertionError: {needle}\nFAILED (failures=1)\n'
    positive = 'Ran 19 tests in 0.01s\n\nOK\n'
    cases = [
        ('baseline', 0, positive, None, True),
        ('harmless-comment', 0, positive, None, True),
        ('intended-assertion', 1, failure, method, True),
        ('wrong-diagnostic', 1, failure.replace(needle, 'unrelated assertion'), method, False),
        ('source-echo-with-wrong-assertion', 1,
         failure.replace('AssertionError: ' + needle, "    self.assertFalse(value, '" + needle + "')\nAssertionError: unrelated"),
         method, False),
        ('wrong-method', 1, failure.replace(method, 'test_unrelated_boundary'), method, False),
        ('additional-unrelated-failure', 1, failure + failure.replace(method, 'test_unrelated_boundary'), method, False),
        ('additional-error', 1, failure + '\nERROR: test_other (CollectorTests)\nRuntimeError: unrelated\n', method, False),
        ('syntax-failure', 1, failure + 'SyntaxError: invalid syntax\n', method, False),
        ('zero-exit-failure-text', 0, failure, method, False),
        ('missing-failure-footer', 1, failure.replace('FAILED (failures=1)', ''), method, False),
        ('old-twelve-method-cohort', 0, positive.replace('19', '12'), None, False),
        ('baseline-nonzero', 1, positive, None, False),
        ('baseline-without-ok', 0, positive.replace('OK', ''), None, False),
    ]
    observed = []
    with tempfile.TemporaryDirectory() as temporary:
        directory = Path(temporary)
        source = directory/'disposable-source.py'
        source.write_bytes(b'# original\n')
        try:
            for label, code, transcript, selected, expected in cases:
                records = []
                environment = {'source': source, 'directory': directory, 'tests': directory/'unused-test.py',
                               'output': directory, 'records': records, 'sys': sys, 'os': os, 're': re,
                               'subprocess': SimpleNamespace(run=lambda *args, **kwargs:
                                                            subprocess.CompletedProcess([], code, transcript, ''))}
                exec(compile(ast.Module(body=[runner], type_ignores=[]), str(controller), 'exec'), environment)
                try:
                    environment['run'](label, b'# harmless change\n', selected, needle if selected else None)
                except AssertionError:
                    accepted = False
                else:
                    accepted = True
                if accepted != expected or bool(records[-1]['matched']) != expected:
                    raise AssertionError('Controller misclassified synthetic runner transcript: ' + label)
                observed.append({'case': label, 'accepted': accepted, 'expected': expected})
        finally:
            source.write_bytes(b'# original\n')
    if controller.read_bytes() != original:
        raise AssertionError('Classifier probe changed the controller')
    output.write_text(json.dumps({'checks': observed, 'controllerUnchanged': True,
                                 'controllerSha256': hashlib.sha256(original).hexdigest(),
                                 'pythonVersion': sys.version,
                                 'blindCategory': 'Synthetic transcripts do not prove the unittest runner executes intended source.'},
                                indent=2) + '\n')
    print(json.dumps({'classifierChecks': len(observed), 'controllerUnchanged': True}))


if __name__ == '__main__':
    main(Path(sys.argv[1]))
