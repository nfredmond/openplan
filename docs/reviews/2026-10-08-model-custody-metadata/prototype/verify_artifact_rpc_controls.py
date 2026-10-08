"""Detect accepted bad receipts and unwanted transport in temporary copies."""
from pathlib import Path
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parent
original = (root / 'artifact_rpc.py').read_text()
controls = [
    ('baseline', original, None),
    ('harmless', original + '\n# Harmless RPC control.\n', None),
    ('trust-unchecked-receipt', original.replace("if any(key not in receipt for key in expected) or journal.canonical({key: receipt[key] for key in expected}) != journal.canonical(expected):", 'if False:'), 'DeliveryUnconfirmed not raised'),
    ('ignore-http-status', original.replace('if response.status_code != 200:', 'if False:'), 'DeliveryUnconfirmed not raised'),
    ('ignore-deployment', original.replace("if command['destination'] != destination(base_url, deployment_id):", 'if False:'), 'ValueError not raised'),
    ('repeat-resolved-post', original.replace("if retained['resolved']:", 'if False:'), '2 != 1'),
    ('restored', original, None),
]
for name, candidate, expected in controls:
    if expected and candidate == original:
        raise RuntimeError(name + ': source mutation absent')
    with tempfile.TemporaryDirectory() as directory:
        target = Path(directory)
        (target / 'artifact_rpc.py').write_text(candidate)
        for file in ('request_journal.py', 'test_artifact_rpc.py'):
            (target / file).write_bytes((root / file).read_bytes())
        result = subprocess.run([sys.executable, '-B', '-m', 'unittest', 'test_artifact_rpc'], cwd=target, capture_output=True, text=True, timeout=15)
        if expected is None:
            if result.returncode:
                raise RuntimeError(name + ': ' + result.stderr)
        elif result.returncode == 0 or expected not in result.stderr or 'ERROR:' in result.stderr:
            raise RuntimeError(name + ': wrong failure boundary: ' + result.stderr)
        print(name + ': ' + ('passed' if expected is None else 'broken behavior detected'))
