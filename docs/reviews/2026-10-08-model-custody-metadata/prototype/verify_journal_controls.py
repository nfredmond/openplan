"""Run journal controls in temporary source copies, leaving the checkout intact."""
from pathlib import Path
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parent
original = (root / 'request_journal.py').read_text()
controls = [
    ('baseline', original, None),
    ('harmless', original + '\n# Harmless journal control.\n', None),
    ('changed-request', original.replace('if row[0] != request:', 'if False:'), 'ValueError not raised'),
    ('changed-receipt', original.replace('if row[1] is not None and row[1] != receipt:', 'if False:'), 'ValueError not raised'),
    ('unbound-resolution', original.replace('if row is None or row[0] != request:', 'if row is None:'), 'ValueError not raised'),
    ('wrong-deployment', original.replace('WHERE destination=? AND response_json IS NULL', 'WHERE ? IS NOT NULL AND response_json IS NULL'), 'test_exact_prepare_and_destination_filter'),
    ('resolved-replayed', original.replace('WHERE destination=? AND response_json IS NULL', 'WHERE destination=?'), 'test_receipt_is_immutable_and_requires_preparation'),
    ('swallow-busy', original.replace('time.sleep(0.05)', 'return'), '1 != 2'),
    ('retry-other-errors', original.replace("getattr(error, 'sqlite_errorcode', None) != sqlite3.SQLITE_BUSY or ", ''), 'OperationalError not raised'),
    ('ignore-deadline', original.replace(' or time.monotonic() >= deadline', ''), 'OperationalError not raised'),
    ('restored', original, None),
]
for name, candidate, expected_failure in controls:
    if expected_failure and candidate == original:
        raise RuntimeError(name + ': mutation did not change source')
    with tempfile.TemporaryDirectory() as directory:
        target = Path(directory)
        (target / 'request_journal.py').write_text(candidate)
        (target / 'test_request_journal.py').write_bytes((root / 'test_request_journal.py').read_bytes())
        result = subprocess.run([sys.executable, '-B', '-m', 'unittest', 'test_request_journal'], cwd=target, capture_output=True, text=True, timeout=30)
        if expected_failure is None:
            if result.returncode:
                raise RuntimeError(name + ': ' + result.stderr)
        elif result.returncode == 0 or expected_failure not in result.stderr or 'ERROR:' in result.stderr:
            raise RuntimeError(name + ': wrong failure boundary: ' + result.stderr)
        print(name + ': ' + ('passed' if expected_failure is None else 'broken behavior detected'))
if (root / 'request_journal.py').read_text() != original:
    raise RuntimeError('Journal source changed during verification')
