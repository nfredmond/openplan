"""Exercise kpi recovery against concurrent requests and the real reaper."""
from pathlib import Path
import json
import os
import re
import subprocess
import time
import uuid

from verify_publication_contention import quoted, ready

ROOT = Path(__file__).resolve().parent


def verify():
    meta = json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
    if not re.fullmatch('openplan_attempt_cli_[0-9a-f]{32}', meta['database']) or meta['container'] != 'supabase_db_openplan-restore-target-2026091050':
        raise ValueError('Select only the named owned proof database')
    fixture = str(uuid.UUID(meta['fixture_run']))
    command = ['docker', 'exec', '-i', meta['container'], 'psql', '-X', '-qAt', '-U', 'postgres', '-d', meta['database'], '-v', 'ON_ERROR_STOP=1']

    def sql(statement):
        result = subprocess.run(command, input=statement, text=True, capture_output=True, timeout=25)
        if result.returncode:
            raise RuntimeError(result.stderr)
        return result.stdout.strip()

    source = (ROOT / 'legacy-kpi-command.sql').read_text()

    def check(candidate, mode):
        if sql("SELECT to_regclass('public.model_legacy_kpi_receipts') IS NULL;") != 't':
            raise RuntimeError('KPI proof objects already exist; do not replace them')
        sql('BEGIN;\n' + candidate + '\nCOMMIT;')
        owner = contender = None
        try:
            run, stage, kpi = [str(uuid.uuid4()) for _ in range(3)]
            label = 'kpi_' + uuid.uuid4().hex
            ws = str(uuid.UUID(sql(f"INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by) SELECT '{run}',workspace_id,model_id,'aequilibrae','queued','Synthetic kpi contention',created_by FROM public.model_runs WHERE id='{fixture}' RETURNING workspace_id;")))
            sql(f"INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES('{stage}','{run}','Synthetic kpi','queued',1);")
            payload = dict(id=kpi, run_id=run, stage_id=stage, kpi_name='daily_vmt', kpi_label='Daily VMT', kpi_category='assignment', value=12.5, unit='vehicle-miles/day', geometry_ref=None, breakdown_json={})

            def call(value):
                return f"public.record_legacy_model_kpi('{ws}',{quoted(json.dumps(value))}::jsonb)"

            reap = f"public.reap_model_run_if_stale('{run}',clock_timestamp()+interval '1 minute','Synthetic kpi race')"
            owner_call = reap if mode == 'reaper-first' else call(payload)
            owner = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
            owner.stdin.write('SET statement_timeout=12000; SET idle_in_transaction_session_timeout=15000; BEGIN; SET LOCAL ROLE service_role; SELECT to_json(' + owner_call + ');\n')
            owner.stdin.flush()
            first = ready(owner)
            changed = dict(payload, value=13.5) if mode == 'changed-request' else payload
            contender_call = reap if mode == 'kpi-first' else call(changed)
            contender = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            contender.stdin.write(f"SET application_name='{label}'; SET statement_timeout=12000; SET ROLE service_role; SELECT to_json(" + contender_call + ');\n')
            contender.stdin.close()
            contender.stdin = None
            blocked = False
            for _ in range(40):
                if sql(f"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='{label}' AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0);") == 't':
                    blocked = True
                    break
                if contender.poll() is not None:
                    break
                time.sleep(.05)
            if not blocked:
                raise AssertionError('Competing kpi did not wait on a lock')
            owner.stdin.write('COMMIT;\n\\q\n')
            owner.stdin.flush()
            owner.stdin.close()
            owner.stdin = None
            _, error = owner.communicate(timeout=15)
            if owner.returncode:
                raise RuntimeError(error)
            output, error = contender.communicate(timeout=15)
            if mode in ('changed-request', 'reaper-first'):
                if contender.returncode == 0:
                    raise AssertionError('Changed request accepted' if mode == 'changed-request' else 'KPI committed after reaper')
                expected_error = 'Legacy KPI request changed' if mode == 'changed-request' else 'Stopped run cannot register new KPI'
                if expected_error not in error:
                    raise RuntimeError(error)
            elif mode == 'retry':
                if contender.returncode or json.loads(output) != first:
                    raise AssertionError('Concurrent retry changed kpi receipt')
            elif contender.returncode or json.loads(output) is not True:
                raise AssertionError('Reaper did not finish after kpi')
            wanted = 0 if mode == 'reaper-first' else 1
            counts = json.loads(sql(f"SELECT json_build_array((SELECT count(*) FROM public.model_legacy_kpi_receipts WHERE run_id='{run}'),(SELECT count(*) FROM public.model_run_kpis WHERE run_id='{run}'));"))
            if counts != [wanted, wanted]:
                raise AssertionError('Concurrent kpi left wrong record counts')
            if mode in ('reaper-first', 'kpi-first'):
                if sql(f"SELECT status FROM public.model_runs WHERE id='{run}';") != 'failed':
                    raise AssertionError('Reaper did not retain failed run')
                if mode == 'reaper-first' and first is not True:
                    raise AssertionError('Reaper did not stop fixture')
            if wanted and json.loads(sql('SELECT ' + call(payload) + ';')) != first:
                raise AssertionError('Historical kpi receipt changed')
            return dict(mode=mode, run_id=run, lock_wait_observed=True, counts=counts)
        finally:
            for process in (owner, contender):
                if process is not None and process.poll() is None:
                    if process.stdin is not None:
                        process.stdin.close()
                        process.stdin = None
                    try:
                        process.communicate(timeout=16)
                    except subprocess.TimeoutExpired:
                        raise RuntimeError('Owned proof session still live; leave objects for diagnosis')
            sql('BEGIN; DROP FUNCTION public.record_legacy_model_kpi(uuid,jsonb); DROP TABLE public.model_legacy_kpi_receipts; COMMIT;')

    modes = ('retry', 'changed-request', 'reaper-first', 'kpi-first')
    results = []
    for name, candidate in [('baseline', source), ('harmless', source + '\n-- Harmless kpi contention comment.\n')]:
        for mode in modes:
            results.append(dict(case=name, **check(candidate, mode)))
    mutants = [
        ('changed-request-bypass', 'IF saved.request_payload IS DISTINCT FROM request THEN', 'IF false THEN', 'changed-request', 'Changed request accepted'),
        ('wrong-retry-receipt', 'RETURN saved.response_payload;', "RETURN '{}'::jsonb;", 'retry', 'Concurrent retry changed kpi receipt'),
        ('stopped-run-bypass', "IF parent.status IN('failed','cancelled') THEN", 'IF false THEN', 'reaper-first', 'KPI committed after reaper'),
    ]
    for name, before, after, mode, expected in mutants:
        if source.count(before) != 1:
            raise AssertionError('Mutation target changed: ' + name)
        try:
            check(source.replace(before, after, 1), mode)
        except AssertionError as failure:
            if str(failure) != expected:
                raise
            results.append(dict(case=name, mode=mode, caught=expected))
        else:
            raise AssertionError('KPI contention mutation survived: ' + name)
    for mode in modes:
        results.append(dict(case='restored', **check(source, mode)))
    if sql("SELECT to_regclass('public.model_legacy_kpi_receipts') IS NULL AND to_regprocedure('public.record_legacy_model_kpi(uuid,jsonb)') IS NULL;") != 't':
        raise AssertionError('KPI proof cleanup failed')
    output = Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT']).resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    evidence = dict(cases=results, cleanup_confirmed=True, scope='Independent PostgreSQL service-role transactions in the named owned proof database. Actual lock waits and stale-run reaper. Candidate objects removed; synthetic fixture records retained. No HTTP recovery, worker adoption, Storage byte verification, managed ingestion or scientific acceptance.')
    (output / 'legacy-kpi-contention.json').write_text(json.dumps(evidence, indent=2) + '\n')
    return evidence


if __name__ == '__main__':
    print(json.dumps(verify(), indent=2))
