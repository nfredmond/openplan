"""Detect dropped operator settings at each pipeline configuration boundary."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[4]
pipeline = root / 'scripts/modeling/run_behavioral_demand_prototype.py'
poller = root / 'workers/activitysim_worker/supabase_poll.py'
original = {p: p.read_bytes() for p in (pipeline, poller)}
fields = ('host_memory_bytes', 'host_tasks', 'container_memory_bytes', 'container_tasks', 'container_supervision_socket')
mutations = [('harmless', pipeline, original[pipeline] + b'\n# Harmless policy control.\n', None)]
for key in fields:
    for layer, path, before, after, test in (
        ('runtime', pipeline, f'            {key}={key},', f'            {key}=None,', 'test_operator_policy_reaches_runtime_without_substitution'),
        ('cli', pipeline, f'        {key}=args.{key},', f'        {key}=None,', 'test_cli_policy_reaches_pipeline'),
    ):
        assert original[path].count(before.encode()) == 1
        mutations.append((layer + '-' + key, path, original[path].replace(before.encode(), after.encode()), test))
    lines = original[poller].decode().splitlines(keepends=True)
    found = [line for line in lines if line.startswith(f'        "{key}":')]
    assert len(found) == 1
    mutations.append(('operator-' + key, poller, original[poller].replace(found[0].encode(), f'        "{key}": None,\n'.encode()), 'test_operator_policy_reaches_runtime_without_substitution'))
mutations.append(('restored', pipeline, original[pipeline], None))
cases = []
try:
    for name, path, content, test in mutations:
        for source, data in original.items(): source.write_bytes(data)
        path.write_bytes(content)
        result = subprocess.run([sys.executable, '-B', '-m', 'unittest', 'discover', '-s', 'workers/activitysim_worker/tests', '-p', 'test_pipeline_supervision.py', '-v'], cwd=root, text=True, capture_output=True)
        output = result.stdout + result.stderr
        observed = result.returncode == (1 if test else 0)
        if test: observed = observed and f'FAIL: {test}' in output
        cases.append({'case': name, 'returncode': result.returncode, 'expected_behavior_observed': observed})
        if not observed: raise RuntimeError(output)
finally:
    for path, content in original.items(): path.write_bytes(content)
print(json.dumps({'cases': cases, 'sources': {str(path.relative_to(root)): hashlib.sha256(content).hexdigest() for path, content in original.items()}, 'limits': ['Configuration forwarding with a mocked runtime boundary; no live database or model execution']}, indent=2))
