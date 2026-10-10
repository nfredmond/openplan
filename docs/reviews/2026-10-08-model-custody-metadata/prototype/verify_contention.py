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
source = '\n'.join((root / name).read_text() for name in ('claim.sql', 'write.sql', 'reap.sql', 'relaunch.sql', 'artifact.sql'))
legacy_instrument = (root.parents[3] / 'openplan/supabase/migrations/20260828000004_comparable_observation_v2_custody.sql').read_text()
for helper in ('refuse_modeling_validation_instrument_v2_mutation', 'validate_modeling_validation_instrument_v2_custody'):
    start = legacy_instrument.index('CREATE OR REPLACE FUNCTION public.' + helper + '(')
    end = legacy_instrument.index('$$;', start) + 3
    source += '\n' + legacy_instrument[start:end]
source += '\n' + (root / 'instrument-custody.sql').read_text()
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']


def sql(statement):
    result = subprocess.run(command, input=statement, text=True, capture_output=True, timeout=20)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def line(process):
    with selectors.DefaultSelector() as selector:
        selector.register(process.stdout, selectors.EVENT_READ)
        if not selector.select(12):
            raise RuntimeError('Timed out waiting for owned database session')
    result = process.stdout.readline().strip()
    if not result:
        raise RuntimeError('Owned session closed before ready')
    return result


def check(candidate, mode="claim"):
    schema = 'attempt_contention_' + uuid.uuid4().hex
    run, stage, request_a, request_b = [str(uuid.uuid4()) for _ in range(4)]
    owner = contender = None
    try:
        sql(f'''CREATE SCHEMA {schema};
CREATE TABLE {schema}.model_runs (LIKE public.model_runs INCLUDING ALL);
CREATE TABLE {schema}.model_run_stages (LIKE public.model_run_stages INCLUDING ALL);
CREATE TABLE {schema}.model_run_artifacts (LIKE public.model_run_artifacts INCLUDING ALL);
CREATE TABLE {schema}.model_run_kpis (LIKE public.model_run_kpis INCLUDING ALL);
CREATE TABLE {schema}.modeling_claim_decisions (LIKE public.modeling_claim_decisions INCLUDING ALL);
CREATE TABLE {schema}.modeling_validation_results (LIKE public.modeling_validation_results INCLUDING ALL);
GRANT USAGE ON SCHEMA {schema} TO service_role;
GRANT ALL ON {schema}.model_runs,{schema}.model_run_stages TO service_role;
''' + candidate.replace('REFERENCES public.workspaces(id) ON DELETE RESTRICT', '').replace('public.', schema + '.') + f'''
INSERT INTO {schema}.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
VALUES('{run}',gen_random_uuid(),gen_random_uuid(),'aequilibrae','queued','Synthetic contention',gen_random_uuid());
INSERT INTO {schema}.model_run_stages(id,run_id,stage_name,status,sort_order)
VALUES('{stage}','{run}','Synthetic claim','queued',1);
''')
        owner_call = f"{schema}.claim_model_stage_attempt('{request_a}','{stage}','worker-a')"
        contender_call = f"{schema}.claim_model_stage_attempt('{request_b}','{stage}','worker-b')"
        if mode != 'claim':
            claimed = json.loads(sql(f"SET ROLE service_role; SELECT {owner_call};"))
            attempt = claimed['attempt_id']
            write_call = f"{schema}.write_model_stage_attempt('{request_b}','{attempt}','succeeded','finished',NULL)"
            reap_call = f"to_json({schema}.reap_model_run_if_stale('{run}',clock_timestamp(),'Synthetic race'))"
            owner_call, contender_call = (reap_call, write_call) if mode == 'reaper-first' else (write_call, reap_call)
            if mode.startswith('artifact-'):
                payload = json.dumps({'artifact_type': 'synthetic_metadata', 'file_url': 'local://synthetic.json', 'file_size_bytes': 0, 'content_hash': 'a' * 64})
                artifact_call = f"{schema}.write_model_attempt_artifact('{request_b}','{attempt}','{payload}'::jsonb)"
                if mode == 'artifact-retry':
                    owner_call = contender_call = artifact_call
                elif mode == 'artifact-reaper-first':
                    owner_call, contender_call = reap_call, artifact_call
                else:
                    owner_call, contender_call = artifact_call, reap_call
            if mode.startswith('instrument-'):
                instrument = {'demand_method': 'aequilibrae', 'scientific_outcome': 'inconclusive'}
                specs = (
                    ('model_output', 'synthetic_output', 'synthetic.output'),
                    ('input_bundle', 'validation_input_bundle_v2', 'openplan.validation-input-bundle.v2'),
                    ('match_audit', 'pre_volume_match_audit_v2', 'openplan.pre-volume-observation-match-audit.v2'),
                    ('comparison_basis', 'model_comparison_basis_v2', 'openplan.model-comparison-basis.v2'),
                    ('assessment', 'model_validation_assessment_v2', 'openplan.model-validation-assessment.v2'),
                    ('diagnosis', 'model_validation_structural_diagnosis_v2', 'openplan.model-validation-structural-diagnosis.v2'),
                )
                for prefix, artifact_type, schema_name in specs:
                    data = json.dumps({'artifact_type': artifact_type, 'file_url': 'local://synthetic-' + prefix, 'file_size_bytes': 0, 'content_hash': 'a' * 64, 'metadata_json': {'schema': schema_name, 'demand_method': 'aequilibrae'}})
                    artifact = json.loads(sql(f"SET ROLE service_role; SELECT {schema}.write_model_attempt_artifact('{uuid.uuid4()}','{attempt}','{data}'::jsonb);"))
                    instrument[prefix + '_artifact_id'] = artifact['id']
                    instrument[prefix + '_sha256'] = 'a' * 64
                instrument_call = f"{schema}.record_model_attempt_instrument('{request_b}','{attempt}','{json.dumps(instrument)}'::jsonb)"
                if mode == 'instrument-retry':
                    owner_call = contender_call = instrument_call
                elif mode == 'instrument-reaper-first':
                    owner_call, contender_call = reap_call, instrument_call
                else:
                    owner_call, contender_call = instrument_call, reap_call
            if mode.startswith('relaunch-'):
                sql(f"SET ROLE service_role; SELECT {schema}.write_model_stage_attempt('{uuid.uuid4()}','{attempt}','failed','initial failure','Synthetic failure');")
                retained_run = json.loads(sql(f"SELECT json_build_object('workspace',workspace_id,'updated',updated_at) FROM {schema}.model_runs WHERE id='{run}';"))
                owner_call = f"{schema}.relaunch_model_run_attempts('{uuid.uuid4()}','{run}','{retained_run['workspace']}','{retained_run['updated']}','{{}}'::jsonb)"
                contender_call = owner_call if mode == 'relaunch-retry' else write_call

        owner = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
        owner.stdin.write(f"SET statement_timeout=10000; SET idle_in_transaction_session_timeout=15000; BEGIN; SET LOCAL ROLE service_role; SELECT {owner_call};\n")
        owner.stdin.flush()
        first = json.loads(line(owner))
        if mode == 'claim' and first['outcome'] != 'claimed':
            raise AssertionError('first claimant did not win')
        if mode == 'reaper-first' and first is not True:
            raise AssertionError('reaper did not revoke owner')
        if mode == 'writer-first' and first['run_status'] != 'succeeded':
            raise AssertionError('writer did not complete run')
        if mode.startswith('relaunch-') and first['status'] != 'queued':
            raise AssertionError('relaunch did not queue run')
        # The first response is observed before commit. The second session must
        # actually block on its owner, not merely happen to run afterward.
        contender = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        contender.stdin.write(f"SET application_name='{schema}'; SET statement_timeout=10000; SET ROLE service_role; SELECT {contender_call};")
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
            raise AssertionError('competing command never observed waiting on a lock')
        owner.stdin.write('COMMIT;\n\\q\n')
        owner.stdin.flush()
        owner.stdin.close()
        owner.stdin = None
        _, owner_error = owner.communicate(timeout=15)
        if owner.returncode:
            raise RuntimeError(owner_error)
        output, error = contender.communicate(timeout=15)
        if mode.startswith('artifact-'):
            if mode == 'artifact-reaper-first':
                if contender.returncode == 0:
                    raise AssertionError('revoked artifact writer succeeded')
                if 'Model artifact attempt no longer owns work' not in error:
                    raise RuntimeError(error)
            else:
                if contender.returncode:
                    if mode == 'artifact-retry' and 'duplicate key value' in error:
                        raise AssertionError('concurrent artifact retry rejected')
                    raise RuntimeError(error)
                second = json.loads(output.strip())
                if mode == 'artifact-retry' and second != first:
                    raise AssertionError('concurrent artifact retry changed')
                if mode == 'artifact-writer-first' and second is not True:
                    raise AssertionError('artifact write prevented reaping')
            retained = json.loads(sql(f"SELECT json_build_object('run',(SELECT status FROM {schema}.model_runs WHERE id='{run}'),'active',(SELECT active_attempt_id FROM {schema}.model_run_stages WHERE id='{stage}'),'artifacts',(SELECT count(*) FROM {schema}.model_run_artifacts),'receipts',(SELECT count(*) FROM {schema}.model_artifact_write_receipts),'bound',(SELECT count(*) FROM {schema}.model_run_artifacts WHERE attempt_id='{attempt}' AND run_id='{run}' AND stage_id='{stage}'),'revoked',(SELECT revoked_at IS NOT NULL FROM {schema}.model_stage_attempts WHERE id='{attempt}'));"))
            count = 0 if mode == 'artifact-reaper-first' else 1
            if retained != {'run': 'running' if mode == 'artifact-retry' else 'failed', 'active': attempt if mode == 'artifact-retry' else None, 'artifacts': count, 'receipts': count, 'bound': count, 'revoked': mode != 'artifact-retry'}:
                raise AssertionError('concurrent artifact retained state differs')
            return {'blocked_observed': True, 'retained_artifacts': count, 'exact_attempt_binding': True}
        if mode.startswith('instrument-'):
            if mode == 'instrument-reaper-first':
                if contender.returncode == 0:
                    raise AssertionError('revoked instrument writer succeeded')
                if 'Instrument attempt no longer owns work' not in error:
                    raise RuntimeError(error)
            else:
                if contender.returncode:
                    if mode == 'instrument-retry' and 'duplicate key value' in error:
                        raise AssertionError('concurrent instrument retry rejected')
                    raise RuntimeError(error)
                second = json.loads(output.strip())
                if mode == 'instrument-retry' and second != first:
                    raise AssertionError('concurrent instrument retry changed')
                if mode == 'instrument-writer-first' and second is not True:
                    raise AssertionError('instrument write prevented reaping')
            retained = json.loads(sql(f"SELECT json_build_object('run',(SELECT status FROM {schema}.model_runs WHERE id='{run}'),'active',(SELECT active_attempt_id FROM {schema}.model_run_stages WHERE id='{stage}'),'instruments',(SELECT count(*) FROM {schema}.model_attempt_instrument_custody),'receipts',(SELECT count(*) FROM {schema}.model_attempt_instrument_receipts),'bound',(SELECT count(*) FROM {schema}.model_attempt_instrument_custody WHERE attempt_id='{attempt}' AND model_run_id='{run}' AND stage_id='{stage}'),'revoked',(SELECT revoked_at IS NOT NULL FROM {schema}.model_stage_attempts WHERE id='{attempt}'));"))
            count = 0 if mode == 'instrument-reaper-first' else 1
            if retained != {'run': 'running' if mode == 'instrument-retry' else 'failed', 'active': attempt if mode == 'instrument-retry' else None, 'instruments': count, 'receipts': count, 'bound': count, 'revoked': mode != 'instrument-retry'}:
                raise AssertionError('concurrent instrument retained state differs')
            return {'blocked_observed': True, 'retained_instruments': count, 'exact_attempt_binding': True}
        if mode.startswith('relaunch-'):
            if mode == 'relaunch-old-writer':
                if contender.returncode == 0:
                    raise AssertionError('old writer survived concurrent relaunch')
                if 'Model stage attempt no longer owns work' not in error:
                    raise RuntimeError(error)
            else:
                if contender.returncode:
                    if 'Model relaunch state changed' in error:
                        raise AssertionError('concurrent relaunch retry rejected')
                    raise RuntimeError(error)
                if json.loads(output.strip()) != first:
                    raise AssertionError('concurrent relaunch retry changed')
            retained = json.loads(sql(f"SELECT json_build_object('run',(SELECT status FROM {schema}.model_runs WHERE id='{run}'),'stage',(SELECT status FROM {schema}.model_run_stages WHERE id='{stage}'),'active',(SELECT active_attempt_id FROM {schema}.model_run_stages WHERE id='{stage}'),'failures',(SELECT failure_count FROM {schema}.model_runs WHERE id='{run}'),'relaunches',(SELECT count(*) FROM {schema}.model_run_relaunch_receipts),'writes',(SELECT count(*) FROM {schema}.model_stage_write_receipts));"))
            if retained != {'run': 'queued', 'stage': 'queued', 'active': None, 'failures': 1, 'relaunches': 1, 'writes': 1}:
                raise AssertionError('concurrent relaunch changed retained state')
            return {'blocked_observed': True, 'single_relaunch_retained': True}
        if mode == 'reaper-first':
            if contender.returncode == 0:
                raise AssertionError('revoked writer succeeded')
            if 'Model stage attempt no longer owns work' not in error:
                raise RuntimeError(error)
            retained = json.loads(sql(f"SELECT json_build_object('run',(SELECT status FROM {schema}.model_runs WHERE id='{run}'),'stage',(SELECT status FROM {schema}.model_run_stages WHERE id='{stage}'),'active',(SELECT active_attempt_id FROM {schema}.model_run_stages WHERE id='{stage}'),'revoked',(SELECT revoked_at IS NOT NULL FROM {schema}.model_stage_attempts WHERE id='{attempt}'),'writes',(SELECT count(*) FROM {schema}.model_stage_write_receipts));"))
            if retained != {'run': 'failed', 'stage': 'failed', 'active': None, 'revoked': True, 'writes': 0}:
                raise AssertionError('revoked state changed after late writer')
            return {'blocked_observed': True, 'late_writer_refused': True}
        if contender.returncode:
            raise RuntimeError(error)
        second = json.loads(output.strip())
        if mode == 'writer-first':
            if second is not False:
                raise AssertionError('terminal run reaped')
            retained = json.loads(sql(f"SELECT json_build_object('run',(SELECT status FROM {schema}.model_runs WHERE id='{run}'),'stage',(SELECT status FROM {schema}.model_run_stages WHERE id='{stage}'),'writes',(SELECT count(*) FROM {schema}.model_stage_write_receipts));"))
            if retained != {'run': 'succeeded', 'stage': 'succeeded', 'writes': 1}:
                raise AssertionError('completed state changed after reaper')
            return {'blocked_observed': True, 'completed_run_preserved': True}
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
for name, candidate, expected, mode in (
    ('baseline', source, None, 'claim'),
    ('harmless', source + '\n-- Harmless contention control.\n', None, 'claim'),
    ('allow-second-owner', source.replace("OR v_stage.status <> 'queued'", '').replace('OR v_stage.active_attempt_id IS NOT NULL', ''), 'second claimant won', 'claim'),
    ('restored', source, None, 'claim'),
    ('reaper-first', source, None, 'reaper-first'),
    ('reaper-first-harmless', source + '\n-- Harmless race control.\n', None, 'reaper-first'),
    ('writer-first', source, None, 'writer-first'),
    ('writer-first-harmless', source + '\n-- Harmless race control.\n', None, 'writer-first'),
    ('reap-completed-run', source.replace("v_run.status NOT IN ('queued','running') OR", ''), 'terminal run reaped', 'writer-first'),
    ('writer-first-restored', source, None, 'writer-first'),
    ('revive-reaped-run', source.replace('v_stage.active_attempt_id IS DISTINCT FROM p_attempt_id', 'false').replace("v_stage.status <> 'running'", 'false').replace("v_run.status NOT IN ('queued','running')", 'false').replace('AND c.attempt_id IS NOT DISTINCT FROM NEW.active_attempt_id', ''), 'revoked writer succeeded', 'reaper-first'),
    ('reaper-first-restored', source, None, 'reaper-first'),
    ('relaunch-retry', source, None, 'relaunch-retry'),
    ('relaunch-retry-harmless', source + '\n-- Harmless relaunch control.\n', None, 'relaunch-retry'),
    ('relaunch-old-writer', source, None, 'relaunch-old-writer'),
    ('relaunch-old-writer-harmless', source + '\n-- Harmless relaunch control.\n', None, 'relaunch-old-writer'),
    ('ignore-relaunch-receipt', source.replace('FROM public.model_run_relaunch_receipts WHERE request_id=p_request_id;', 'FROM public.model_run_relaunch_receipts WHERE false;'), 'concurrent relaunch retry rejected', 'relaunch-retry'),
    ('relaunch-retry-restored', source, None, 'relaunch-retry'),
    ('allow-old-relaunch-writer', source.replace('v_stage.active_attempt_id IS DISTINCT FROM p_attempt_id', 'false').replace("v_stage.status <> 'running'", 'false').replace('AND c.attempt_id IS NOT DISTINCT FROM NEW.active_attempt_id', ''), 'old writer survived concurrent relaunch', 'relaunch-old-writer'),
    ('relaunch-old-writer-restored', source, None, 'relaunch-old-writer'),
    ('artifact-retry', source, None, 'artifact-retry'),
    ('artifact-retry-harmless', source + '\n-- Harmless artifact control.\n', None, 'artifact-retry'),
    ('artifact-ignore-receipt', source.replace('FROM public.model_artifact_write_receipts WHERE request_id=p_request_id;', 'FROM public.model_artifact_write_receipts WHERE false;'), 'concurrent artifact retry rejected', 'artifact-retry'),
    ('artifact-retry-restored', source, None, 'artifact-retry'),
    ('artifact-reaper-first', source, None, 'artifact-reaper-first'),
    ('artifact-reaper-first-harmless', source + '\n-- Harmless artifact control.\n', None, 'artifact-reaper-first'),
    ('artifact-revoked-write', source.replace("IF v_stage.active_attempt_id IS DISTINCT FROM p_attempt_id OR v_stage.status<>'running'\n     OR v_run.status NOT IN ('queued','running') OR v_attempt.revoked_at IS NOT NULL THEN\n  RAISE EXCEPTION 'Model artifact", "IF false THEN\n  RAISE EXCEPTION 'Model artifact"), 'revoked artifact writer succeeded', 'artifact-reaper-first'),
    ('artifact-reaper-first-restored', source, None, 'artifact-reaper-first'),
    ('artifact-writer-first', source, None, 'artifact-writer-first'),
    ('artifact-writer-first-harmless', source + '\n-- Harmless artifact control.\n', None, 'artifact-writer-first'),
    ('artifact-blocks-reaper', source.replace("IF NOT FOUND OR v_run.status NOT IN ('queued','running') OR v_run.updated_at>p_stale_before THEN", "IF NOT FOUND OR EXISTS(SELECT 1 FROM public.model_run_artifacts WHERE run_id=p_run_id) OR v_run.status NOT IN ('queued','running') OR v_run.updated_at>p_stale_before THEN"), 'artifact write prevented reaping', 'artifact-writer-first'),
    ('artifact-writer-first-restored', source, None, 'artifact-writer-first'),
    ('instrument-retry', source, None, 'instrument-retry'),
    ('instrument-retry-harmless', source + '\n-- Harmless instrument control.\n', None, 'instrument-retry'),
    ('instrument-ignore-receipt', source.replace('FROM public.model_attempt_instrument_receipts WHERE request_id=p_request_id;', 'FROM public.model_attempt_instrument_receipts WHERE false;'), 'concurrent instrument retry rejected', 'instrument-retry'),
    ('instrument-retry-restored', source, None, 'instrument-retry'),
    ('instrument-reaper-first', source, None, 'instrument-reaper-first'),
    ('instrument-reaper-first-harmless', source + '\n-- Harmless instrument control.\n', None, 'instrument-reaper-first'),
    ('instrument-revoked-write', source.replace("IF v_stage.active_attempt_id IS DISTINCT FROM p_attempt_id OR v_stage.status<>'running'\n    OR v_run.status NOT IN ('queued','running') OR v_attempt.revoked_at IS NOT NULL THEN\n  RAISE EXCEPTION 'Instrument", "IF false THEN\n  RAISE EXCEPTION 'Instrument"), 'revoked instrument writer succeeded', 'instrument-reaper-first'),
    ('instrument-reaper-first-restored', source, None, 'instrument-reaper-first'),
    ('instrument-writer-first', source, None, 'instrument-writer-first'),
    ('instrument-writer-first-harmless', source + '\n-- Harmless instrument control.\n', None, 'instrument-writer-first'),
    ('instrument-blocks-reaper', source.replace("IF NOT FOUND OR v_run.status NOT IN ('queued','running') OR v_run.updated_at>p_stale_before THEN", "IF NOT FOUND OR EXISTS(SELECT 1 FROM public.model_attempt_instrument_custody WHERE model_run_id=p_run_id) OR v_run.status NOT IN ('queued','running') OR v_run.updated_at>p_stale_before THEN"), 'instrument write prevented reaping', 'instrument-writer-first'),
    ('instrument-writer-first-restored', source, None, 'instrument-writer-first'),



):
    try:
        evidence = check(candidate, mode)
    except AssertionError as error:
        if str(error) != expected:
            raise
        results.append({'control': name, 'detected': str(error)})
    else:
        if expected:
            raise AssertionError(f'{name}: defect not detected')
        results.append({'control': name, **evidence})
print(json.dumps(results, indent=2))
