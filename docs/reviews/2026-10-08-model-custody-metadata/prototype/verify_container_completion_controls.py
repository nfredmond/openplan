"""Live controls for complete namespace waiting and descriptor refusal."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
path = ROOT / 'container_pidfd_bootstrap.py'
original = path.read_bytes()
source = original.decode()
base = Path(os.environ['OPENPLAN_COMPLETION_CONTROLS'])
base.mkdir(mode=0o700, parents=True, exist_ok=False)
cases = [
    ('harmless', None, None, None),
    ('early-completion', 'detached-completion',
     ('            child.returncode = command_code', '            child.returncode = command_code\n            return command_code'),
     ('Detached child killed before release', 'Workload did not reach child readiness')),
    ('ignore-dead-owner', 'owner-before-start', ('    if poller.poll(0):', '    if False:'),
     ('Startup rejection did not exit with refusal',)),
    ('ignore-descriptor-kind', 'invalid-descriptor',
     ("if os.readlink(f'/proc/self/fd/{descriptor}') != 'anon_inode:[pidfd]':", 'if False:'),
     ('Wrong startup refusal reason',)),
    ('ignore-descriptor-count', 'missing-descriptor', ('len(descriptors) != 2', 'False'),
     ('Startup rejection did not exit with refusal',)),
    ('restored', None, None, None),
]
results = []
try:
    for name, selected, mutation, expected in cases:
        text = source
        if mutation:
            assert mutation[0] in text
            text = text.replace(*mutation)
        if name == 'harmless':
            text += '\n# Harmless completion control.\n'
        path.write_text(text)
        env = dict(os.environ, OPENPLAN_CONTAINER_PIDFD_PROOF=str(base / name))
        if selected:
            env['OPENPLAN_PROOF_CASE'] = selected
        result = subprocess.run([sys.executable, '-B', str(ROOT / 'verify_container_pidfd_namespace.py')],
                                env=env, capture_output=True, text=True, timeout=90)
        if expected:
            assert result.returncode != 0 and any('AssertionError: ' + message in result.stderr for message in expected), result.stderr
        else:
            assert result.returncode == 0, result.stderr
        (base / (name + '.log')).write_text(result.stdout + result.stderr)
        results.append({'case': name, 'returncode': result.returncode, 'expected_result_observed': True})
finally:
    path.write_bytes(original)
print(json.dumps({'cases': results, 'source_sha256': hashlib.sha256(original).hexdigest(),
                  'limits': ['Synthetic work in local Docker; no native model or production admission']}, indent=2))
