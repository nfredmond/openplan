"""Prove the overlapping-read check detects a changed snapshot boundary."""
import hashlib
import json
import subprocess
from pathlib import Path

review = Path(__file__).resolve().parent
command = ['docker', 'exec', '-i', 'supabase_db_openplan-restore-target-2026091050',
           'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']


def sql(statement):
    return subprocess.run(command, input=statement, text=True, capture_output=True, check=True, timeout=20).stdout.strip()


read_definition = "SELECT pg_get_functiondef('public.read_engagement_response_snapshot(uuid,boolean)'::regprocedure);"
original = sql(read_definition)
assert ' STABLE ' in original
results = []
try:
    for name, definition, expected in [
        ('harmless-comment', original + '\n-- Harmless concurrent-read control.\n', None),
        ('volatile-read', original.replace(' STABLE ', ' VOLATILE ', 1), 'An overlapping edit changed the in-flight snapshot'),
    ]:
        sql(definition)
        run = subprocess.run(['python3', '-B', str(review / 'concurrent-read-probe.py')], text=True, capture_output=True, timeout=60)
        matched = run.returncode == 0 if expected is None else run.returncode != 0 and expected in run.stderr
        results.append({'name': name, 'outcome': 'survived' if run.returncode == 0 else 'killed', 'matched': matched,
                        'expected': expected, 'stderr': run.stderr[:1500]})
        print(name, results[-1]['outcome'], 'matched=' + str(matched), flush=True)
        assert matched, run.stderr
finally:
    sql(original)
    assert sql(read_definition) == original, 'Function definition restore mismatch'
    (review / 'concurrent-read-mutations.json').write_text(json.dumps({
        'stack': 'openplan-restore-target-2026091050', 'restoredDefinitionSha256': hashlib.sha256(original.encode()).hexdigest(),
        'results': results,
    }, indent=2) + '\n')
    print('Restored the original database function definition.', flush=True)
