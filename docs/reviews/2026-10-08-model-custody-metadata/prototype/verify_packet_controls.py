"""Run packet-integrity mutations serially and restore the exact source."""
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parent
path = root / 'packet_integrity.py'
original = path.read_text()
command = [sys.executable, '-B', '-m', 'unittest', 'discover', '-s', str(root), '-p', 'test_packet_integrity.py']
controls = (
    ('baseline', original, True),
    ('harmless', original + '\n# Harmless packet control.\n', True),
    ('omit-diagnosis-binding', original.replace("_require(all(bindings.get(key) == value for key, value in expected.items()), 'diagnosis file binding mismatch')", "_require(True, 'diagnosis file binding mismatch')"), False),
    ('omit-method-binding', original.replace("_require(all(item.get('method') == demand_method for item in (basis, assessment, diagnosis)), 'packet method mismatch')", "_require(True, 'packet method mismatch')"), False),
    ('omit-assessment-input-binding', original.replace("_require(all(exact.get(key) == value for key, value in expected.items()), 'assessment input binding mismatch')", "_require(True, 'assessment input binding mismatch')"), False),
    ('restored', original, True),
)
try:
    for name, candidate, accepted in controls:
        path.write_text(candidate)
        result = subprocess.run(command, text=True, capture_output=True, timeout=15)
        if accepted and result.returncode:
            raise RuntimeError(name + ': ' + result.stderr)
        if not accepted and (result.returncode == 0 or 'ValueError not raised' not in result.stderr):
            raise RuntimeError(name + ' did not detect accepted invalid packet: ' + result.stderr)
        print(name + ': ' + ('passed' if accepted else 'invalid packet detected'))
finally:
    path.write_text(original)
