"""Native member-read checks on a fresh populated clone; no Auth or browser claim."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[4]
MIGRATION = ROOT / 'openplan/supabase/migrations/20261016000024_model_attempt_instrument_member_read.sql'


def main():
    source = json.loads(Path(os.environ['OPENPLAN_INSTRUMENT_READ_SOURCE']).read_text())
    container = source['container']
    source_db = source['database']
    assert container == 'supabase_db_openplan-restore-target-2026091050'
    assert re.fullmatch(r'openplan_attempt_cli_[0-9a-f]{32}', source_db)
    output = Path(os.environ['OPENPLAN_INSTRUMENT_READ_OUTPUT'])
    output.mkdir(mode=0o700, parents=True, exist_ok=False)

    def execute(database, statement):
        return subprocess.run(['docker', 'exec', '-i', container, 'psql', '-X', '-qAt',
            '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1'], input=statement,
            capture_output=True, text=True, timeout=60)

    def sql(database, statement):
        result = execute(database, statement)
        if result.returncode:
            raise RuntimeError(result.stderr)
        return result.stdout.strip()

    assert sql('postgres', f"SELECT count(*) FROM pg_stat_activity WHERE datname='{source_db}'") == '0'
    database = 'openplan_instrument_read_' + uuid.uuid4().hex
    sql('postgres', f'CREATE DATABASE {database} TEMPLATE {source_db}')
    (output/'candidate.json').write_text(json.dumps({'database': database, 'container': container,
        'source_database': source_db}, indent=2)+'\n')
    snapshot = "SELECT md5(coalesce(jsonb_agg(to_jsonb(i) ORDER BY id)::text,'')) FROM public.model_attempt_instrument_custody i"
    before = sql(database, snapshot)
    migration = MIGRATION.read_text()
    sql(database, migration)
    assert before == sql(database, snapshot), 'Migration changed retained custody'
    scope = json.loads(sql(database, "SELECT jsonb_build_object('workspace',i.workspace_id,'member',m.user_id,'run',i.model_run_id) FROM public.model_attempt_instrument_custody i JOIN public.workspace_members m USING (workspace_id) LIMIT 1"))
    workspace, member, run = (str(uuid.UUID(scope[key])) for key in ('workspace', 'member', 'run'))
    # Use a new viewer so removal does not violate the unrelated last-owner guard.
    member = str(uuid.uuid4())
    sql(database, f"INSERT INTO auth.users (id,email) VALUES ('{member}','instrument-read-{member}@example.test'); INSERT INTO public.workspace_members (workspace_id,user_id,role) VALUES ('{workspace}','{member}','viewer');")
    outsider = str(uuid.uuid4())
    other_workspace = str(uuid.uuid4())
    sql(database, f"INSERT INTO auth.users (id,email) VALUES ('{outsider}','instrument-outsider-{outsider}@example.test'); INSERT INTO public.workspaces (id,name,slug) VALUES ('{other_workspace}','Instrument read isolation','instrument-read-{other_workspace}'); INSERT INTO public.workspace_members (workspace_id,user_id,role) VALUES ('{other_workspace}','{outsider}','owner');")
    expected = int(sql(database, f"SELECT count(*) FROM public.model_attempt_instrument_custody WHERE workspace_id='{workspace}'"))
    assert expected >= 2

    def as_user(user, body):
        return f"SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='{user}'; {body} RESET ROLE;"

    def count_check(expected_count, reason):
        return f"DO $$ BEGIN IF (SELECT count(*) FROM public.model_attempt_instrument_custody WHERE workspace_id='{workspace}') <> {expected_count} THEN RAISE EXCEPTION '{reason}'; END IF; END $$;"

    member_check = as_user(member, count_check(expected, 'member records missing') + f"""
        DO $$ BEGIN IF (SELECT count(DISTINCT demand_method) FROM public.model_attempt_instrument_custody WHERE model_run_id='{run}') <> 2 THEN RAISE EXCEPTION 'method lost'; END IF; END $$;
    """)
    outsider_check = as_user(outsider, count_check(0, 'outsider rows exposed'))
    permissions = """
    DO $$ DECLARE r text; p text; BEGIN
      FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
        FOREACH p IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
          IF has_table_privilege(r,'public.model_attempt_instrument_custody',p) THEN
            RAISE EXCEPTION 'direct write exposed'; END IF;
        END LOOP;
        IF has_table_privilege(r,'public.model_attempt_instrument_receipts','SELECT') THEN
          RAISE EXCEPTION 'receipt exposed'; END IF;
      END LOOP;
      IF has_table_privilege('anon','public.model_attempt_instrument_custody','SELECT') OR
         has_table_privilege('service_role','public.model_attempt_instrument_custody','SELECT') THEN
        RAISE EXCEPTION 'nonmember role grant exposed'; END IF;
    END $$;
    """
    removed = f"DELETE FROM public.workspace_members WHERE workspace_id='{workspace}' AND user_id='{member}';" + as_user(member, count_check(0, 'removed member rows exposed'))
    hidden_parent = 'CREATE POLICY instrument_proof_hidden_parent ON public.model_runs AS RESTRICTIVE FOR SELECT TO authenticated USING (false);' + as_user(member, count_check(0, 'hidden parent rows exposed'))
    # Each case rolls back, including failed psql sessions. Production SQL is never mutated on disk.
    cases = [
        ('normal', '', member_check + outsider_check + permissions, None),
        ('harmless', '-- whitespace/comment control\n', member_check + outsider_check + permissions, None),
        ('removed-membership', '', removed, None),
        ('hidden-parent', '', hidden_parent, None),
        ('fault-open-policy', 'ALTER POLICY model_attempt_instrument_member_read ON public.model_attempt_instrument_custody USING (true);', outsider_check, 'outsider rows exposed'),
        ('fault-deny-member', 'ALTER POLICY model_attempt_instrument_member_read ON public.model_attempt_instrument_custody USING (false);', member_check, 'member records missing'),
        ('fault-write-grant', 'GRANT INSERT ON public.model_attempt_instrument_custody TO authenticated;', permissions, 'direct write exposed'),
        ('fault-receipt-grant', 'GRANT SELECT ON public.model_attempt_instrument_receipts TO authenticated;', permissions, 'receipt exposed'),
        ('fault-no-parent', f"ALTER POLICY model_attempt_instrument_member_read ON public.model_attempt_instrument_custody USING (EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=model_attempt_instrument_custody.workspace_id AND m.user_id=auth.uid()));", hidden_parent, 'hidden parent rows exposed'),
        ('restored', '', member_check + outsider_check + permissions, None),
    ]
    results = []
    for name, mutation, check, failure in cases:
        result = execute(database, 'BEGIN;\n' + mutation + '\n' + check + '\nROLLBACK;')
        if failure:
            assert result.returncode != 0 and failure in result.stderr, (name, result.stderr)
        else:
            assert result.returncode == 0, (name, result.stderr)
        results.append({'case': name, 'expected_failure': failure, 'passed': True})
    for name, role, statement in [
        ('anonymous-read', 'anon', 'SELECT * FROM public.model_attempt_instrument_custody'),
        ('service-direct-read', 'service_role', 'SELECT * FROM public.model_attempt_instrument_custody'),
        ('member-receipt-read', 'authenticated', 'SELECT * FROM public.model_attempt_instrument_receipts'),
        ('member-insert', 'authenticated', 'INSERT INTO public.model_attempt_instrument_custody DEFAULT VALUES'),
        ('member-update', 'authenticated', "UPDATE public.model_attempt_instrument_custody SET scientific_outcome='inconclusive'"),
        ('member-delete', 'authenticated', 'DELETE FROM public.model_attempt_instrument_custody'),
    ]:
        result = execute(database, f"BEGIN; SET LOCAL ROLE {role}; SET LOCAL request.jwt.claim.sub='{member}'; {statement}; ROLLBACK;")
        assert result.returncode != 0 and 'permission denied for table' in result.stderr, (name, result.stderr)
        results.append({'case': name, 'expected_failure': 'permission denied for table', 'passed': True})
    assert before == sql(database, snapshot), 'Checks changed retained custody'
    report = {'migration_sha256': hashlib.sha256(migration.encode()).hexdigest(),
        'retained_records': expected, 'custody_unchanged': True, 'cases': results,
        'limits': 'Native Postgres roles and JWT sub settings on synthetic retained records. No Auth token issuance, REST, application exports, browser, source completeness or scientific acceptance.'}
    (output/'result.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
