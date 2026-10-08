"""Exercise assessment recovery against concurrent requests and the real reaper."""
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

    source = (ROOT / 'assessment-command.sql').read_text()

    def check(candidate, mode):
        if sql("SELECT to_regclass('public.model_assessment_command_receipts') IS NULL;") != 't':
            raise RuntimeError('Assessment proof objects already exist; do not replace them')
        sql('BEGIN;\n' + candidate + '\nCOMMIT;')
        owner = contender = None
        try:
            run, stage, artifact, request = [str(uuid.uuid4()) for _ in range(4)]
            label = 'assessment_' + uuid.uuid4().hex
            ws = str(uuid.UUID(sql(f"INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by) SELECT '{run}',workspace_id,model_id,'aequilibrae','queued','Synthetic assessment contention',created_by FROM public.model_runs WHERE id='{fixture}' RETURNING workspace_id;")))
            sql(f"INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES('{stage}','{run}','Synthetic assessment','queued',1); INSERT INTO public.model_run_artifacts(id,run_id,stage_id,artifact_type,file_url,file_size_bytes,content_hash) VALUES('{artifact}','{run}','{stage}','link_volumes','storage://run-artifacts/synthetic/output.csv',2,repeat('a',64));")
            payload = dict(p_workspace_id=ws, p_model_run_id=run, p_stage_id=stage, p_track='assignment', p_model_output_artifact_id=artifact, p_partition={}, p_planning_use='Synthetic only', p_scientific_outcome='inconclusive', p_reasons=[])
            for prefix in ('p_validation_input', 'p_comparison_basis', 'p_assessment'):
                payload.update({prefix + '_file_url': 'storage://run-artifacts/synthetic/' + prefix + '.json', prefix + '_size': 2, prefix + '_sha256': 'a' * 64, prefix + '_metadata': {}})
            payload['p_validation_input_metadata'] = dict(schema='openplan.validation-input-bundle.v1', comparison_basis_sha256='a' * 64)
            payload['p_comparison_basis_metadata'] = dict(schema='openplan.model-comparison-basis.v1')
            payload['p_assessment_metadata'] = dict(schema='openplan.model-validation-assessment.v1', comparison_basis_sha256='a' * 64, rules_version=4, scientific_outcome='inconclusive', planning_use='Synthetic only', partition={}, reasons=[])

            def call(value):
                return f"public.record_legacy_model_assessment('{request}',{quoted(json.dumps(value))}::jsonb)"

            reap = f"public.reap_model_run_if_stale('{run}',clock_timestamp()+interval '1 minute','Synthetic assessment race')"
            owner_call = reap if mode == 'reaper-first' else call(payload)
            owner = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
            owner.stdin.write('SET statement_timeout=12000; SET idle_in_transaction_session_timeout=15000; BEGIN; SET LOCAL ROLE service_role; SELECT to_json(' + owner_call + ');\n')
            owner.stdin.flush()
            first = ready(owner)
            changed = dict(payload, p_validation_input_file_url='storage://run-artifacts/synthetic/changed.json') if mode == 'changed-request' else payload
            contender_call = reap if mode == 'assessment-first' else call(changed)
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
                raise AssertionError('Competing assessment did not wait on a lock')
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
                    raise AssertionError('Changed request accepted' if mode == 'changed-request' else 'Assessment committed after reaper')
                expected_error = 'Assessment request payload changed' if mode == 'changed-request' else 'Stopped run cannot record new assessment'
                if expected_error not in error:
                    raise RuntimeError(error)
            elif mode == 'retry':
                if contender.returncode or json.loads(output) != first:
                    raise AssertionError('Concurrent retry changed assessment receipt')
            elif contender.returncode or json.loads(output) is not True:
                raise AssertionError('Reaper did not finish after assessment')
            wanted = 0 if mode == 'reaper-first' else 1
            counts = json.loads(sql(f"SELECT json_build_array((SELECT count(*) FROM public.model_assessment_command_receipts WHERE run_id='{run}'),(SELECT count(*) FROM public.modeling_validation_assessments WHERE model_run_id='{run}'),(SELECT count(*) FROM public.model_run_artifacts WHERE run_id='{run}'));"))
            if counts != [wanted, wanted, 1 + 3 * wanted]:
                raise AssertionError('Concurrent assessment left wrong record counts')
            if mode in ('reaper-first', 'assessment-first'):
                if sql(f"SELECT status FROM public.model_runs WHERE id='{run}';") != 'failed':
                    raise AssertionError('Reaper did not retain failed run')
                if mode == 'reaper-first' and first is not True:
                    raise AssertionError('Reaper did not stop fixture')
            if wanted and json.loads(sql('SELECT ' + call(payload) + ';')) != first:
                raise AssertionError('Historical assessment receipt changed')
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
            sql('BEGIN; DROP FUNCTION public.record_legacy_model_assessment(uuid,jsonb); DROP TABLE public.model_assessment_command_receipts; COMMIT;')

    modes = ('retry', 'changed-request', 'reaper-first', 'assessment-first')
    results = []
    for name, candidate in [('baseline', source), ('harmless', source + '\n-- Harmless assessment contention comment.\n')]:
        for mode in modes:
            results.append(dict(case=name, **check(candidate, mode)))
    mutants = [
        ('changed-request-bypass', 'IF saved.request_payload IS DISTINCT FROM p_payload THEN', 'IF false THEN', 'changed-request', 'Changed request accepted'),
        ('wrong-retry-receipt', 'RETURN saved.response_payload;', "RETURN '{}'::jsonb;", 'retry', 'Concurrent retry changed assessment receipt'),
        ('stopped-run-bypass', "IF parent.status IN('failed','cancelled') THEN", 'IF false THEN', 'reaper-first', 'Assessment committed after reaper'),
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
            raise AssertionError('Assessment contention mutation survived: ' + name)
    for mode in modes:
        results.append(dict(case='restored', **check(source, mode)))
    if sql("SELECT to_regclass('public.model_assessment_command_receipts') IS NULL AND to_regprocedure('public.record_legacy_model_assessment(uuid,jsonb)') IS NULL;") != 't':
        raise AssertionError('Assessment proof cleanup failed')
    output = Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT']).resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    evidence = dict(cases=results, cleanup_confirmed=True, scope='Independent PostgreSQL service-role transactions in the named owned proof database. Actual lock waits and stale-run reaper. Candidate objects removed; synthetic fixture records retained. No HTTP recovery, worker adoption, Storage byte verification, managed ingestion or scientific acceptance.')
    (output / 'assessment-contention.json').write_text(json.dumps(evidence, indent=2) + '\n')
    return evidence


if __name__ == '__main__':
    print(json.dumps(verify(), indent=2))
