"""Install the recovery reader twice on an owned populated clone and inspect it."""
from pathlib import Path
import hashlib
import json
import os
import re
import subprocess
import uuid
from verify_recovery_status_reader import verify as installed_cases

REPO = Path(__file__).resolve().parents[4]


def main():
    source = json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
    if source['container'] != 'supabase_db_openplan-restore-target-2026091050' or not re.fullmatch(r'openplan_retention_upgrade_[0-9a-f]{32}', source['database']):
        raise ValueError('Select the owned retention upgrade source')
    output = Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT']).resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    target = 'openplan_retention_upgrade_' + uuid.uuid4().hex
    def sql(database, statement):
        result = subprocess.run(['docker', 'exec', '-i', source['container'], 'psql', '-X', '-qAt', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1'], input=statement, capture_output=True, text=True, timeout=30)
        if result.returncode:
            (output / 'failed-sql.log').write_text(result.stderr)
            raise RuntimeError('Owned upgrade query failed; inspect private log')
        return result.stdout.strip()
    if sql(source['database'], 'SELECT max(version) FROM supabase_migrations.schema_migrations;') != '20261016000018':
        raise ValueError('Source is not at migration 18')
    if sql('postgres', f"SELECT count(*) FROM pg_stat_activity WHERE datname='{source['database']}';") != '0':
        raise RuntimeError('Source is in use; do not terminate its sessions')
    sql('postgres', f'CREATE DATABASE {target} TEMPLATE {source["database"]};')
    record = {'container': source['container'], 'database': target, 'fixture_run': source['fixture_run'], 'source_database': source['database'], 'status': 'clone created; upgrade unconfirmed'}
    metadata = output / 'candidate.json'
    metadata.write_text(json.dumps(record, indent=2) + '\n')
    tables = ('model_runs', 'model_run_stages', 'model_run_artifacts', 'model_run_kpis', 'modeling_claim_decisions', 'modeling_validation_results', 'modeling_validation_instrument_v2_custody', 'modeling_validation_assessments', 'model_assessment_command_receipts', 'model_legacy_artifact_receipts', 'model_legacy_kpi_receipts', 'model_stage_attempts', 'model_stage_claim_receipts', 'model_stage_write_receipts', 'model_run_relaunch_receipts', 'model_kpi_write_receipts', 'model_artifact_write_receipts', 'model_attempt_instrument_custody', 'model_attempt_instrument_receipts', 'model_stage_execution_starts', 'model_execution_custody_enrollment')
    def inventory(database):
        return {table: json.loads(sql(database, f"SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.{table} t;")) for table in tables}
    before = inventory(target)
    (output / 'before.json').write_text(json.dumps(before, indent=2) + '\n')
    state = json.loads(subprocess.check_output(['docker', 'inspect', source['container']], text=True))[0]
    settings = dict(item.split('=', 1) for item in state['Config']['Env'] if '=' in item)
    port = state['NetworkSettings']['Ports']['5432/tcp'][0]['HostPort']
    url = f'postgresql://postgres@127.0.0.1:{port}/{target}?sslmode=disable'
    cli = os.environ['OPENPLAN_PROOF_SUPABASE_CLI']
    for number in (1, 2):
        result = subprocess.run([cli, 'migration', 'up', '--db-url', url, '--workdir', str(REPO / 'openplan'), '--yes'], capture_output=True, text=True, timeout=120, env={**os.environ, 'PGPASSWORD': settings['POSTGRES_PASSWORD']})
        (output / f'migration-{number}.log').write_text(result.stdout + '\n' + result.stderr)
        if result.returncode:
            raise RuntimeError('Migration failed; preserve clone for diagnosis')
        if sql(target, "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261016000019';") != '1':
            raise AssertionError('Reader migration history missing or duplicated')
        if inventory(target) != before:
            raise AssertionError('Reader migration changed existing model records')
    previous_metadata = os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']
    try:
        os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA'] = str(metadata)
        cases = installed_cases('')
    finally:
        os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA'] = previous_metadata
    if inventory(target) != before or inventory(source['database']) != before:
        raise AssertionError('Installed cases or clone changed retained source rows')
    if sql(source['database'], 'SELECT max(version) FROM supabase_migrations.schema_migrations;') != '20261016000018':
        raise AssertionError('Source migration history changed')
    migration = REPO / 'openplan/supabase/migrations/20261016000019_model_recovery_status.sql'
    record.update(status='migration 19 installed twice; retained rows and installed reader verified', migration_sha256=hashlib.sha256(migration.read_bytes()).hexdigest(), compared_tables={key: len(value) for key, value in before.items()}, installed_cases=cases, source_unchanged=True, scope='Owned populated clone, actual CLI history/reapply, exact rows across 21 model tables, native scope and role checks. No full installation restore, live page RLS, browser, dispatcher or scientific acceptance.')
    metadata.write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps(record, indent=2))


if __name__ == '__main__':
    main()
