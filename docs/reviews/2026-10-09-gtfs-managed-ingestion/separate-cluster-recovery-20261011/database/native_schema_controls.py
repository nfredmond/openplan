"""Rollback-only policy and default-privilege controls on the exact new cluster."""
import json, os, subprocess, time
from pathlib import Path
import run_database as r
import schema_semantics as s
import resume_guards as guards

OUT = Path(__file__).parent


def main():
    os.umask(0o077); started = time.monotonic()
    receipt = json.loads((OUT / 'container-receipt.json').read_text())
    info = json.loads(subprocess.check_output(['docker', 'inspect', receipt['id']]))[0]
    r.g.verify_container(info, receipt, r.VOLUME, OUT / 'mounted-root-private.key')
    target = json.loads((OUT / 'database-continuation-02-result.json').read_text())['targetDatabase']
    source = json.loads((OUT / 'source-catalog-private.json').read_text())
    expected_text = (OUT / 'source-continuation-schema-private.log').read_text()
    actual_text = (OUT / 'target-continuation-schema-private.log').read_text()
    records = []
    cases = [
        ('baseline', '', None),
        ('harmless policy role ordering', 'ALTER POLICY equity_tract_designations_select ON public.equity_tract_designations TO authenticated, anon;', None),
        ('changed native predicate', 'ALTER POLICY equity_tract_designations_select ON public.equity_tract_designations USING (false);', 'schema-policy-catalog'),
        ('changed native policy role', 'ALTER POLICY equity_tract_designations_select ON public.equity_tract_designations TO service_role;', 'schema-policy-catalog'),
        ('changed native default privilege', 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE SELECT ON TABLES FROM anon;', 'schema-default-catalog'),
        ('restored', '', None),
    ]
    for label, mutation, expected in cases:
        # The same psql session observes its transaction before explicit rollback.
        # Session closure also rolls back if a native command fails.
        query = "BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='30s'; " + mutation + s.CATALOG_QUERY + '; ROLLBACK;'
        result = subprocess.run(['docker', 'exec', '-i', receipt['id'], 'psql', '-XqAt', '-U', r.g.ADMIN, '-d', target, '-v', 'ON_ERROR_STOP=1'], input=query.encode(), capture_output=True, timeout=45)
        (OUT / ('native-control-' + str(len(records)) + '-private.log')).write_bytes(result.stdout + result.stderr)
        result.check_returncode(); actual = json.loads(result.stdout)
        failure = None
        try: s.verify(expected_text, actual_text, source, actual)
        except ValueError as error: failure = str(error)
        guards.native_control_reason(failure, expected)
        records.append({'case': label, 'nativeExitCode': result.returncode, 'result': 'intended refusal' if failure else 'survived', 'reason': failure, 'transaction': 'rolled back'})
    after = json.loads(r.archive.sql(receipt['id'], s.CATALOG_QUERY, target))
    s.verify(expected_text, actual_text, source, after)
    (OUT / 'native-schema-controls.json').write_text(json.dumps({'cases': records, 'catalogPreservedAfterRollback': True, 'wallSeconds': round(time.monotonic()-started,3), 'scope': 'Exact new isolated cluster, transactional metadata only. Original producer and source database unchanged. No API or browser acceptance.'}, indent=2)+'\n')
    print(len(records), 'native schema controls pass; catalog preserved')


if __name__ == '__main__': main()
