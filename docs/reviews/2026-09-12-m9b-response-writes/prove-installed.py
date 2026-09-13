"""Exercise the installed recovery migration without reinstalling prototype tables.

Every case ends in rollback, including the temporary function mutations. This
uses only the named disposable source database and its synthetic probe campaign.
It does not exercise PostgREST, transport, browser layout or separate connections.
"""
import hashlib
import json
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parent
private = Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/migration-20261014000003')
command = ['docker', 'exec', '-i', 'supabase_db_openplan-restore-target-2026091050',
           'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1']


def read(sql):
    return subprocess.run(command + ['-c', sql], capture_output=True, check=True).stdout


original = read("SELECT pg_get_functiondef(oid) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='write_engagement_response'")
assert original and original.count(b'CREATE OR REPLACE FUNCTION') == 1
definition = original.decode().rstrip() + ';\n'
target = 'IF previous.updated_at IS DISTINCT FROM p_expected_updated_at THEN'
assert definition.count(target) == 1
cases = [
    ('installed-transaction-and-guards', '', ['transaction-probe.sql', 'guards-probe.sql'], None),
    ('installed-broadcast', '', ['broadcast-probe.sql'], None),
    ('installed-authority', '', ['authority-probe.sql'], None),
    ('harmless-comment', '-- No behavior change.\n' + definition, ['transaction-probe.sql'], None),
    ('accept-stale-version', definition.replace(target, 'IF false THEN'), ['transaction-probe.sql'],
     'Stale editor overwrote the first correction'),
]
results = []
for name, override, files, expected in cases:
    probe = '\n'.join((root / filename).read_text() for filename in files)
    sql = "BEGIN; SET LOCAL statement_timeout='30s';\n" + override + '\n' + probe + '\nROLLBACK;\n'
    run = subprocess.run(command, input=sql, text=True, capture_output=True, timeout=45)
    (private / (name + '.log')).write_text(run.stdout + '\n' + run.stderr)
    matched = run.returncode == 0 if expected is None else run.returncode != 0 and expected in run.stderr
    results.append({'name': name, 'exit': run.returncode, 'matched': matched,
                    'outcome': 'survived' if run.returncode == 0 else 'killed',
                    'expected': expected, 'probeSha256': hashlib.sha256(probe.encode()).hexdigest()})
    (root / 'installed-probes.json').write_text(json.dumps(results, indent=2) + '\n')
    print(name, results[-1]['outcome'], matched, flush=True)
    assert matched, f'{name}: inspect the private probe log'
    assert read("SELECT pg_get_functiondef(oid) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='write_engagement_response'") == original

for name, query in json.loads((private / 'queries.json').read_text()).items():
    assert read(query) == (private / (name + '-before.txt')).read_bytes(), name
print('Installed definition and original response/history rows unchanged after all rolled-back cases', flush=True)
