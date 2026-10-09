"""Observe real-table batch/replacement contention in the owned proof database.

Committed synthetic fixtures remain inspectable. Only this run's UUID-named
triggers are removed, in finally, after both owned clients finish.
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
        '-d', config['database'], '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']
ownership = (root / 'ownership-prototype.sql').read_text()
fence = (root / 'write-fence-prototype.sql').read_text()
prepare = (root / 'prepare-prototype.sql').read_text()
batch = (root / 'batch-prototype.sql').read_text()
changes = [
    (" IF p_kind='route' THEN", " INSERT INTO ownership_probe.write_context(transaction_id,version_id,token,kind) VALUES(txid_current(),p_version,p_token,p_kind);\n IF p_kind='route' THEN"),
    (' GET DIAGNOSTICS written=ROW_COUNT;', ' GET DIAGNOSTICS written=ROW_COUNT;\n DELETE FROM ownership_probe.write_context WHERE transaction_id=txid_current() AND version_id=p_version AND kind=p_kind;'),
    (' SELECT * INTO v FROM public.gtfs_feed_versions WHERE id=p_version;', " IF NOT EXISTS(SELECT 1 FROM ownership_probe.gtfs_execution_probe WHERE version_id=p_version AND prepared_token=p_token) THEN RAISE EXCEPTION 'GTFS attempt not prepared' USING ERRCODE='55000'; END IF;\n SELECT * INTO v FROM public.gtfs_feed_versions WHERE id=p_version;"),
]
for old, new in changes:
    if batch.count(old) != 1:
        raise AssertionError('Batch composition target must occur exactly once')
    batch = batch.replace(old, new)


def exercise(preparation, replacement_first):
    schema = 'ownership_overlap_' + uuid.uuid4().hex
    workspace, feed, version, old_token, new_token = [str(uuid.uuid4()) for _ in range(5)]
    prefix = f"SET search_path={schema},public; SET statement_timeout='10s'; "

    def sql(command):
        result = subprocess.run(base, input=prefix + command, capture_output=True, text=True, timeout=15)
        if result.returncode:
            raise RuntimeError(result.stderr)
        return result.stdout.strip()

    def batch_call(token, route):
        payload = json.dumps([{'workspace_id': workspace, 'feed_version_id': version,
            'route_id': route, 'route_type': 3, 'service_day': 'monday', 'trips_per_day': 1,
            'stops_served': 1, 'derivation_method': 'scheduled', 'scheduled_trips': 1,
            'frequency_trips': 0, 'peak_headway_is_lower_bound': True,
            'median_headway_basis': 'not_determined_too_few_departures', 'departures_beyond_bin_range': 0}])
        return f"PERFORM {schema}.write_batch_probe('{version}','{token}','{uuid.uuid4()}','route',0,'{payload}'::jsonb);"

    replacement = (f"PERFORM {schema}.claim_gtfs_probe('{version}','{new_token}'); "
                   f"PERFORM {schema}.prepare_probe('{version}','{new_token}'); " + batch_call(new_token, 'replacement'))
    old_batch = batch_call(old_token, 'old')
    expiry = f"UPDATE {schema}.gtfs_execution_probe SET lease_until=clock_timestamp()-interval '1 second' WHERE version_id='{version}';"
    holder = waiter = None
    installed = False
    try:
        setup = ('BEGIN; ' + ownership + fence + batch + preparation).replace('ownership_probe', schema)
        setup += f"""
        INSERT INTO public.workspaces(id,name,slug) VALUES('{workspace}','Synthetic replacement overlap','proof-{workspace}');
        INSERT INTO public.gtfs_feeds(id,workspace_id,agency_name) VALUES('{feed}','{workspace}','Synthetic replacement overlap');
        INSERT INTO public.gtfs_feed_versions(id,workspace_id,feed_id,source_kind,status)
        VALUES('{version}','{workspace}','{feed}','upload','pending');
        INSERT INTO {schema}.gtfs_execution_probe(version_id) VALUES('{version}');
        DO $$ BEGIN PERFORM {schema}.claim_gtfs_probe('{version}','{old_token}');
        PERFORM {schema}.prepare_probe('{version}','{old_token}'); END $$; COMMIT;"""
        sql(setup)
        installed = True
        if replacement_first:
            sql(expiry)
            hold = 'DO $$ BEGIN ' + replacement + ' END $$;'
            action = 'SET ROLE service_role; DO $$ BEGIN ' + old_batch + ' END $$;'
        else:
            hold = 'SET LOCAL ROLE service_role; DO $$ BEGIN ' + old_batch + ' END $$; RESET ROLE; ' + expiry
            action = 'DO $$ BEGIN ' + replacement + ' END $$;'
        holder = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        holder.stdin.write(prefix + "BEGIN; SET LOCAL idle_in_transaction_session_timeout='15s'; " + hold + ' SELECT pg_backend_pid();\n')
        holder.stdin.flush()
        if not select.select([holder.stdout], [], [], 5)[0]:
            raise AssertionError('Holder did not establish transaction')
        pid = holder.stdout.readline().strip()
        if not pid.isdigit():
            raise AssertionError('Holder process identity missing')
        app = 'replacement_wait_' + uuid.uuid4().hex
        waiter = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        waiter.stdin.write(prefix + f"SET application_name='{app}'; " + action + '\n')
        waiter.stdin.close()
        waiter.stdin = None
        blocked = False
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            blocked = sql(f"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='{app}' AND wait_event_type='Lock' AND {pid}=ANY(pg_blocking_pids(pid)));") == 't'
            if blocked or waiter.poll() is not None:
                break
            time.sleep(.05)
        if not blocked:
            raise AssertionError('Expected replacement/batch contention absent')
        holder.stdin.write('COMMIT;\n\\q\n')
        holder.stdin.flush()
        holder.wait(timeout=5)
        if holder.returncode:
            raise AssertionError('Holder failed to commit')
        stdout, stderr = waiter.communicate(timeout=12)
        if replacement_first:
            if waiter.returncode == 0 or '55000' not in stderr or 'no longer owns batch' not in stderr:
                raise AssertionError('Old batch accepted after replacement')
        elif waiter.returncode:
            raise AssertionError('Replacement failed after old batch commit: ' + stderr)
        state = json.loads(sql(f"""SELECT json_build_object(
          'routeIds',(SELECT json_agg(route_id ORDER BY route_id) FROM public.gtfs_route_service_levels WHERE feed_version_id='{version}'),
          'batchReceipts',(SELECT count(*) FROM {schema}.batch_receipt),
          'prepareReceipts',(SELECT count(*) FROM {schema}.prepare_receipt),
          'contexts',(SELECT count(*) FROM {schema}.write_context));"""))
        expected = {'routeIds': ['replacement'], 'batchReceipts': 1 if replacement_first else 2,
                    'prepareReceipts': 2, 'contexts': 0}
        if state != expected:
            raise AssertionError('Replacement output mixed or history lost')
        return {'schema': schema, 'workspace': workspace, 'version': version,
                'replacementFirst': replacement_first, 'observedHolderLockWait': True,
                'waiterExitCode': waiter.returncode, 'state': state}
    finally:
        if holder is not None and holder.poll() is None:
            try:
                holder.stdin.write('ROLLBACK;\n\\q\n')
                holder.stdin.flush()
            except BrokenPipeError:
                pass
            holder.wait(timeout=17)
        if waiter is not None and waiter.poll() is None:
            waiter.communicate(timeout=15)
        if installed:
            # Drop only exact trigger names created above, never a pre-existing object.
            for suffix, table in [('route', 'gtfs_route_service_levels'), ('stop', 'gtfs_stop_service_levels'),
                                  ('tract', 'gtfs_tract_service'), ('version', 'gtfs_feed_versions')]:
                sql(f"DROP TRIGGER {schema}_{suffix} ON public.{table};")
            if sql(f"SELECT count(*) FROM pg_trigger WHERE tgname LIKE '{schema}%';") != '0':
                raise AssertionError('Experiment trigger survived cleanup')


cases = [('baseline', prepare, None), ('harmless', prepare + '\n-- harmless comment\n', None),
         ('missing-route-cleanup', prepare.replace('DELETE FROM public.gtfs_route_service_levels WHERE feed_version_id=p_version;', 'PERFORM 1;'),
          'Replacement output mixed or history lost'), ('restored', prepare, None)]
results = []
for name, candidate, reason in cases:
    try:
        proofs = [exercise(candidate, False), exercise(candidate, True)]
    except AssertionError as error:
        if reason is None or str(error) != reason:
            raise
        results.append({'case': name, 'expectedFailure': str(error)})
    else:
        if reason:
            raise AssertionError('Mutation survived: ' + name)
        results.append({'case': name, 'proofs': proofs, 'experimentTriggersRemoved': True})
print(json.dumps({'recordedAt': datetime.now(timezone.utc).isoformat(),
                  'combinedSourceSha256': hashlib.sha256((ownership + fence + batch + prepare).encode()).hexdigest(),
                  'cases': results}, indent=2))
