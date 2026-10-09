"""Live peer-gate controls with original source restored after each campaign."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
path = ROOT / 'container_peer_gate.py'
original = path.read_bytes()
source = original.decode()
base = Path(os.environ['OPENPLAN_CONTAINER_PEER_CONTROLS'])
base.mkdir(mode=0o700, parents=True, exist_ok=False)
results = []
try:
    for name in ('harmless', 'unbound-peer', 'restored'):
        text = source
        if name == 'harmless':
            text += '\n# Harmless peer-gate comment.\n'
        elif name == 'unbound-peer':
            text = text.replace("if credentials[0] != pid or credentials[1] != expected_uid or int(info['Pid']) != pid:", 'if False:')
            text = text.replace("if Path(f'/proc/{pid}/cgroup').read_text() != f'0::/system.slice/docker-{expected_id}.scope\\n':", 'if False:')
        path.write_text(text)
        env = dict(os.environ, OPENPLAN_CONTAINER_PIDFD_PROOF=str(base / name))
        result = subprocess.run([sys.executable, '-B', str(ROOT / 'verify_container_pidfd_namespace.py')],
                                env=env, capture_output=True, text=True, timeout=90)
        if name == 'unbound-peer':
            assert result.returncode != 0 and 'AssertionError: Unrelated socket peer accepted' in result.stderr, result.stderr
        else:
            assert result.returncode == 0, result.stderr
        (base / (name + '.log')).write_text(result.stdout + result.stderr)
        results.append({'case': name, 'returncode': result.returncode, 'expected_result_observed': True})
finally:
    path.write_bytes(original)
print(json.dumps({'cases': results, 'source_sha256': hashlib.sha256(original).hexdigest(),
                  'limits': ['Live local systemd Docker only; prototype peer gate, not production admission']}, indent=2))
