"""Test prototype claim contention in private table copies, not application tables.

Copies retain columns/checks/indexes, but not original foreign keys, triggers or
RLS. The native rollback suite covers those separate sequential boundaries.
"""
from pathlib import Path
import json
import os
import re
import selectors
import subprocess
import time
import uuid

container = os.environ.get('OPENPLAN_MODEL_ATTEMPT_TEST_CONTAINER', '')
if not re.fullmatch(r'supabase_db_openplan-restore-target-[1-9][0-9]*', container):
    raise SystemExit('Select a named disposable restore-target container explicitly')
root = Path(__file__).resolve().parent
source = '\n'.join((root / name).read_text() for name in ('claim.sql', 'write.sql', 'reap.sql'))
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']


def sql(statement):
    return subprocess.run(command, input=statement, text=True, capture_output=True, timeout=20, check=True).stdout.strip()


def line(process):
    with selectors.DefaultSelector() as selector:
        selector.register(process.stdout, selectors.EVENT_READ)
        if not selector.select(12):
            raise RuntimeError('Timed out waiting for owned database session')
    result = process.stdout.readline().strip()
    if not result:
        raise RuntimeError('Owned session closed before ready')
    return result


def check(candidate):
    schema = 'attempt_contention_' + uuid.uuid4().hex
    run, stage, request_a, request_b = [str(uuid.uuid4()) for _ in range(4)]
    owner = contender = None
    try:
        sql(f'''CREATE SCHEMA {schema};
CREATE TABLE {schema}.model_runs (LIKE public.model_runs INCLUDING ALL);
CREATE TABLE {schema}.model_run_stages (LIKE public.model_run_stages INCLUDING ALL);
GRANT USAGE ON SCHEMA {schema} TO service_role;
GRANT ALL ON {schema}.model_runs,{schema}.model_run_stages TO service_role;
''' + candidate.replace('public.', schema + '.') + f'''
INSERT INTO {schema}.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
VALUES('{run}',gen_random_uuid(),gen_random_uuid(),'aequilibrae','queued','Synthetic contention',gen_random_uuid());
INSERT INTO {schema}.model_run_stages(id,run_id,stage_name,status,sort_order)
VALUES('{stage}','{run}','Synthetic claim','queued',1);
''')
        owner = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
        owner.stdin.write(f"SET statement_timeout=10000; SET idle_in_transaction_session_timeout=15000; BEGIN; SET LOCAL ROLE service_role; SELECT {schema}.claim_model_stage_attempt('{request_a}','{stage}','worker-a');\n")
        owner.stdin.flush()
        first = json.loads(line(owner))
        if first['outcome'] != 'claimed':
            raise AssertionError('first claimant did not win')
        # The first response is observed before commit. The second session must
        # actually block on its owner, not merely happen to run afterward.
        contender = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        contender.stdin.write(f"SET application_name='{schema}'; SET statement_timeout=10000; SET ROLE service_role; SELECT {schema}.claim_model_stage_attempt('{request_b}','{stage}','worker-b');")
        contender.stdin.close()
        contender.stdin = None
        blocked = False
        for _ in range(40):
            if sql(f"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='{schema}' AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0);") == 't':
                blocked = True
                break
            if contender.poll() is not None:
                break
            time.sleep(0.05)
        if not blocked:
            raise AssertionError('competing claim never observed waiting on a lock')
        owner.stdin.write('COMMIT;\n\\q\n')
        owner.stdin.flush()
        owner.stdin.close()
        owner.stdin = None
        _, owner_error = owner.communicate(timeout=15)
        if owner.returncode:
            raise RuntimeError(owner_error)
        output, error = contender.communicate(timeout=15)
        if contender.returncode:
            raise RuntimeError(error)
        second = json.loads(output.strip())
        if second['outcome'] != 'not_claimed':
            raise AssertionError('second claimant won')
        retained = json.loads(sql(f"SELECT json_build_object('attempts',(SELECT count(*) FROM {schema}.model_stage_attempts),'receipts',(SELECT count(*) FROM {schema}.model_stage_claim_receipts),'active',(SELECT active_attempt_id FROM {schema}.model_run_stages WHERE id='{stage}'));"))
        if retained != {'attempts': 1, 'receipts': 2, 'active': first['attempt_id']}:
            raise AssertionError('retained ownership does not match winning claim')
        retry = json.loads(sql(f"SET ROLE service_role; SELECT {schema}.claim_model_stage_attempt('{request_b}','{stage}','worker-b');"))
        if retry != second:
            raise AssertionError('losing request retry changed')
        return {'blocked_observed': True, 'attempts': 1, 'receipts': 2}
    finally:
        for process in (owner, contender):
            if process is not None and process.poll() is None:
                if process.stdin is not None:
                    process.stdin.close()
                    process.stdin = None
                process.communicate(timeout=20)
        sql(f'DROP SCHEMA IF EXISTS {schema} CASCADE;')
        if sql(f"SELECT to_regnamespace('{schema}') IS NULL;") != 't':
            raise RuntimeError('Private contention schema remains')


results = []
for name, candidate, expected in (
    ('baseline', source, None),
    ('harmless', source + '\n-- Harmless contention control.\n', None),
    ('allow-second-owner', source.replace("OR v_stage.status <> 'queued'", '').replace('OR v_stage.active_attempt_id IS NOT NULL', ''), 'second claimant won'),
    ('restored', source, None),
):
    try:
        evidence = check(candidate)
    except AssertionError as error:
        if str(error) != expected:
            raise
        results.append({'control': name, 'detected': str(error)})
    else:
        if expected:
            raise AssertionError(f'{name}: defect not detected')
        results.append({'control': name, **evidence})
print(json.dumps(results, indent=2))
