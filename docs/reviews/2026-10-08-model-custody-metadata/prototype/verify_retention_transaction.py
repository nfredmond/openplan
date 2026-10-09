"""Exercise migration 18 in statement-autocommit mode and prove atomic failure."""
from pathlib import Path
import hashlib
import json
import os
import re
import subprocess
import uuid

REPO = Path(__file__).resolve().parents[4]


def main():
    source = json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
    if source['container'] != 'supabase_db_openplan-restore-target-2026091050' or not re.fullmatch(r'openplan_kpi_upgrade_[0-9a-f]{32}', source['database']):
        raise ValueError('Select the owned predecessor fixture')
    output = Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT'])
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    def execute(database, body):
        return subprocess.run(['docker','exec','-i',source['container'],'psql','-X','-qAt','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1'],input=body,capture_output=True,text=True,timeout=30)
    def sql(database, body):
        result = execute(database, body)
        if result.returncode:
            raise RuntimeError(result.stderr)
        return result.stdout.strip()
    if sql(source['database'], 'SELECT max(version) FROM supabase_migrations.schema_migrations;') != '20261016000017':
        raise ValueError('Source must precede retention migration')
    if sql('postgres', f"SELECT count(*) FROM pg_stat_activity WHERE datname='{source['database']}';") != '0':
        raise RuntimeError('Source has active sessions; do not stop them')
    body = (REPO / 'openplan/supabase/migrations/20261016000018_model_execution_retention.sql').read_text()
    cases = [('baseline',body,None),('harmless',body+'\n-- Harmless comment.\n',None),
             ('missing-transaction',body.replace('BEGIN;\n','',1).removesuffix('\nCOMMIT;\n'),'LOCK TABLE can only be used in transaction blocks'),
             ('mid-migration-error',body.replace('\nCOMMIT;','\nSELECT 1/0;\nCOMMIT;'),'division by zero'),
             ('restored',body,None)]
    records = []
    for name, migration, expected_error in cases:
        database = 'openplan_retention_txn_' + uuid.uuid4().hex
        sql('postgres',f'CREATE DATABASE {database} TEMPLATE {source["database"]};')
        meta = {'container':source['container'],'database':database,'source_database':source['database'],'case':name}
        (output / (name+'-candidate.json')).write_text(json.dumps(meta,indent=2)+'\n')
        before = sql(database,"SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.model_runs r;")
        result = execute(database,migration)
        (output / (name+'.log')).write_text(result.stdout+'\n'+result.stderr)
        if expected_error:
            if result.returncode == 0 or expected_error not in result.stderr:
                raise AssertionError('Expected native migration failure absent: '+name)
            if name=='mid-migration-error':
                remaining = sql(database,"SELECT to_regclass('public.model_stage_execution_starts') IS NULL AND to_regclass('public.model_execution_custody_enrollment') IS NULL AND to_regprocedure('public.model_run_has_retained_commands(uuid)') IS NULL;")
                if remaining != 't':
                    raise AssertionError('Failed transaction left retention objects behind')
            records.append({**meta,'caught':expected_error,'atomic_rollback':name=='mid-migration-error'})
        else:
            if result.returncode:
                raise AssertionError('Autocommit installation failed: '+result.stderr)
            counts = json.loads(sql(database,"SELECT json_build_array((SELECT count(*) FROM public.model_runs),(SELECT count(*) FROM public.model_execution_custody_enrollment WHERE provenance='historical_unassessed'),(SELECT count(*) FROM public.model_stage_execution_starts));"))
            if counts[0] != counts[1] or counts[2] != 0:
                raise AssertionError('Enrollment differs or invented historical starts')
            records.append({**meta,'installed':True,'historical_enrollment':counts[1],'invented_starts':counts[2]})
        if sql(database,"SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.model_runs r;") != before:
            raise AssertionError('Migration changed existing model runs')
    evidence = {'migration_sha256':hashlib.sha256(body.encode()).hexdigest(),'cases':records,'scope':'Owned native clones and statement-autocommit application. Positive installation, exact run preservation and full rollback of retention objects after deliberate SQL error. Missing transaction reproduces CI reset failure. CLI reset and reapply still require their own checks.'}
    (output/'transaction-controls.json').write_text(json.dumps(evidence,indent=2)+'\n')
    print(json.dumps(evidence,indent=2))


if __name__=='__main__':
    main()
