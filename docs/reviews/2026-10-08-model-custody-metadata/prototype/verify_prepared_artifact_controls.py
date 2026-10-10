"""Check prepared identity in native rollback transactions and client controls."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import uuid

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]


def main():
    meta = json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
    if meta['container'] != 'supabase_db_openplan-restore-target-2026091050' or not re.fullmatch(r'openplan_retention_upgrade_[0-9a-f]{32}', meta['database']):
        raise ValueError('Select owned proof database')
    command = ['docker', 'exec', '-i', meta['container'], 'psql', '-X', '-qAt', '-U', 'postgres',
               '-d', meta['database'], '-v', 'ON_ERROR_STOP=1']
    fingerprint = "SELECT md5(pg_get_functiondef('public.write_model_attempt_artifact(uuid,uuid,jsonb)'::regprocedure));"
    before = subprocess.check_output(command, input=fingerprint, text=True).strip()
    migration = REPO / 'openplan/supabase/migrations/20261016000021_model_attempt_prepared_artifact_identity.sql'
    source = migration.read_text().split('BEGIN;\n', 1)[1].rsplit('COMMIT;', 1)[0]
    cases = (ROOT / 'prepared-artifact-cases.sql').read_text().replace('__FIXTURE_RUN__', str(uuid.UUID(meta['fixture_run'])))
    anchor = "v_id := (p_payload->>'id')::uuid;"
    if source.count(anchor) != 1:
        raise AssertionError('Prepared identity anchor changed')
    results = []
    for name, body in [('baseline', source), ('harmless', source + '\n-- Harmless comment.\n'),
                       ('discard-prepared-id', source.replace(anchor, 'NULL;')), ('restored', source)]:
        result = subprocess.run(command, input='BEGIN; SET LOCAL statement_timeout=10000;\n' + body + cases + '\nROLLBACK;',
                                text=True, capture_output=True, timeout=30)
        if name == 'discard-prepared-id':
            if result.returncode == 0 or 'Prepared artifact identity was not preserved' not in result.stderr:
                raise AssertionError('Native prepared identity control did not fail as intended')
        elif result.returncode:
            raise AssertionError('Native prepared identity case failed: ' + result.stderr)
        if subprocess.check_output(command, input=fingerprint, text=True).strip() != before:
            raise AssertionError('Native function escaped rollback')
        results.append({'control': name, 'exit_code': result.returncode})
    worker = REPO / 'workers/aequilibrae_worker'
    client = (worker / 'model_command_client.py').read_text()
    anchor = "    if 'id' in payload:\n        _uuid(payload['id'])"
    if client.count(anchor) != 1:
        raise AssertionError('Client identity anchor changed')
    with tempfile.TemporaryDirectory() as temp:
        path = Path(temp) / 'model_command_client.py'
        runner = '''
import importlib.util,sys,unittest
spec=importlib.util.spec_from_file_location('model_command_client',sys.argv[1])
module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
suite=unittest.defaultTestLoader.loadTestsFromName('test_model_attempt_outputs.OutputTests.test_malformed_prepared_identity_refuses_before_transport')
result=unittest.TextTestRunner(verbosity=2).run(suite)
sys.exit(0 if result.wasSuccessful() else 1)
'''
        for name, body in [('client-baseline', client), ('client-harmless', client + '\n# Harmless comment.\n'),
                           ('client-accept-invalid-id', client.replace(anchor, '    pass')), ('client-restored', client)]:
            path.write_text(body)
            result = subprocess.run([sys.executable, '-B', '-c', runner, str(path)], cwd=worker,
                                    text=True, capture_output=True, timeout=30)
            if name == 'client-accept-invalid-id':
                if result.returncode != 1 or 'FAIL: test_malformed_prepared_identity' not in result.stderr:
                    raise AssertionError('Client malformed identity control did not fail')
            elif result.returncode:
                raise AssertionError('Client control failed: ' + result.stderr)
            results.append({'control': name, 'exit_code': result.returncode})
    report = {'migration_sha256': hashlib.sha256(migration.read_bytes()).hexdigest(), 'controls': results,
              'limits': 'Native registration/receipt/role cases with rollback and client identity validation. No normal worker output, filesystem or scientific acceptance.'}
    (ROOT / 'prepared-artifact-controls.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
