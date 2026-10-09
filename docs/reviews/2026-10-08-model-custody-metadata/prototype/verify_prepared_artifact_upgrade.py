"""Apply the prepared artifact migration twice to an owned populated clone."""
from pathlib import Path
import hashlib
import json
import os
import re
import subprocess
import uuid

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]


def main():
    source = json.loads(Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_METADATA']).read_text())
    if source['container'] != 'supabase_db_openplan-restore-target-2026091050' or not re.fullmatch(r'openplan_retention_upgrade_[0-9a-f]{32}', source['database']):
        raise ValueError('Select owned retention source')
    fixture = str(uuid.UUID(source['fixture_run']))
    output = Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT'])
    output.mkdir(mode=0o700, parents=True, exist_ok=False)

    def sql(db, body):
        result = subprocess.run(['docker', 'exec', '-i', source['container'], 'psql', '-X', '-qAt', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1'], input=body, text=True, capture_output=True, timeout=30)
        if result.returncode:
            raise RuntimeError(result.stderr)
        return result.stdout.strip()

    source_version = sql(source['database'], 'SELECT max(version) FROM supabase_migrations.schema_migrations;')
    if source_version not in ('20261016000020',):
        raise ValueError('Source must have migration20 installed')
    if sql('postgres', f"SELECT count(*) FROM pg_stat_activity WHERE datname='{source['database']}';") != '0':
        raise RuntimeError('Source has active sessions')
    tables = sql(source['database'], "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'model%' ORDER BY tablename;").splitlines()
    if not tables or any(not re.fullmatch(r'[a-z_0-9]+', name) for name in tables):
        raise ValueError('Unexpected model table inventory')

    def inventory(db):
        return {name: sql(db, f"SELECT count(*)::text||':'||md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) FROM public.{name} t;") for name in tables}

    before = inventory(source['database'])
    database = 'openplan_retention_upgrade_' + uuid.uuid4().hex
    sql('postgres', f'CREATE DATABASE {database} TEMPLATE {source["database"]};')
    metadata = {'container': source['container'], 'fixture_run': fixture, 'database': database,
                'source_database': source['database'], 'source_version': source_version, 'status': 'prepared artifact upgrade pending'}
    (output / 'candidate.json').write_text(json.dumps(metadata, indent=2) + '\n')
    state = json.loads(subprocess.check_output(['docker', 'inspect', source['container']], text=True))[0]
    settings = dict(item.split('=', 1) for item in state['Config']['Env'] if '=' in item)
    port = state['NetworkSettings']['Ports']['5432/tcp'][0]['HostPort']
    url = f'postgresql://postgres@127.0.0.1:{port}/{database}?sslmode=disable'
    cli = os.environ['OPENPLAN_PROOF_SUPABASE_CLI']
    for number in (1, 2):
        result = subprocess.run([cli, 'migration', 'up', '--db-url', url, '--workdir', str(REPO / 'openplan'), '--yes'], env={**os.environ, 'PGPASSWORD': settings['POSTGRES_PASSWORD']}, text=True, capture_output=True, timeout=120)
        (output / f'migration-{number}.log').write_text(result.stdout + '\n' + result.stderr)
        if result.returncode:
            raise AssertionError('Migration CLI failed; inspect private log')
        if inventory(database) != before:
            raise AssertionError('Prepared artifact migration changed preexisting model rows')
        if sql(database, "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261016000021';") != '1':
            raise AssertionError('Prepared artifact migration history missing or duplicated')
    cases = (ROOT / 'prepared-artifact-cases.sql').read_text()
    sql(database, "BEGIN; SET LOCAL statement_timeout=10000; SET LOCAL lock_timeout=1000;\n" + cases.replace('__FIXTURE_RUN__', fixture) + '\nROLLBACK;')
    if inventory(database) != before or inventory(source['database']) != before:
        raise AssertionError('Installed cases or clone changed preexisting rows')
    if sql(source['database'], 'SELECT max(version) FROM supabase_migrations.schema_migrations;') != source_version:
        raise AssertionError('Source migration history changed')
    advisor = subprocess.run([cli, 'db', 'advisors', '--db-url', url, '--type', 'security', '--level', 'warn', '--fail-on', 'none'], env={**os.environ, 'PGPASSWORD': settings['POSTGRES_PASSWORD']}, text=True, capture_output=True, timeout=120)
    (output / 'security-advisors.log').write_text(advisor.stdout + '\n' + advisor.stderr)
    migration = REPO / 'openplan/supabase/migrations/20261016000021_model_attempt_prepared_artifact_identity.sql'
    metadata.update(status='migration applied and reapplied; retained rows and installed cases passed',
                    migration_sha256=hashlib.sha256(migration.read_bytes()).hexdigest(),
                    compared_tables=before, installed_role_and_retention_cases=True,
                    source_unchanged=True, advisor_exit_code=advisor.returncode,
                    limits='Owned populated clone and actual CLI; no normal dispatcher, application database, browser, scientific or full-host restore proof.')
    (output / 'candidate.json').write_text(json.dumps(metadata, indent=2) + '\n')
    print(json.dumps(metadata, indent=2))


if __name__ == '__main__':
    main()
