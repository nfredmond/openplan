import hashlib
import json
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parent
schema = (root / 'response-write-transaction.sql').read_text()
probe = (root / 'transaction-probe.sql').read_text()
command = ['docker', 'exec', '-i', 'supabase_db_openplan-restore-target-2026091050',
           'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']
cases = [
    ('baseline', None, None, None),
    ('harmless-comment', '-- Only one finalization is possible.', '-- One finalization is allowed.', None),
    ('accept-stale-version', 'IF previous.updated_at IS DISTINCT FROM p_expected_updated_at THEN', 'IF false THEN', 'Stale editor overwrote the first correction'),
    ('accept-changed-retry', 'OR receipt.payload_json <> envelope', 'OR false', 'Changed-payload retry was accepted'),
    ('regressing-clock', "greatest(clock_timestamp(), OLD.updated_at + interval '1 microsecond')", 'now()', 'Response version did not advance'),
    ('mutable-receipt', "IF TG_OP = 'UPDATE' AND OLD.result_json IS NULL", "IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;\n  IF TG_OP = 'UPDATE' AND OLD.result_json IS NULL", 'Completed receipt could be changed'),
]
results = []
for name, before, after, expected in cases:
    changed = schema
    if before:
        assert schema.count(before) == 1, name
        changed = schema.replace(before, after)
    sql = "BEGIN; SET LOCAL statement_timeout='20s';\n" + changed + '\n' + probe + '\nROLLBACK;\n'
    run = subprocess.run(command, input=sql, text=True, capture_output=True, timeout=30)
    matched = run.returncode == 0 if expected is None else run.returncode != 0 and expected in run.stderr
    results.append({'name': name, 'status': run.returncode, 'matched': matched,
                    'outcome': 'survived' if run.returncode == 0 else 'killed',
                    'expected': expected, 'schemaSha256': hashlib.sha256(changed.encode()).hexdigest(),
                    'probeSha256': hashlib.sha256(probe.encode()).hexdigest(),
                    'diagnostic': None if matched else run.stderr[-2000:]})
    (root / 'transaction-mutations.json').write_text(json.dumps(results, indent=2) + '\n')
    print(name, results[-1]['outcome'], matched, flush=True)
    if not matched:
        raise RuntimeError(run.stderr)
# Each connection ends after rollback or an error. Neither commits the prototype.
check = subprocess.run(command + ['-Atc', "SELECT to_regclass('public.engagement_response_write_receipts') IS NULL"],
                       text=True, capture_output=True, timeout=30)
assert check.returncode == 0 and check.stdout.strip() == 't', 'Prototype schema remained installed'
print('Prototype schema absent after rolled-back probes', flush=True)
