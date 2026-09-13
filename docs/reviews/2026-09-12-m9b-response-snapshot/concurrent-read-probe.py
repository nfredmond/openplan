"""Hold a calling query open while a second connection commits a response edit."""
import json
import random
import subprocess
import time
from pathlib import Path

review = Path(__file__).resolve().parent
fixture = json.loads((review / 'postgrest-probe.json').read_text())
assert fixture['stack'] == 'openplan-restore-target-2026091050'
campaign = fixture['campaign']
command = ['docker', 'exec', '-i', 'supabase_db_openplan-restore-target-2026091050',
           'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']


def sql(statement):
    return subprocess.run(command, input=statement, text=True, capture_output=True, check=True, timeout=20).stdout.strip()


def quote(value):
    return "'" + value.replace("'", "''") + "'"


original = json.loads(sql(f"SELECT json_build_object('id',id,'text',we_did) FROM engagement_closeloop_entries WHERE campaign_id={quote(campaign)}::uuid ORDER BY sort_order,created_at,id LIMIT 1;"))
lock = random.randrange(1, 2**60)
application = 'openplan_snapshot_probe_' + str(lock)
holder = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
reader = None
changed = False
try:
    holder.stdin.write(f"SET statement_timeout='15s'; SELECT pg_advisory_lock({lock});\n\\echo LOCK_HELD\n")
    holder.stdin.flush()
    while holder.stdout.readline().strip() != 'LOCK_HELD':
        assert holder.poll() is None, 'Holder ended before acquiring its lock'
    reader = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    reader.stdin.write(f"SET statement_timeout='15s'; SET application_name={quote(application)}; WITH barrier AS MATERIALIZED (SELECT pg_advisory_lock({lock})) SELECT to_jsonb(read_engagement_response_snapshot({quote(campaign)}::uuid,false)->'entries'->0->>'we_did') FROM barrier;\n")
    reader.stdin.close()
    reader.stdin = None
    deadline = time.monotonic() + 10
    while sql(f"SELECT count(*) FROM pg_stat_activity WHERE application_name={quote(application)} AND wait_event='advisory';") != '1':
        assert time.monotonic() < deadline, 'Reader did not reach the observed lock barrier'
        time.sleep(0.05)
    # The reader's calling-query snapshot already exists; its function has not run.
    sql(f"UPDATE engagement_closeloop_entries SET we_did='SYNTHETIC concurrent correction' WHERE id={quote(original['id'])}::uuid AND campaign_id={quote(campaign)}::uuid;")
    changed = True
    holder.stdin.write(f"SELECT pg_advisory_unlock({lock});\n\\q\n")
    holder.stdin.flush()
    holder.communicate(timeout=10)
    output, error = reader.communicate(timeout=20)
    assert reader.returncode == 0, error
    during = json.loads(output.strip())
    assert during == original['text'], 'An overlapping edit changed the in-flight snapshot'
    after = json.loads(sql(f"SELECT to_jsonb(read_engagement_response_snapshot({quote(campaign)}::uuid,false)->'entries'->0->>'we_did');"))
    assert after == 'SYNTHETIC concurrent correction', 'A new read did not observe the committed edit'
    (review / 'concurrent-read-probe.json').write_text(json.dumps({
        'stack': fixture['stack'], 'campaign': campaign, 'entry': original['id'],
        'readerObservedWaiting': True, 'duringRead': during, 'nextRead': after,
        'scope': 'Actual PostgreSQL calling-query snapshot with a concurrent committed edit; HTTP cap proof is separate',
    }, indent=2) + '\n')
    print('The observed in-flight read kept its original snapshot; the next read saw the committed edit.')
finally:
    # These are only the two psql processes this probe started. Statement timeout
    # also bounds the waiting reader if the probe is interrupted.
    for process in [holder, reader]:
        if process is not None and process.poll() is None:
            if process.stdin:
                process.stdin.close()
                process.stdin = None
            try:
                process.communicate(timeout=20)
            except subprocess.TimeoutExpired:
                process.terminate()
                process.communicate(timeout=5)
    if changed:
        sql(f"UPDATE engagement_closeloop_entries SET we_did={quote(original['text'])} WHERE id={quote(original['id'])}::uuid AND campaign_id={quote(campaign)}::uuid;")
        assert json.loads(sql(f"SELECT to_jsonb(we_did) FROM engagement_closeloop_entries WHERE id={quote(original['id'])}::uuid;")) == original['text']
        print('Restored the synthetic response text; its update timestamp records these test edits.')
