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
ownership = (root / 'ownership-prototype.sql').read_text()
batch = (root / 'batch-prototype.sql').read_text()
batch = batch.replace(" IF p_kind='route' THEN", " INSERT INTO ownership_probe.write_context(transaction_id,version_id,token,kind) VALUES(txid_current(),p_version,p_token,p_kind);\n IF p_kind='route' THEN")
batch = batch.replace(' GET DIAGNOSTICS written=ROW_COUNT;', ' GET DIAGNOSTICS written=ROW_COUNT;\n DELETE FROM ownership_probe.write_context WHERE transaction_id=txid_current() AND version_id=p_version AND kind=p_kind;')
source = (root / 'write-fence-prototype.sql').read_text()
checks = (root / 'verify-batch.sql').read_text() + (root / 'verify-write-fence.sql').read_text()
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
    ('missing-derived-fence', mutate('IF managed THEN', 'IF false THEN'),
     'Direct managed insert accepted'),
    ('missing-version-fence', mutate('WHERE version_id=OLD.id)', 'WHERE false)'),
     'Direct managed stage accepted'),
    ('forge-context', source + '\nGRANT INSERT ON ownership_probe.write_context TO service_role;\n',
     'Service role forged command context'),
    ('restored', source, None),
]
results = []
for name, sql, reason in cases:
    schema = 'ownership_probe_' + uuid.uuid4().hex
    script = ("BEGIN;\nSET LOCAL statement_timeout='15s';\n" + ownership + sql + batch + '\n'
              + ("GRANT INSERT ON ownership_probe.write_context TO service_role;\n" if name == 'forge-context' else '') + checks + '\nROLLBACK;').replace('ownership_probe', schema)
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
                  'batchWithContextSha256': hashlib.sha256(batch.encode()).hexdigest(),
                  'ownershipSha256': hashlib.sha256(ownership.encode()).hexdigest(),
                  'checksSha256': hashlib.sha256(checks.encode()).hexdigest(),
                  'cases': results}, indent=2))
