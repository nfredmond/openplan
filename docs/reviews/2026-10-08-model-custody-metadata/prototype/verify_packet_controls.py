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
    ('omit-receipt-owner', original.replace("_require(receipt.get('run_id') == model_run_id and receipt.get('stage_id') == stage_id and receipt.get('attempt_id') == attempt_id, 'artifact receipt ownership mismatch')", "_require(True, 'artifact receipt ownership mismatch')"), False),
    ('omit-receipt-byte-identity', original.replace("_require(receipt.get('content_hash') == identities[role]['sha256'] and type(receipt.get('file_size_bytes')) is int and receipt['file_size_bytes'] == identities[role]['bytes'], 'artifact receipt byte identity mismatch')", "_require(True, 'artifact receipt byte identity mismatch')"), False),
    ('omit-receipt-storage', original.replace("_require(isinstance(storage_refs[role], str) and storage_refs[role].startswith('storage://run-artifacts/') and receipt.get('file_url') == storage_refs[role], 'artifact receipt storage reference mismatch')", "_require(True, 'artifact receipt storage reference mismatch')"), False),
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
