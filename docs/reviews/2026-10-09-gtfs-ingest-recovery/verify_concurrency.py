"""Exercise the actual GTFS row-lock boundary with separate PostgreSQL sessions."""
import argparse
import json
from pathlib import Path
import re
import select
import subprocess
import time
import uuid

parser = argparse.ArgumentParser()
parser.add_argument('config', type=Path)
args = parser.parse_args()
config = json.loads(args.config.read_text())
if not re.fullmatch(r'openplan_gtfs_recovery_[0-9a-f]{32}', config['database']):
    raise SystemExit('Expected isolated GTFS recovery database')
base = ['docker', 'exec', '-i', config['container'], 'psql', '-U', 'postgres', '-d', config['database'],
        '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']
def sql(text):
    r = subprocess.run(base, input=text, text=True, capture_output=True, timeout=15)
    if r.returncode:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()

def run_case(name, completion=False, rollback=False, stage=False):
    workspace, feed, version = [str(uuid.uuid4()) for _ in range(3)]
    application = 'gtfs_proof_' + uuid.uuid4().hex
    sql(f"""INSERT INTO workspaces(id,name,slug) VALUES('{workspace}','Synthetic concurrency','proof-{workspace}');
    INSERT INTO gtfs_feeds(id,workspace_id,agency_name) VALUES('{feed}','{workspace}','Synthetic concurrency');
    INSERT INTO gtfs_feed_versions(id,workspace_id,feed_id,source_kind,status,updated_at)
    VALUES('{version}','{workspace}','{feed}','upload','parsing',now()-interval '20 minutes');""")
    route = f"""INSERT INTO gtfs_route_service_levels(workspace_id,feed_version_id,route_id,route_type,service_day,trips_per_day,derivation_method)
    VALUES('{workspace}','{version}','R',3,'monday',1,'scheduled');"""
    stop = f"""INSERT INTO gtfs_stop_service_levels(workspace_id,feed_version_id,stop_id,stop_name,latitude,longitude,service_day,trips_per_day,derivation_method)
    VALUES('{workspace}','{version}','S','Synthetic stop',44,-104,'monday',1,'scheduled');"""
    reap = f"SELECT reap_gtfs_feed_version('{version}',now()-interval '15 minutes');"
    if completion:
        hold = route + stop + f"""UPDATE gtfs_feed_versions SET status='ready',route_count=1,stop_count=1,
        route_service_level_rows=1,stop_service_level_rows=1 WHERE id='{version}';
        DO $$ BEGIN PERFORM promote_gtfs_feed_version('{version}'); END $$;"""
        action = reap
    else:
        hold = f"DO $$ BEGIN IF NOT reap_gtfs_feed_version('{version}',now()-interval '15 minutes') THEN RAISE EXCEPTION 'not reaped'; END IF; END $$;"
        action = f"UPDATE gtfs_feed_versions SET status='parsing' WHERE id='{version}';" if stage else route
    holder = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    waiter = None
    try:
        holder.stdin.write("BEGIN; SET LOCAL idle_in_transaction_session_timeout='15s'; " + hold + " SELECT 'held';\n")
        holder.stdin.flush()
        if not select.select([holder.stdout], [], [], 5)[0] or holder.stdout.readline().strip() != 'held':
            raise RuntimeError('Holder did not acquire its lock')
        waiter = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        waiter.stdin.write(f"SET application_name='{application}'; SET statement_timeout='10s'; " + action + '\n')
        waiter.stdin.close()
        waiter.stdin = None
        deadline = time.monotonic() + 5
        blocked = False
        while time.monotonic() < deadline:
            blocked = sql(f"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='{application}' AND wait_event_type='Lock');") == 't'
            if blocked:
                break
            if waiter.poll() is not None:
                raise RuntimeError('Waiter finished without taking the expected lock')
            time.sleep(.05)
        if not blocked:
            raise RuntimeError('No actual lock wait observed')
        holder.stdin.write(('ROLLBACK;' if rollback else 'COMMIT;') + '\n\\q\n')
        holder.stdin.flush()
        holder.wait(timeout=5)
        stdout, stderr = waiter.communicate(timeout=10)
        if completion:
            assert waiter.returncode == 0 and stdout.strip() == 'f', (stdout, stderr)
        elif rollback:
            assert waiter.returncode == 0, stderr
        else:
            assert waiter.returncode != 0 and '55000' in stderr and 'abandoned' in stderr, (stdout, stderr)
        state = json.loads(sql(f"""SELECT json_build_object('status',status,'fenced',ingest_abandoned_at IS NOT NULL,
        'routeRows',(SELECT count(*) FROM gtfs_route_service_levels WHERE feed_version_id='{version}'))
        FROM gtfs_feed_versions WHERE id='{version}';"""))
        expected = {'status': 'ready', 'fenced': False, 'routeRows': 1} if completion else (
            {'status': 'parsing', 'fenced': False, 'routeRows': 1} if rollback else {'status': 'failed', 'fenced': True, 'routeRows': 0})
        assert state == expected, state
        return {'case': name, 'observedLockWait': blocked, 'waiterReturnCode': waiter.returncode, 'state': state}
    finally:
        if holder.poll() is None:
            try:
                holder.stdin.write('ROLLBACK;\n\\q\n'); holder.stdin.flush(); holder.wait(timeout=5)
            except (BrokenPipeError, subprocess.TimeoutExpired):
                holder.terminate(); holder.wait(timeout=5)
        if waiter is not None and waiter.poll() is None:
            waiter.wait(timeout=15)

print(json.dumps([run_case('completion_wins', completion=True), run_case('cleanup_blocks_derived'),
                  run_case('cleanup_blocks_stage', stage=True), run_case('cleanup_rollback', rollback=True)], indent=2))
