"""Read-only native URI replay. Credentials travel through stdin, never argv."""
import json
import os
from pathlib import Path
import subprocess
from urllib.parse import urlsplit, urlunsplit

ROOT = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-geography-preview-final-20261015')
PRIVATE = ROOT / 'rest-uri-recovery-01'
DB = 'a4181e334bb0da63e213aaea5966d163e24faab58ddb3e6122665b3c41042cce'
TARGET = 'openplan_project_combined_preview_0752bc2e8104b7a40faab27f'


def main():
    os.umask(0o077)
    evidence = PRIVATE / 'native-run-02'
    evidence.mkdir(mode=0o700)
    original = json.loads((ROOT / 'envs-private.json').read_text())['rest']['PGRST_DB_URI']
    fixed = json.loads((PRIVATE / 'envs-v1-private.json').read_text())['rest']['PGRST_DB_URI']
    u = urlsplit(fixed)
    assert u.path[1:] == TARGET and u.username == 'authenticator'
    assert urlsplit(original)._replace(query='') == u._replace(query='')
    cases = [('old-plus', original, False), ('corrected-percent-space', fixed, True),
             ('harmless-lowercase-hex', urlunsplit(u._replace(query=u.query.replace('%3D', '%3d').replace('%2C', '%2c'))), True),
             ('encoded-literal-plus', urlunsplit(u._replace(query=u.query.replace('%20', '%2B'))), False),
             ('restored-old-plus', original, False)]
    sql = "BEGIN READ ONLY; SELECT jsonb_build_object('database',current_database(),'user',current_user,'readonly',current_setting('transaction_read_only'),'searchPath',current_setting('search_path'),'projects',to_regclass('public.projects')); COMMIT;\n"
    args = ['docker', 'exec', '-i', '-e', 'PGCONNECT_TIMEOUT=5',
            '-e', 'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=10000',
            DB, 'psql', '-XqAt', '-U', 'supabase_admin', '-d', TARGET, '-v', 'ON_ERROR_STOP=1']
    rows = []
    for label, uri, success in cases:
        assert "'" not in uri and '\n' not in uri and '\r' not in uri
        # Initial connection is readonly to the same target. psql's native
        # reconnect expands the complete URI from stdin without credential argv.
        result = subprocess.run(args, input=("\\connect -reuse-previous=off '" + uri + "'\n" + sql).encode(), capture_output=True, timeout=15)
        with (evidence / (label + '-native-private.json')).open('x') as stream:
            json.dump({'returncode': result.returncode, 'stdout': result.stdout.decode(errors='replace'),
                       'stderr': result.stderr.decode(errors='replace')}, stream, indent=2)
        if success:
            observed = json.loads(result.stdout)
            assert result.returncode == 0 and observed == {'database': TARGET, 'user': 'authenticator',
                'readonly': 'on', 'searchPath': 'public,extensions', 'projects': 'projects'}
            rows.append({'case': label, 'returncode': 0, 'observed': observed})
        else:
            expected = b'unrecognized configuration parameter "+search_path"' in result.stderr
            assert result.returncode != 0 and expected
            rows.append({'case': label, 'returncode': result.returncode, 'expectedPlusSearchPathError': expected})
    report = {'cases': rows, 'credentialArgv': False, 'targetOnly': True,
              'restReady': False, 'scope': 'Native libpq parsing and read-only connection, not HTTP readiness.'}
    with (evidence / 'native-summary.json').open('x') as stream:
        json.dump(report, stream, indent=2)
    print(json.dumps(report))


if __name__ == '__main__':
    main()
