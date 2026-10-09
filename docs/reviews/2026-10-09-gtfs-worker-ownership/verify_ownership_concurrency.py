"""Check committed claim recovery and observed contention in an owned proof DB.

Keep the small, UUID-scoped synthetic fixtures as inspectable evidence. No live
worker, production schema function, or existing fixture is changed.
"""
import hashlib
import json
import re
import select
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parent
config = json.loads(Path(sys.argv[1]).read_text())
if (config['container'] != 'supabase_db_openplan-restore-target-2026091050'
        or not re.fullmatch(r'openplan_attempt_cli_[0-9a-f]{32}', config['database'])):
    raise SystemExit('Expected owned isolated proof database')
base = ['docker', 'exec', '-i', config['container'], 'psql', '-U', 'postgres',
        '-d', config['database'], '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
        '-v', 'VERBOSITY=verbose']
source = (root / 'ownership-prototype.sql').read_text()


def exercise(source_sql):
    schema = 'ownership_concurrent_' + uuid.uuid4().hex
    workspace, feed = [str(uuid.uuid4()) for _ in range(2)]
    prefix = f"SET search_path TO {schema},public; SET statement_timeout='10s'; "

    def sql(command):
        result = subprocess.run(base, input=prefix + command, text=True,
                                capture_output=True, timeout=15)
        if result.returncode:
            raise RuntimeError(result.stderr)
        return result.stdout.strip()

    sql('BEGIN; ' + source_sql.replace('ownership_probe', schema) + f"""
        INSERT INTO public.workspaces(id,name,slug)
        VALUES('{workspace}','Synthetic GTFS concurrent ownership','proof-{workspace}');
        INSERT INTO public.gtfs_feeds(id,workspace_id,agency_name)
        VALUES('{feed}','{workspace}','Synthetic concurrent ownership'); COMMIT;""")

    def version():
        value = str(uuid.uuid4())
        sql(f"""INSERT INTO public.gtfs_feed_versions(id,workspace_id,feed_id,source_kind,status)
            VALUES('{value}','{workspace}','{feed}','upload','pending');
            INSERT INTO gtfs_execution_probe(version_id) VALUES('{value}');""")
        return value

    def claim(v, token):
        return f"SELECT {schema}.claim_gtfs_probe('{v}','{token}');"

    def contend(hold, action, expected, rollback=False):
        app = 'ownership_wait_' + uuid.uuid4().hex
        holder = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, text=True)
        waiter = None
        try:
            holder.stdin.write(prefix + "BEGIN; SET LOCAL idle_in_transaction_session_timeout='15s'; "
                               + hold + " SELECT pg_backend_pid();\n")
            holder.stdin.flush()
            if not select.select([holder.stdout], [], [], 5)[0]:
                raise AssertionError('Holder failed to establish transaction')
            holder_pid = holder.stdout.readline().strip()
            if not holder_pid.isdigit():
                raise AssertionError('Holder did not identify its database process')
            waiter = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE, text=True)
            waiter.stdin.write(prefix + f"SET application_name='{app}'; " + action + '\n')
            waiter.stdin.close()
            waiter.stdin = None
            blocked = False
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                blocked = sql(f"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='{app}' AND wait_event_type='Lock' AND {holder_pid}=ANY(pg_blocking_pids(pid))); ") == 't'
                if blocked:
                    break
                if waiter.poll() is not None:
                    break
                time.sleep(.05)
            if not blocked:
                raise AssertionError('Expected ownership lock wait absent')
            holder.stdin.write(('ROLLBACK;' if rollback else 'COMMIT;') + '\n\\q\n')
            holder.stdin.flush()
            holder.wait(timeout=5)
            if holder.returncode:
                raise AssertionError('Holder transaction did not finish successfully')
            out, err = waiter.communicate(timeout=12)
            if expected == 'refused':
                if waiter.returncode == 0 or '55000' not in err:
                    raise AssertionError('Stale or terminal worker accepted output')
            elif expected == 'empty':
                if waiter.returncode or out.strip():
                    raise AssertionError('Competing claim did not return no ownership')
            elif expected == 'claimed':
                if waiter.returncode or json.loads(out)['active'] is not True:
                    raise AssertionError('Rolled-back claim prevented replacement')
            return {'observedLockWait': True, 'waiterExitCode': waiter.returncode}
        finally:
            if holder.poll() is None:
                try:
                    holder.stdin.write('ROLLBACK;\n\\q\n')
                    holder.stdin.flush()
                except BrokenPipeError:
                    pass
                holder.wait(timeout=17)
            if waiter is not None and waiter.poll() is None:
                waiter.communicate(timeout=15)

    # Discard the successful caller response. A new psql process recovers only
    # from the retained token, then compare with the independently read receipt.
    v = version()
    first, second = [str(uuid.uuid4()) for _ in range(2)]
    sql(claim(v, first))
    saved = json.loads(sql(f"SELECT to_jsonb(c) FROM gtfs_claim_probe c WHERE token='{first}';"))
    recovered = json.loads(sql(claim(v, first)))
    if recovered != {'claim': saved, 'active': True}:
        raise AssertionError('Committed claim was not recovered exactly')
    if sql(f"SELECT count(*) FROM gtfs_claim_probe WHERE version_id='{v}';") != '1':
        raise AssertionError('Recovery duplicated claim')
    results = {'committedReplayAcrossProcesses': True}

    # An expired owner waits behind its replacement, then must be refused.
    sql(f"UPDATE gtfs_execution_probe SET lease_until=clock_timestamp()-interval '1 second' WHERE version_id='{v}';")
    hold = f"DO $$ BEGIN PERFORM {schema}.claim_gtfs_probe('{v}','{second}'); END $$;"
    results['replacementFencesWaitingWriter'] = contend(
        hold, f"SELECT {schema}.write_gtfs_probe('{v}','{first}','stale');", 'refused')
    if sql(f"SELECT count(*) FROM gtfs_write_probe WHERE version_id='{v}';") != '0':
        raise AssertionError('Stale output remained')

    # A terminal-state transition and a writer must share the version lock.
    v = version()
    token = str(uuid.uuid4())
    sql(claim(v, token))
    results['terminalTransitionFencesWaitingWriter'] = contend(
        f"UPDATE public.gtfs_feed_versions SET status='failed',failure_code='partial_write' WHERE id='{v}';",
        f"SELECT {schema}.write_gtfs_probe('{v}','{token}','terminal');", 'refused')

    for rollback in (False, True):
        v = version()
        first, second = [str(uuid.uuid4()) for _ in range(2)]
        held = f"DO $$ BEGIN PERFORM {schema}.claim_gtfs_probe('{v}','{first}'); END $$;"
        results['competingClaimRollback' if rollback else 'competingClaimCommit'] = contend(
            held, claim(v, second), 'claimed' if rollback else 'empty', rollback)
        expected = second if rollback else first
        state = json.loads(sql(f"SELECT json_build_object('token',token,'attempt',attempt) FROM gtfs_execution_probe WHERE version_id='{v}';"))
        if state != {'token': expected, 'attempt': 1}:
            raise AssertionError('Competing claim changed attempt identity')
    return {'schema': schema, 'workspace': workspace, 'results': results}


cases = [
    ('baseline', source, None),
    ('harmless', source + '\n-- harmless comment\n', None),
    ('missing-version-lock', source.replace('WHERE id=p_version FOR UPDATE;', 'WHERE id=p_version;'),
     'Expected ownership lock wait absent'),
    ('missing-owner-check', source.replace('AND j.token=p_token AND j.lease_until', 'AND j.lease_until'),
     'Stale or terminal worker accepted output'),
    ('restored', source, None),
]
results = []
for name, candidate, reason in cases:
    try:
        proof = exercise(candidate)
    except AssertionError as error:
        if reason is None or str(error) != reason:
            raise
        results.append({'case': name, 'expectedFailure': str(error)})
    else:
        if reason:
            raise AssertionError('Mutation survived: ' + name)
        results.append({'case': name, **proof})
print(json.dumps({'recordedAt': datetime.now(timezone.utc).isoformat(),
                  'sourceSha256': hashlib.sha256(source.encode()).hexdigest(),
                  'cases': results}, indent=2))
