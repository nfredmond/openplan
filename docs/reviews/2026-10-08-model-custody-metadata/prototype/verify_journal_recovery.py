"""Exercise committed SQL / unrecorded acknowledgement recovery in private copies.

No PostgREST, network fault injection, real worker entry point or model execution.
Original application foreign keys, triggers and RLS are not copied by LIKE.
"""
from pathlib import Path
import json
import os
import re
import subprocess
import sys
import tempfile
import uuid
import request_journal as journal

ROOT = Path(__file__).resolve().parent
CONTAINER = os.environ.get('OPENPLAN_MODEL_ATTEMPT_TEST_CONTAINER', '')
if not re.fullmatch(r'supabase_db_openplan-restore-target-[1-9][0-9]*', CONTAINER):
    raise SystemExit('Select a named disposable restore-target container explicitly')
PSQL = ['docker', 'exec', '-i', CONTAINER, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']


def sql(statement, discard=False):
    result = subprocess.run(PSQL, input='SET statement_timeout=10000;\n' + statement,
                            text=True, stdout=subprocess.DEVNULL if discard else subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=20)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return None if discard else result.stdout.strip()


def dispatch(command, schema, discard=False):
    if command['destination'] != CONTAINER + '/' + schema or command['operation'] != 'write_model_attempt_artifact':
        raise ValueError('Unexpected synthetic command destination or operation')
    request = str(uuid.UUID(command['request_id']))
    attempt = str(uuid.UUID(command['arguments']['attempt_id']))
    payload = json.dumps(command['arguments']['payload']).replace("'", "''")
    result = sql(f"SET ROLE service_role; SELECT {schema}.write_model_attempt_artifact('{request}','{attempt}','{payload}'::jsonb);", discard)
    return None if discard else json.loads(result)


def child(mode, fixture_path):
    fixture = json.loads(Path(fixture_path).read_text())
    schema = fixture['schema']
    if not re.fullmatch(r'journal_recovery_[0-9a-f]{32}', schema):
        raise ValueError('Invalid owned schema')
    directory = Path(fixture['journal'])
    command = fixture['command']
    fault = fixture['fault']
    if mode == 'lost-ack':
        if fault != 'omit-prepare':
            journal.prepare(directory, command)
        # psql completes the autocommit statement, but no returned bytes reach
        # the journal caller. Exit without resolve or interpreter cleanup.
        dispatch(command, schema, discard=True)
        os._exit(77)
    pending = journal.pending(directory, command['destination'])
    if len(pending) != 1:
        raise AssertionError('Committed command missing from pending journal')
    retained = pending[0]['command']
    replay = json.loads(json.dumps(retained))
    if fault == 'new-request-id':
        replay['request_id'] = str(uuid.uuid4())
    receipt = dispatch(replay, schema)
    if fault != 'omit-resolution':
        journal.resolve(directory, retained, receipt)
    os._exit(78)


def check(fault='none', harmless=False):
    schema = 'journal_recovery_' + uuid.uuid4().hex
    run, stage = [str(uuid.uuid4()) for _ in range(2)]
    source = '\n'.join((ROOT / name).read_text() for name in ('claim.sql', 'artifact.sql'))
    if harmless:
        source += '\n-- Harmless recovery control.\n'
    try:
        sql(f'''CREATE SCHEMA {schema};
CREATE TABLE {schema}.model_runs (LIKE public.model_runs INCLUDING ALL);
CREATE TABLE {schema}.model_run_stages (LIKE public.model_run_stages INCLUDING ALL);
CREATE TABLE {schema}.model_run_artifacts (LIKE public.model_run_artifacts INCLUDING ALL);
GRANT USAGE ON SCHEMA {schema} TO service_role;
GRANT ALL ON {schema}.model_runs,{schema}.model_run_stages TO service_role;
''' + source.replace('public.', schema + '.') + f'''
INSERT INTO {schema}.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
VALUES('{run}',gen_random_uuid(),gen_random_uuid(),'aequilibrae','queued','Synthetic journal recovery',gen_random_uuid());
INSERT INTO {schema}.model_run_stages(id,run_id,stage_name,status,sort_order)
VALUES('{stage}','{run}','Synthetic journal recovery','queued',1);
''')
        attempt = json.loads(sql(f"SET ROLE service_role; SELECT {schema}.claim_model_stage_attempt('{uuid.uuid4()}','{stage}','journal-probe');"))['attempt_id']
        command = {'request_id': str(uuid.uuid4()), 'destination': CONTAINER + '/' + schema,
                   'operation': 'write_model_attempt_artifact', 'arguments': {'attempt_id': attempt,
                   'payload': {'artifact_type': 'synthetic_metadata', 'file_url': 'local://synthetic-recovery.json', 'file_size_bytes': 0, 'content_hash': 'a' * 64}}}
        with tempfile.TemporaryDirectory() as directory:
            fixture_path = Path(directory) / 'fixture.json'
            journal_path = Path(directory) / 'journal'
            fixture_path.write_text(json.dumps({'schema': schema, 'journal': str(journal_path), 'command': command, 'fault': fault}))
            first = subprocess.run([sys.executable, '-B', __file__, 'lost-ack', str(fixture_path)], capture_output=True, text=True, timeout=30)
            if first.returncode != 77:
                raise RuntimeError('First process did not reach owned exit: ' + first.stderr)
            # Separate connection proves server commit before retry, without
            # supplying the receipt to the recovering child.
            original = json.loads(sql(f"SELECT response_payload FROM {schema}.model_artifact_write_receipts WHERE request_id='{command['request_id']}';"))
            if sql(f'SELECT count(*) FROM {schema}.model_run_artifacts;') != '1':
                raise AssertionError('Initial commit did not retain exactly one artifact')
            second = subprocess.run([sys.executable, '-B', __file__, 'recover', str(fixture_path)], capture_output=True, text=True, timeout=30)
            if second.returncode != 78:
                if 'AssertionError: Committed command missing from pending journal' in second.stderr:
                    raise AssertionError('Committed command missing from pending journal')
                raise RuntimeError('Recovery process failed: ' + second.stderr)
            if sql(f'SELECT count(*) FROM {schema}.model_run_artifacts;') != '1' or sql(f'SELECT count(*) FROM {schema}.model_artifact_write_receipts;') != '1':
                raise AssertionError('Recovery duplicated server records')
            if journal.pending(journal_path, command['destination']):
                raise AssertionError('Recovered receipt remained unresolved')
            if journal.prepare(journal_path, command) != {'command': command, 'response': original, 'resolved': True}:
                raise AssertionError('Recovery changed the committed receipt')
        return {'committed_before_restart': True, 'artifact_count': 1, 'receipt_count': 1, 'exact_receipt_retained': True}
    finally:
        sql(f'DROP SCHEMA IF EXISTS {schema} CASCADE;')
        if sql(f"SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='{schema}');") != 'f':
            raise RuntimeError('Owned recovery schema survived cleanup')


if __name__ == '__main__':
    if len(sys.argv) == 3:
        child(sys.argv[1], sys.argv[2])
    else:
        results = {}
        for name, fault, harmless, failure in [
            ('baseline', 'none', False, None),
            ('harmless', 'none', True, None),
            ('missing-preparation', 'omit-prepare', False, 'Committed command missing from pending journal'),
            ('changed-request-identity', 'new-request-id', False, 'Recovery duplicated server records'),
            ('missing-resolution', 'omit-resolution', False, 'Recovered receipt remained unresolved'),
            ('restored', 'none', False, None),
        ]:
            try:
                result = check(fault, harmless)
            except AssertionError as error:
                if failure != str(error):
                    raise
                results[name] = {'detected': str(error)}
            else:
                if failure:
                    raise AssertionError(name + ': adverse control was not detected')
                results[name] = result
        print(json.dumps(results, indent=2))
