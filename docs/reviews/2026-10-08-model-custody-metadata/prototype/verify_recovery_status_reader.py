"""Native rollback-only recovery reader proof against the owned upgrade fixture."""
from pathlib import Path
import hashlib
import json
import os
import re
import subprocess
import uuid

REPO = Path(__file__).resolve().parents[4]


def verify(body):
    meta = json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
    if meta['container'] != 'supabase_db_openplan-restore-target-2026091050' or not re.fullmatch(r'openplan_retention_upgrade_[0-9a-f]{32}', meta['database']):
        raise ValueError('Select only the owned retention-upgrade fixture')
    fixture = str(uuid.UUID(meta['fixture_run']))
    new, stage, wrong = (str(uuid.uuid4()) for _ in range(3))
    sql = 'BEGIN; SET LOCAL lock_timeout=\'2s\'; SET LOCAL statement_timeout=\'10s\';\n' + body + f"""
CREATE FUNCTION pg_temp.assert_recovery(target uuid, expected text, starts integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual jsonb; ws uuid; enrolled timestamptz; latest timestamptz;
BEGIN
 SELECT workspace_id INTO STRICT ws FROM public.model_runs WHERE id=target;
 SELECT observed_at INTO STRICT enrolled FROM public.model_execution_custody_enrollment WHERE run_id=target;
 SELECT max(observed_at) INTO latest FROM public.model_stage_execution_starts WHERE run_id=target;
 actual:=public.inspect_model_recovery_status(ws,target);
 IF actual IS DISTINCT FROM jsonb_build_object('workspace_id',ws,'run_id',target,'provenance',expected,'enrolled_at',enrolled,'observed_starts',starts,'last_start_observed_at',latest) THEN
   RAISE EXCEPTION 'Recovery record differs';
 END IF;
END $$;
SELECT pg_temp.assert_recovery('{fixture}','historical_unassessed',0);
INSERT INTO public.model_runs(id,workspace_id,model_id,engine_key,status,run_title,created_by)
 SELECT '{new}',workspace_id,model_id,'aequilibrae','queued','Synthetic recovery reader',created_by
 FROM public.model_runs WHERE id='{fixture}';
SELECT pg_temp.assert_recovery('{new}','new_run',0);
INSERT INTO public.model_run_stages(id,run_id,stage_name,status,sort_order)
 VALUES('{stage}','{new}','Synthetic reader','queued',1);
UPDATE public.model_run_stages SET status='running' WHERE id='{stage}' AND status='queued';
SELECT pg_temp.assert_recovery('{new}','new_run',1);
DO $$ DECLARE ws uuid; BEGIN
 SELECT workspace_id INTO ws FROM public.model_runs WHERE id='{new}';
 IF public.inspect_model_recovery_status('{wrong}','{new}') IS NOT NULL
 OR public.inspect_model_recovery_status(ws,'{wrong}') IS NOT NULL
 OR public.inspect_model_recovery_status(NULL,'{new}') IS NOT NULL THEN
   RAISE EXCEPTION 'Recovery scope mismatch accepted';
 END IF;
 IF has_function_privilege('anon','public.inspect_model_recovery_status(uuid,uuid)','EXECUTE')
 OR has_function_privilege('authenticated','public.inspect_model_recovery_status(uuid,uuid)','EXECUTE') THEN
   RAISE EXCEPTION 'Recovery reader permission widened';
 END IF;
END $$;
SET LOCAL ROLE service_role;
DO $$ DECLARE ws uuid; actual jsonb; BEGIN
 SELECT workspace_id INTO ws FROM public.model_runs WHERE id='{new}';
 actual:=public.inspect_model_recovery_status(ws,'{new}');
 IF actual->>'provenance' IS DISTINCT FROM 'new_run' OR actual->>'observed_starts' IS DISTINCT FROM '1' THEN
   RAISE EXCEPTION 'Service reader did not return observed state';
 END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.inspect_model_recovery_status('{wrong}','{new}');
  RAISE EXCEPTION 'Authenticated reader allowed' USING ERRCODE='ZX002';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN
  PERFORM public.inspect_model_recovery_status('{wrong}','{new}');
  RAISE EXCEPTION 'Anonymous reader allowed' USING ERRCODE='ZX002';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
ROLLBACK;
"""
    result = subprocess.run(['docker', 'exec', '-i', meta['container'], 'psql', '-X', '-qAt', '-U', 'postgres', '-d', meta['database'], '-v', 'ON_ERROR_STOP=1'], input=sql, capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise AssertionError(result.stderr.strip())
    return {'historical_and_new_enrollment_exact': True, 'observed_start_exact': True,
            'wrong_and_missing_scope_unavailable': True, 'service_only_execution': True, 'rolled_back': True}


def main():
    source = (REPO / 'openplan/supabase/migrations/20261016000019_model_recovery_status.sql').read_text()
    cases = [
        ('baseline', source, None), ('harmless', source + '\n-- Harmless comment.\n', None),
        ('scope-bypass', source.replace('r.id=p_run AND r.workspace_id=p_workspace', 'r.id=p_run'), 'Recovery scope mismatch accepted'),
        ('history-relabel', source.replace("'provenance', e.provenance", "'provenance', 'new_run'"), 'Recovery record differs'),
        ('permission-widened', source + '\nGRANT EXECUTE ON FUNCTION public.inspect_model_recovery_status(uuid,uuid) TO authenticated;\n', 'Recovery reader permission widened'),
        ('start-count-lost', source.replace('(SELECT count(*) FROM public.model_stage_execution_starts s WHERE s.run_id=r.id)', '0'), 'Recovery record differs'),
        ('restored', source, None),
    ]
    records = []
    for name, body, error in cases:
        try:
            result = verify(body)
        except AssertionError as failure:
            if error is None or error not in str(failure):
                raise
            records.append({'case': name, 'caught': error})
        else:
            if error:
                raise AssertionError('Native control survived: ' + name)
            records.append({'case': name, 'result': result})
    output = Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT'])
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    evidence = {'migration_sha256': hashlib.sha256(source.encode()).hexdigest(), 'cases': records,
                'scope': 'Native PostgreSQL function, exact enrollment/start records, scope and service-only execution. Every variant rolls back. No installed migration history, page authorization, full upgrade/restore, browser or scientific acceptance.'}
    (output / 'recovery-reader.json').write_text(json.dumps(evidence, indent=2) + '\n')
    print(json.dumps(evidence, indent=2))


if __name__ == '__main__':
    main()
