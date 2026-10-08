"""Check missing-count refusal through the actual validation function."""
import hashlib
import inspect
import io
import json
from pathlib import Path
import sys
from types import FunctionType
import unittest

ROOT = Path(__file__).resolve().parent
WORKER = ROOT.parents[3] / 'workers/aequilibrae_worker'
sys.path.insert(0, str(WORKER))
import test_count_input_custody as tests


def main():
    worker = tests.main
    original = worker._run_count_validation
    source = inspect.getsource(original)
    summary = worker.count_validation.unavailable_validation_summary
    summary_source = inspect.getsource(summary)
    missing = source.index('    if not counts_path or not os.path.isfile(counts_path):')
    resolved = source.index('    resolved_counts = counts_path', missing)
    broken = source[:missing] + '    counts_path = counts_path if counts_path and os.path.isfile(counts_path) else VALIDATION_COUNTS_PATH\n' + source[resolved:]
    cases = [('baseline', source, summary_source, None),
             ('harmless', source + '\n# Harmless comment.\n', summary_source, None),
             ('substitute-default', broken, summary_source, 'test_missing_recorded_source_never_uses_available_default'),
             ('missing-means-zero', source, summary_source.replace('"stations_matched": None', '"stations_matched": 0'), 'test_missing_recorded_source_never_uses_available_default'),
             ('restored', source, summary_source, None)]
    records = []
    try:
        for name, body, summary_body, test in cases:
            namespace = dict(worker.__dict__)
            exec(compile(body, '<count-input-control>', 'exec'), namespace)
            worker._run_count_validation = FunctionType(namespace[original.__name__].__code__, worker.__dict__, argdefs=original.__defaults__)
            namespace = dict(worker.count_validation.__dict__)
            exec(compile(summary_body, '<count-summary-control>', 'exec'), namespace)
            worker.count_validation.unavailable_validation_summary = FunctionType(namespace[summary.__name__].__code__, worker.count_validation.__dict__)
            suite = unittest.TestSuite([tests.CountInputTests(test)]) if test else unittest.defaultTestLoader.loadTestsFromTestCase(tests.CountInputTests)
            stream = io.StringIO()
            result = unittest.TextTestRunner(stream=stream).run(suite)
            if test:
                if len(result.failures) != 1 or result.errors:
                    raise AssertionError('Targeted count fault did not fail: ' + name + '\n' + stream.getvalue())
            elif not result.wasSuccessful():
                raise AssertionError('Count baseline failed: ' + name + '\n' + stream.getvalue())
            records.append({'control': name, 'tests': result.testsRun, 'expected_failures': len(result.failures)})
    finally:
        worker._run_count_validation = original
        worker.count_validation.unavailable_validation_summary = summary
    report = {'worker_sha256': hashlib.sha256((WORKER / 'main.py').read_bytes()).hexdigest(),
              'count_validation_sha256': hashlib.sha256((WORKER / 'count_validation.py').read_bytes()).hexdigest(),
              'controls': records, 'limits': 'Real CSV inputs, actual validation entry point and claim summary; coverage is injected. No native network matching, scientific holdout or file-retention proof.'}
    (ROOT / 'count-input-controls.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
