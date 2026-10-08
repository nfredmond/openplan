"""Native rollback-only transition checks; no worker or scientific execution."""
from pathlib import Path
import hashlib
import json
import os
import re
import subprocess
import uuid

ROOT = Path(__file__).resolve().parent


def verify(source):
    meta = json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
    if meta['container'] != 'supabase_db_openplan-restore-target-2026091050' or not re.fullmatch(r'openplan_retention_upgrade_[0-9a-f]{32}', meta['database']):
        raise ValueError('Select the owned retention proof database')
    fixture = str(uuid.UUID(meta['fixture_run']))
    command = ['docker', 'exec', '-i', meta['container'], 'psql', '-X', '-qAt', '-U', 'postgres', '-d', meta['database'], '-v', 'ON_ERROR_STOP=1']
    absence = "SELECT to_regclass('public.model_stage_skip_receipts') IS NULL AND to_regprocedure('public.skip_blocked_model_stage(uuid,uuid,uuid,uuid,uuid,text)') IS NULL;"
    def assert_absent():
        check = subprocess.run(command, input=absence, text=True, capture_output=True, timeout=15, check=True)
        if check.stdout.strip() != 't':
            raise AssertionError('Skip prototype escaped rollback or already exists')
    assert_absent()
    body = "BEGIN; SET LOCAL statement_timeout=10000; SET LOCAL lock_timeout=1000;\n" + source + f"""
CREATE FUNCTION pg_temp.refuse_skip_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_setting('openplan.proof_skip_receipt_failure',true)='yes' THEN
  RAISE EXCEPTION 'Synthetic skip receipt failure';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER proof_refuse_skip_receipt BEFORE INSERT ON public.model_stage_skip_receipts
FOR EACH ROW EXECUTE FUNCTION pg_temp.refuse_skip_receipt();
CREATE FUNCTION pg_temp.check_skip(target_status text, blocker_status text, expected text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE run uuid:=gen_random_uuid(); stage uuid:=gen_random_uuid(); prior uuid:=gen_random_uuid();
 request uuid:=gen_random_uuid(); ws uuid; response jsonb; before_parent jsonb;
 before_target jsonb; starts bigint; attempts bigint; failed_request uuid; extra uuid;
BEGIN
 INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
 SELECT run,workspace_id,model_id,engine_key,'queued','Synthetic blocked stage',created_by
 FROM public.model_runs WHERE id='{fixture}' RETURNING workspace_id INTO ws;
 IF ws IS NULL THEN RAISE EXCEPTION 'Fixture missing'; END IF;
 INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order) VALUES
 (prior,run,'Synthetic prerequisite',blocker_status,1),(stage,run,'Synthetic dependent',target_status,2);
 SELECT to_jsonb(r) INTO before_parent FROM public.model_runs r WHERE id=run;
 SELECT to_jsonb(s) INTO before_target FROM public.model_run_stages s WHERE id=stage;
 SELECT count(*) INTO starts FROM public.model_stage_execution_starts WHERE run_id=run;
 SELECT count(*) INTO attempts FROM public.model_stage_attempts WHERE run_id=run;
 response:=public.skip_blocked_model_stage(request,ws,run,stage,prior,'failed');
 IF response->>'outcome' IS DISTINCT FROM expected THEN
  RAISE EXCEPTION 'Skip outcome differs for target %, blocker %',target_status,blocker_status;
 END IF;
 IF response IS DISTINCT FROM public.skip_blocked_model_stage(request,ws,run,stage,prior,'failed') THEN
  RAISE EXCEPTION 'Exact retry changed';
 END IF;
 IF (SELECT to_jsonb(r) FROM public.model_runs r WHERE id=run) IS DISTINCT FROM before_parent
 OR (SELECT count(*) FROM public.model_stage_execution_starts WHERE run_id=run)<>starts
 OR (SELECT count(*) FROM public.model_stage_attempts WHERE run_id=run)<>attempts THEN
  RAISE EXCEPTION 'Skip invented execution or changed parent';
 END IF;
 IF expected='not_skipped' AND (SELECT to_jsonb(s) FROM public.model_run_stages s WHERE id=stage) IS DISTINCT FROM before_target THEN
  RAISE EXCEPTION 'Refusal changed target';
 END IF;
 IF expected='skipped' AND NOT EXISTS(SELECT 1 FROM public.model_run_stages WHERE id=stage
 AND status='skipped' AND completed_at IS NOT NULL AND started_at IS NULL AND active_attempt_id IS NULL
 AND error_message='Blocked by prior stage Synthetic prerequisite (failed)') THEN
  RAISE EXCEPTION 'Skipped record differs';
 END IF;
 BEGIN
  PERFORM public.skip_blocked_model_stage(request,ws,run,stage,prior,'cancelled');
  RAISE EXCEPTION 'Changed request accepted' USING ERRCODE='ZX002';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM<>'Blocked stage request identity reused with different payload' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM public.skip_blocked_model_stage(gen_random_uuid(),gen_random_uuid(),run,stage,prior,'failed');
  RAISE EXCEPTION 'Wrong workspace accepted' USING ERRCODE='ZX002';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM<>'Blocked stage scope mismatch' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM public.skip_blocked_model_stage(gen_random_uuid(),ws,run,prior,stage,'failed');
  RAISE EXCEPTION 'Later predecessor accepted' USING ERRCODE='ZX002';
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM<>'Blocked stage predecessor mismatch' THEN RAISE; END IF;
 END;
 IF expected='skipped' THEN
  extra:=gen_random_uuid(); failed_request:=gen_random_uuid();
  INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order)
   VALUES(extra,run,'Receipt rollback dependent','queued',3);
  SELECT to_jsonb(s) INTO before_target FROM public.model_run_stages s WHERE id=extra;
  PERFORM set_config('openplan.proof_skip_receipt_failure','yes',true);
  BEGIN
   PERFORM public.skip_blocked_model_stage(failed_request,ws,run,extra,prior,'failed');
   RAISE EXCEPTION 'Receipt failure ignored' USING ERRCODE='ZX002';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
   IF SQLERRM<>'Synthetic skip receipt failure' THEN RAISE; END IF;
  END;
  PERFORM set_config('openplan.proof_skip_receipt_failure','no',true);
  IF (SELECT to_jsonb(s) FROM public.model_run_stages s WHERE id=extra) IS DISTINCT FROM before_target
   OR EXISTS(SELECT 1 FROM public.model_stage_skip_receipts WHERE request_id=failed_request) THEN
   RAISE EXCEPTION 'Receipt failure left partial transition';
  END IF;
  IF public.skip_blocked_model_stage(failed_request,ws,run,extra,prior,'failed')->>'outcome'<>'skipped' THEN
   RAISE EXCEPTION 'Receipt failure prevented retry';
  END IF;
 END IF;
END $$;
SELECT pg_temp.check_skip('queued','failed','skipped');
SELECT pg_temp.check_skip('queued','succeeded','not_skipped');
SELECT pg_temp.check_skip('queued','running','not_skipped');
SELECT pg_temp.check_skip('running','failed','not_skipped');
SELECT pg_temp.check_skip('succeeded','failed','not_skipped');
SELECT pg_temp.check_skip('failed','failed','not_skipped');
SELECT pg_temp.check_skip('cancelled','failed','not_skipped');
SELECT pg_temp.check_skip('skipped','failed','not_skipped');
DO $$ BEGIN
 IF has_function_privilege('anon','public.skip_blocked_model_stage(uuid,uuid,uuid,uuid,uuid,text)','EXECUTE')
 OR has_function_privilege('authenticated','public.skip_blocked_model_stage(uuid,uuid,uuid,uuid,uuid,text)','EXECUTE')
 OR NOT has_function_privilege('service_role','public.skip_blocked_model_stage(uuid,uuid,uuid,uuid,uuid,text)','EXECUTE')
 OR has_table_privilege('service_role','public.model_stage_skip_receipts','INSERT') THEN
  RAISE EXCEPTION 'Skip permissions widened';
 END IF;
 IF EXISTS(SELECT 1 FROM public.model_stage_write_context) THEN RAISE EXCEPTION 'Skip context leaked'; END IF;
END $$;
ROLLBACK;
"""
    result = subprocess.run(command, input=body, text=True, capture_output=True, timeout=30)
    assert_absent()
    if result.returncode:
        raise AssertionError(result.stderr.strip())
    return {'queued_blocked_skipped': True, 'stale_blocker_refused': True,
            'running_and_terminal_targets_preserved': True, 'exact_retry': True,
            'changed_request_scope_and_order_refused': True,
            'no_new_attempt_or_execution_start': True, 'parent_unchanged': True,
            'permissions_checked': True, 'receipt_failure_atomic_and_retryable': True, 'rolled_back': True}


def main():
    source = (ROOT / 'skip-blocked-stage.sql').read_text()
    variants = [('baseline', source, None), ('harmless', source + '\n-- Harmless comment.\n', None)]
    for name, old, new, error in [
        ('overwrite-running', "target.status='queued'", "target.status IN ('queued','running')", 'Skip outcome differs'),
        ('ignore-blocker-change', 'blocker.status=p_blocker_status', 'true', 'Skip outcome differs'),
        ('ignore-request-identity', 'receipt.request_payload IS DISTINCT FROM request', 'false', 'Changed request accepted'),
        ('ignore-workspace', 'id=p_run_id AND workspace_id=p_workspace_id FOR UPDATE', 'id=p_run_id FOR UPDATE', 'Wrong workspace accepted'),
        ('ignore-order', 'NOT FOUND OR blocker.sort_order>=target.sort_order', 'NOT FOUND', 'Later predecessor accepted'),
        ('omit-receipt', 'VALUES(p_request_id,p_run_id,p_stage_id,p_blocker_id,request,response);',
         'SELECT p_request_id,p_run_id,p_stage_id,p_blocker_id,request,response WHERE false;', 'Exact retry changed'),
    ]:
        if source.count(old) != 1:
            raise AssertionError('Mutation anchor must match exactly once: ' + name)
        variants.append((name, source.replace(old, new), error))
    variants.append(('restored', source, None))
    records = []
    for name, body, expected in variants:
        try:
            result = verify(body)
        except AssertionError as error:
            if expected is None or expected not in str(error):
                raise
            records.append({'control': name, 'expected_failure': expected})
        else:
            if expected is not None:
                raise AssertionError('Broken behavior passed: ' + name)
            records.append({'control': name, 'result': result})
    report = {'source_sha256': hashlib.sha256(source.encode()).hexdigest(), 'controls': records,
              'limits': 'Rollback-only native SQL. No concurrent processes, worker dispatch, HTTP recovery, migration installation, browser or scientific acceptance.'}
    output = Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT'])
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    (output / 'skip-blocked-stage-controls.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
