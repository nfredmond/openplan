"""Apply model retention to a populated owned clone, then reapply and inspect."""
from pathlib import Path
import hashlib
import json
import os
import re
import subprocess
import uuid

REPO = Path(__file__).resolve().parents[4]
VERSION = '20261016000018'


def check():
    meta = json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
    if meta['container'] != 'supabase_db_openplan-restore-target-2026091050' or not re.fullmatch('openplan_kpi_upgrade_[0-9a-f]{32}', meta['database']):
        raise ValueError('Select only the named owned proof source')
    output = Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT']).resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    target = 'openplan_retention_upgrade_' + uuid.uuid4().hex
    cli = Path(os.environ['OPENPLAN_PROOF_SUPABASE_CLI']).resolve()
    migration = REPO / 'openplan/supabase/migrations/20261016000018_model_execution_retention.sql'

    def sql(database, statement):
        result = subprocess.run(['docker', 'exec', '-i', meta['container'], 'psql', '-X', '-qAt', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1'], input=statement, capture_output=True, text=True, timeout=30)
        if result.returncode:
            (output / 'failed-sql.log').write_text(result.stderr)
            raise RuntimeError('Owned upgrade query failed; retained database: ' + target)
        return result.stdout.strip()

    if sql(meta['database'], 'SELECT max(version) FROM supabase_migrations.schema_migrations;') != '20261016000017':
        raise ValueError('Proof source is not at the expected predecessor')
    if sql('postgres', f"SELECT count(*) FROM pg_stat_activity WHERE datname='{meta['database']}';") != '0':
        raise RuntimeError('Source proof database is in use; do not interrupt sessions')
    sql('postgres', f'CREATE DATABASE "{target}" TEMPLATE "{meta["database"]}";')
    record = dict(container=meta['container'], database=target, source_database=meta['database'], fixture_run=meta['fixture_run'], status='clone created; upgrade not yet confirmed')
    (output / 'candidate.json').write_text(json.dumps(record, indent=2) + '\n')
    tables = ('model_runs', 'model_run_stages', 'model_run_artifacts', 'model_run_kpis', 'modeling_claim_decisions', 'modeling_validation_results', 'modeling_validation_instrument_v2_custody', 'modeling_validation_assessments', 'model_assessment_command_receipts', 'model_legacy_artifact_receipts', 'model_legacy_kpi_receipts', 'model_stage_attempts', 'model_stage_claim_receipts', 'model_stage_write_receipts', 'model_run_relaunch_receipts', 'model_kpi_write_receipts', 'model_artifact_write_receipts', 'model_attempt_instrument_custody', 'model_attempt_instrument_receipts')

    def snapshot():
        return {table: json.loads(sql(target, f"SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.{table} t;")) for table in tables}

    before = snapshot()
    if not before['modeling_validation_assessments'] or not before['modeling_validation_instrument_v2_custody']:
        raise AssertionError('Upgrade must include both historical assessment formats')
    (output / 'before.json').write_text(json.dumps(before, indent=2) + '\n')
    state = json.loads(subprocess.check_output(['docker', 'inspect', meta['container']], text=True))[0]
    settings = dict(value.split('=', 1) for value in state['Config']['Env'] if '=' in value)
    port = state['NetworkSettings']['Ports']['5432/tcp'][0]['HostPort']
    url = 'postgresql://postgres@127.0.0.1:' + port + '/' + target + '?sslmode=disable'
    def advisors(label):
        result = subprocess.run([str(cli),'db','advisors','--db-url',url,'--type','all','--level','info','--fail-on','none','--output','json'],capture_output=True,text=True,timeout=90,env={**os.environ,'PGPASSWORD':settings['POSTGRES_PASSWORD']})
        if result.returncode:
            raise RuntimeError('Advisor query failed; retain proof database')
        (output / ('advisors-'+label+'.json')).write_text(result.stdout)
    advisors('before')
    for attempt in range(2):
        result = subprocess.run([str(cli), 'migration', 'up', '--db-url', url, '--workdir', str(REPO / 'openplan'), '--yes'], capture_output=True, text=True, timeout=90, env={**os.environ, 'PGPASSWORD': settings['POSTGRES_PASSWORD']})
        (output / f'migration-up-{attempt+1}.log').write_text(result.stdout + '\n' + result.stderr)
        if result.returncode:
            raise RuntimeError('Migration command failed; inspect private upgrade log')
        if sql(target, f"SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='{VERSION}';") != '1':
            raise AssertionError('Migration history missing or duplicated')
    advisors('after')
    after = snapshot()
    (output / 'after.json').write_text(json.dumps(after, indent=2) + '\n')
    if before != after:
        raise AssertionError('Existing rows changed during retention migration')
    if sql(meta['database'], 'SELECT max(version) FROM supabase_migrations.schema_migrations;') != '20261016000017':
        raise AssertionError('Proof source migration history changed')
    if sql(target, 'SELECT count(*) FROM public.model_stage_execution_starts;') != '0':
        raise AssertionError('Migration invented execution starts')
    enrollment = json.loads(sql(target, "SELECT json_build_object('count',count(*),'historical',count(*) FILTER(WHERE provenance='historical_unassessed')) FROM public.model_execution_custody_enrollment;"))
    if enrollment != {'count':len(before['model_runs']), 'historical':len(before['model_runs'])}:
        raise AssertionError('Historical enrollment differs from existing run denominator')
    fixture = str(uuid.UUID(meta['fixture_run']))
    cases = Path(__file__).with_name('model-retention-installed-cases.sql').read_text()
    sql(target, "BEGIN; SET LOCAL openplan.proof_fixture='" + fixture + "';\n" + cases + '\nROLLBACK;')
    if snapshot() != before:
        raise AssertionError('Installed rollback cases changed retained records')
    record.update(status='migration applied twice; existing rows preserved; installed cases passed', migration_sha256=hashlib.sha256(migration.read_bytes()).hexdigest(), counts={key: len(value) for key, value in before.items()}, migration_history_rows=1, historical_enrollment=enrollment, source_unchanged=True, scope='Synthetic owned clone, CLI migration history and installed rollback cases. No application database, operator reconciliation, Storage byte verification, full dispatcher or scientific acceptance.')
    (output / 'candidate.json').write_text(json.dumps(record, indent=2) + '\n')
    return record


if __name__ == '__main__':
    print(json.dumps(check(), indent=2))
