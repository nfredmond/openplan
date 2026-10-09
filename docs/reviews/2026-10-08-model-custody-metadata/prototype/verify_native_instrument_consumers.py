"""Real application readers against member-scoped native PostgREST in an owned clone."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import uuid
from isolated_postgrest import gateway

ROOT = Path(__file__).resolve().parents[4]


def main():
    source = json.loads(Path(os.environ['OPENPLAN_NATIVE_CONSUMER_SOURCE']).read_text())
    assert source['container'] == 'supabase_db_openplan-restore-target-2026091050'
    assert re.fullmatch(r'openplan_instrument_read_[0-9a-f]{32}', source['database'])
    output = Path(os.environ['OPENPLAN_NATIVE_CONSUMER_OUTPUT'])
    output.mkdir(mode=0o700, parents=True, exist_ok=False)

    def sql(database, statement):
        result = subprocess.run(['docker','exec','-i',source['container'],'psql','-X','-qAt','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1'],input=statement,capture_output=True,text=True,timeout=60)
        if result.returncode: raise RuntimeError(result.stderr)
        return result.stdout.strip()

    for invalid in (0, -1, True, 1001, '2'):
        try:
            with gateway('invalid-schema', max_rows=invalid): pass
            raise AssertionError('Invalid row cap accepted')
        except ValueError as error:
            assert 'Proof row cap' in str(error)
    assert sql('postgres', f"SELECT count(*) FROM pg_stat_activity WHERE datname='{source['database']}'") == '0'
    database = 'openplan_attempt_cli_' + uuid.uuid4().hex
    sql('postgres', f'CREATE DATABASE {database} TEMPLATE {source["database"]}')
    (output/'candidate.json').write_text(json.dumps({'database':database,'container':source['container'],'source_database':source['database']},indent=2)+'\n')
    records_sql = "SELECT jsonb_agg(to_jsonb(i) ORDER BY created_at,id) FROM public.model_attempt_instrument_custody i"
    records = json.loads(sql(database, records_sql))
    assert len(records) > 2
    workspace = str(uuid.UUID(records[0]['workspace_id']))
    assert {row['workspace_id'] for row in records} == {workspace}
    member = str(uuid.UUID(sql(database, f"SELECT m.user_id FROM public.workspace_members m JOIN auth.users u ON u.id=m.user_id WHERE m.workspace_id='{workspace}' AND m.role='viewer' AND u.email LIKE 'instrument-read-%@example.test'")))
    outsider = str(uuid.UUID(sql(database, "SELECT id FROM auth.users WHERE email LIKE 'instrument-outsider-%@example.test'")))
    runs = json.loads(sql(database, "SELECT jsonb_agg(jsonb_build_object('id',id,'run_title',run_title,'engine_key',engine_key,'status',status) ORDER BY id) FROM public.model_runs WHERE id IN (SELECT model_run_id FROM public.model_attempt_instrument_custody)"))
    results = []

    def invoke(service, mode, *, fault=None, expected_failure=None):
        payload = {'url':service['url'],'memberToken':service['authenticated_tokens'][member],
            'outsiderToken':service['authenticated_tokens'][outsider],'anonToken':service['anon_token'],
            'workspaceId':workspace,'records':records,'runs':runs,'mode':mode}
        if fault == 'wrong-member': payload['memberToken'] = payload['outsiderToken']
        if mode == 'harmless': payload['irrelevantNote'] = 'Harmless input metadata.'
        result = subprocess.run(['node','--import','tsx','scripts/ops/verify-attempt-instrument-native-read.ts'],cwd=ROOT/'openplan',input=json.dumps(payload),capture_output=True,text=True,timeout=90)
        if expected_failure:
            assert result.returncode != 0 and expected_failure in result.stderr, result.stderr
            results.append({'case':fault or mode,'expected_failure':expected_failure,'passed':True})
        else:
            assert result.returncode == 0, result.stderr
            results.append(json.loads(result.stdout))

    with gateway('public', database=database, subjects=(member,outsider), max_rows=2) as service:
        invoke(service,'normal')
        invoke(service,'harmless')
        invoke(service,'normal',fault='wrong-member',expected_failure='member custody differs')
        invoke(service,'page-loss')
    with gateway('public', database=database, subjects=(member,outsider)) as service:
        invoke(service,'normal',fault='omitted-native-cap',expected_failure='native two-row cap not exercised')
    with gateway('public', database=database, subjects=(member,outsider), max_rows=2) as service:
        invoke(service,'normal')
        sql(database, f"DELETE FROM public.workspace_members WHERE workspace_id='{workspace}' AND user_id='{member}'")
        invoke(service,'withdrawn')
    assert json.loads(sql(database, records_sql)) == records, 'Retained custody changed'
    report = {'cases':results,'invalid_row_caps_refused':5,'retained_custody_unchanged':True,
        'typescript_sha256':hashlib.sha256((ROOT/'openplan/scripts/ops/verify-attempt-instrument-native-read.ts').read_bytes()).hexdigest(),
        'limits':'Real Supabase client, application reader/report resolver and native PostgREST with locally signed test JWTs. No Auth sign-in, application freeze/download, browser rendering, source completeness or scientific acceptance.'}
    (output/'result.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__ == '__main__': main()
