"""Run isolated ownership checks and mutation controls, always rolling back."""
import hashlib
import json
import re
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parent
config = json.loads(Path(sys.argv[1]).read_text())
if (config['container'] != 'supabase_db_openplan-restore-target-2026091050'
        or not re.fullmatch(r'openplan_attempt_cli_[0-9a-f]{32}', config['database'])):
    raise SystemExit('Expected owned isolated proof database')
source = (root / 'ownership-prototype.sql').read_text()
checks = (root / 'verify-ownership.sql').read_text()
command = ['docker', 'exec', '-i', config['container'], 'psql', '-U', 'postgres',
           '-d', config['database'], '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']


def run(sql):
    return subprocess.run(command, input=sql, text=True, capture_output=True, timeout=20)


def mutate(old, new):
    if old not in source:
        raise AssertionError('Mutation target missing: ' + old)
    return source.replace(old, new)


cases = [
    ('baseline', source, None),
    ('harmless', source + '\n-- harmless comment\n', None),
    ('null-claim', mutate("RETURN jsonb_build_object('claim',to_jsonb(saved),'active',true);",
                          'RETURN NULL;'), 'first claim incorrect'),
    ('rebind-token', mutate('IF saved.version_id<>p_version THEN', 'IF false THEN'),
     'token rebound to another version'),
    ('revive-expired', mutate('AND j.lease_until>clock_timestamp()', ''),
     'expired claim revived'),
    ('ignore-owner-token', mutate('AND j.token=p_token AND j.lease_until', 'AND j.lease_until'),
     'old token renewed new attempt'),
    ('ignore-terminal-state', mutate("AND v.status IN ('pending','fetching','parsing')", ''),
     'terminal version renewed'),
    ('unguarded-output', mutate('IF ownership_probe.own_gtfs_probe(p_version,p_token) IS NOT TRUE THEN RAISE',
                               'IF false THEN RAISE'), 'expired owner wrote'),
    ('restored', source, None),
]
results = []
for name, sql, reason in cases:
    schema = 'ownership_probe_' + uuid.uuid4().hex
    script = ("BEGIN;\nSET LOCAL statement_timeout='15s';\n" + sql + '\n'
              + checks + '\nROLLBACK;').replace('ownership_probe', schema)
    result = run(script)
    if (result.returncode == 0) != (reason is None) or (reason and reason not in result.stderr):
        raise RuntimeError(name + '\n' + result.stdout + result.stderr)
    # A separate connection confirms neither successful nor failed transactions left a schema.
    cleanup = run("SELECT count(*) FROM pg_namespace WHERE nspname='" + schema + "';")
    if cleanup.returncode or cleanup.stdout.strip() != '0':
        raise RuntimeError('Prototype schema survived rollback: ' + schema)
    results.append({'case': name, 'expectedPass': reason is None,
                    'exitCode': result.returncode, 'failureReason': reason,
                    'schemaAbsentAfterRollback': True})
print(json.dumps({'recordedAt': datetime.now(timezone.utc).isoformat(),
                  'sourceSha256': hashlib.sha256(source.encode()).hexdigest(),
                  'checksSha256': hashlib.sha256(checks.encode()).hexdigest(),
                  'cases': results}, indent=2))
