"""Observe real skip-command lock waits in a separately owned database clone."""
from pathlib import Path
import hashlib
import json
import os
import re
import subprocess
import time
import uuid
from verify_publication_contention import ready

ROOT = Path(__file__).resolve().parent


def main():
    source = json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
    if source['container'] != 'supabase_db_openplan-restore-target-2026091050' or not re.fullmatch(r'openplan_retention_upgrade_[0-9a-f]{32}', source['database']):
        raise ValueError('Select owned retention fixture source')
    fixture = str(uuid.UUID(source['fixture_run']))
    output = Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT'])
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    base = ['docker', 'exec', '-i', source['container'], 'psql', '-X', '-qAt', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1']

    def sql(database, statement):
        result = subprocess.run([*base, '-d', database], input=statement, capture_output=True, text=True, timeout=25)
        if result.returncode:
            raise RuntimeError(result.stderr)
        return result.stdout.strip()

    if sql('postgres', f"SELECT count(*) FROM pg_stat_activity WHERE datname='{source['database']}';") != '0':
        raise RuntimeError('Source has active sessions; do not terminate them')
    database = 'openplan_skip_race_' + uuid.uuid4().hex
    sql('postgres', f'CREATE DATABASE {database} TEMPLATE {source["database"]};')
    metadata = {**source, 'database': database, 'source_database': source['database'], 'status': 'contention proof pending'}
    (output / 'candidate.json').write_text(json.dumps(metadata, indent=2) + '\n')
    prototype = (ROOT / 'skip-blocked-stage.sql').read_text()
    sql(database, 'BEGIN;\n' + prototype + '\nCOMMIT;')
    function = prototype[prototype.index('CREATE FUNCTION'):].replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION', 1)
    command = [*base, '-d', database]

    def check(mode):
        run, prior, stage, request = [str(uuid.uuid4()) for _ in range(4)]
        label = 'skip_race_' + uuid.uuid4().hex
        ws = sql(database, f"""
INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
 SELECT '{run}',workspace_id,model_id,engine_key,'queued','Synthetic skip contention',created_by
 FROM public.model_runs WHERE id='{fixture}';
INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES
 ('{prior}','{run}','Synthetic prerequisite','failed',1),('{stage}','{run}','Synthetic dependent','queued',2);
SELECT workspace_id FROM public.model_runs WHERE id='{run}';
""")
        ws = str(uuid.UUID(ws))
        operation = f"public.skip_blocked_model_stage('{request}','{ws}','{run}','{stage}','{prior}','failed')"
        if mode.startswith('predecessor'):
            first = f"UPDATE public.model_run_stages SET status='succeeded' WHERE id='{prior}'; SELECT jsonb_build_object('pid',pg_backend_pid());"
        else:
            first = f"SELECT jsonb_build_object('pid',pg_backend_pid(),'receipt',{operation});"
        owner = contender = None
        try:
            owner = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
            owner.stdin.write('SET statement_timeout=12000; SET idle_in_transaction_session_timeout=15000; BEGIN; SET LOCAL ROLE service_role; ' + first + '\n')
            owner.stdin.flush()
            initial = ready(owner)
            pid = int(initial['pid'])
            contender = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            contender.stdin.write(f"SET application_name='{label}'; SET statement_timeout=12000; SET ROLE service_role; SELECT {operation};\n")
            contender.stdin.close()
            contender.stdin = None
            blocked = False
            for _ in range(50):
                if sql(database, f"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='{label}' AND wait_event_type='Lock' AND {pid}=ANY(pg_blocking_pids(pid)));") == 't':
                    blocked = True
                    break
                if contender.poll() is not None:
                    break
                time.sleep(.04)
            if not blocked:
                raise AssertionError('Skip contender did not wait on owner lock')
            finish = 'ROLLBACK' if mode.endswith('rollback') else 'COMMIT'
            owner.stdin.write(f'{finish};\n\\q\n')
            owner.stdin.flush()
            owner.stdin.close()
            owner.stdin = None
            _, error = owner.communicate(timeout=18)
            if owner.returncode:
                raise RuntimeError(error)
            response, error = contender.communicate(timeout=18)
            if contender.returncode:
                raise RuntimeError(error)
            receipt = json.loads(response)
            expected = 'not_skipped' if mode == 'predecessor-commit' else 'skipped'
            if receipt['outcome'] != expected:
                raise AssertionError('Contender used stale predecessor state')
            if mode == 'receipt-commit' and receipt != initial['receipt']:
                raise AssertionError('Concurrent exact retry changed receipt')
            facts = json.loads(sql(database, f"""SELECT jsonb_build_object(
 'status',(SELECT status FROM public.model_run_stages WHERE id='{stage}'),
 'receipts',(SELECT count(*) FROM public.model_stage_skip_receipts WHERE request_id='{request}'),
 'starts',(SELECT count(*) FROM public.model_stage_execution_starts WHERE run_id='{run}'),
 'attempts',(SELECT count(*) FROM public.model_stage_attempts WHERE run_id='{run}'));
"""))
            if facts != {'status': 'queued' if expected == 'not_skipped' else 'skipped', 'receipts': 1, 'starts': 0, 'attempts': 0}:
                raise AssertionError('Concurrent skip persisted unexpected records')
            return {'mode': mode, 'owner_lock_observed': True, 'outcome': expected, 'facts': facts}
        finally:
            for process in (owner, contender):
                if process is not None and process.poll() is None:
                    if process.stdin is not None:
                        process.stdin.close()
                        process.stdin = None
                    process.communicate(timeout=18)

    records = []
    try:
        for name, body in [('baseline', function), ('harmless', function + '\n-- Harmless comment.\n'), ('restored', function)]:
            sql(database, body)
            for mode in ('receipt-commit', 'receipt-rollback', 'predecessor-commit', 'predecessor-rollback'):
                records.append({'control': name, **check(mode)})
        broken = function.replace('workspace_id=p_workspace_id FOR UPDATE;', 'workspace_id=p_workspace_id;').replace('PERFORM id FROM public.model_run_stages WHERE run_id=p_run_id ORDER BY id FOR UPDATE;', 'PERFORM id FROM public.model_run_stages WHERE run_id=p_run_id ORDER BY id;')
        if broken == function:
            raise AssertionError('Lock mutation anchor missing')
        sql(database, broken)
        try:
            check('predecessor-commit')
        except AssertionError as error:
            if str(error) != 'Contender used stale predecessor state':
                raise
            records.append({'control': 'remove-prerequisite-locks', 'expected_failure': str(error)})
        else:
            raise AssertionError('Unprotected prerequisite decision passed')
    finally:
        sql(database, function)
    records.append({'control': 'final-restored', **check('predecessor-commit')})
    report = {'source_sha256': hashlib.sha256(prototype.encode()).hexdigest(), 'cases': records,
              'limits': 'Native service-role sessions in an owned retained clone. No HTTP delivery, normal dispatcher, scientific model, browser or installation migration.'}
    metadata['status'] = 'contention proof passed; original prototype function restored'
    (output / 'candidate.json').write_text(json.dumps(metadata, indent=2) + '\n')
    (output / 'skip-contention.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
