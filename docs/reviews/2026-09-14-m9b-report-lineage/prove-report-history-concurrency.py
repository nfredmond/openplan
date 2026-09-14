"""Exercise real queue/link locks on the disconnected report-history database."""
import hashlib
import json
import os
from pathlib import Path
import re
import select
import subprocess
import time
import uuid

root = Path(__file__).resolve().parents[3]
app = root / 'openplan'
container = 'supabase_db_openplan-restore-target-2026091050'
database = 'openplan_report_history_concurrency_20260914'
out = Path(os.environ['OPENPLAN_REPORT_HISTORY_CONCURRENCY_EVIDENCE'])
out.mkdir(parents=True, exist_ok=True)
base = ['docker', 'exec', '-i', container, 'psql', '-U', 'supabase_admin', '-d', database, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']
migration = (app / 'supabase/migrations/20261014000024_engagement_report_decision_history.sql').read_text()
queue_function = migration[migration.index('CREATE OR REPLACE FUNCTION'):]
link_migration = (app / 'supabase/migrations/20261014000022_engagement_decision_request_resolution.sql').read_text()
link_function = link_migration[link_migration.index('CREATE OR REPLACE FUNCTION public.write_engagement_response_decision_link'):]
fixture = (app / 'src/test/fixtures/engagement/decision-link-activation.sql').read_text().split("SELECT set_config('request.jwt.claim.sub'")[0]


def query(sql, check=True):
    result = subprocess.run(base, input=sql, text=True, capture_output=True, timeout=20)
    if check:
        assert result.returncode == 0, result.stderr
        return result.stdout.strip()
    return result


def start(sql, marker):
    process = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    process.stdin.write(sql + f'\n\\echo {marker}\n')
    process.stdin.flush()
    received = b''
    deadline = time.monotonic() + 10
    while marker.encode() not in received.splitlines():
        remaining = deadline - time.monotonic()
        assert remaining > 0, 'Transaction readiness timed out'
        ready, _, _ = select.select([process.stdout], [], [], remaining)
        assert ready, 'Transaction readiness timed out'
        chunk = os.read(process.stdout.fileno(), 4096)
        assert chunk, 'Transaction exited: ' + process.stderr.read()
        received += chunk
    return process, received.decode()


def finish(process, commit=False):
    if process is not None and process.poll() is None:
        process.stdin.write(('COMMIT;' if commit else 'ROLLBACK;') + '\n\\q\n')
        process.stdin.flush()
        _, error = process.communicate(timeout=20)
        assert process.returncode == 0, error


def probe():
    identifiers = {old: str(uuid.uuid4()) for old in set(re.findall(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', fixture))}
    seed = fixture
    for old, new in identifiers.items():
        seed = seed.replace(old, new)
    query('BEGIN; ' + seed + ' COMMIT;')
    actor = identifiers['13466ed2-dcb7-4861-a528-68cc5579eea9']
    campaign = identifiers['10c5cdd7-16c6-4b91-b9c0-d2f67598a54f']
    response = identifiers['b312438e-4d8c-46bb-a2fb-9bd9c9b890c5']
    decision = identifiers['f2252494-1f26-4936-9969-0b94e3787473']
    auth = f"SET LOCAL request.jwt.claim.sub='{actor}'; SET LOCAL ROLE authenticated;"
    preview = json.loads(query(f"BEGIN; {auth} SELECT read_engagement_response_decision_context('{campaign}','{response}','{decision}'); ROLLBACK;"))
    link_id, first_request, second_request = [str(uuid.uuid4()) for _ in range(3)]
    link = f"SELECT write_engagement_response_decision_link('{campaign}','{response}','{decision}','{link_id}','link',NULL,'{preview['contextSha256']}','SYNTHETIC concurrent original');"
    queue = lambda request: f"SELECT queue_engagement_report('{campaign}','{request}','internal','{{}}');"
    held = waiting = None
    try:
        held, _ = start(f"BEGIN; SET LOCAL statement_timeout='15s'; {auth} {queue(first_request)}", 'QUEUE_HELD')
        refused = query(f"BEGIN; SET LOCAL statement_timeout='3s'; {auth} {link} COMMIT;", check=False)
        assert refused.returncode != 0 and 'PT503' in refused.stderr and 'sources are busy' in refused.stderr, 'Link did not refuse the active report transaction'
        assert query(f"SELECT count(*) FROM engagement_response_decision_links WHERE id='{link_id}';") == '0', 'Busy link wrote a receipt'
        finish(held, commit=True)
        original = query(f"SELECT snapshot_text FROM engagement_report_jobs WHERE request_id='{first_request}';")
        assert json.loads(original)['decisionLinkCount'] == 0
        held, _ = start(f"BEGIN; SET LOCAL statement_timeout='15s'; {auth} {link}", 'LINK_HELD')
        waiting = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        waiting.stdin.write(f"BEGIN; SET LOCAL statement_timeout='15s'; SET LOCAL application_name='report-history-wait-{link_id}'; {auth} {queue(second_request)} COMMIT;\n\\q\n")
        waiting.stdin.flush()
        deadline = time.monotonic() + 8
        while True:
            blocked = query(f"SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.datname=current_database() AND a.application_name='report-history-wait-{link_id}' AND NOT l.granted;")
            if int(blocked) > 0:
                break
            assert waiting.poll() is None, 'Queue did not wait for the active link transaction'
            assert time.monotonic() < deadline, 'Queue never reached an observed database lock wait'
            time.sleep(.05)
        finish(held, commit=True)
        output, error = waiting.communicate(timeout=20)
        assert waiting.returncode == 0, error
        new = json.loads(query(f"SELECT snapshot_text FROM engagement_report_jobs WHERE request_id='{second_request}';"))
        assert new['decisionLinkCount'] == 1 and len(new['decisionLinks']) == 1, 'Released queue lost the committed link'
        row = new['decisionLinks'][0]
        assert row['id'] == link_id and row['context_text'] == preview['contextText'], 'Released queue changed exact link evidence'
        assert hashlib.sha256(row['payload_text'].encode()).hexdigest() == row['payload_sha256']
        query(f'BEGIN; {auth} {queue(first_request)} COMMIT;')
        assert query(f"SELECT snapshot_text FROM engagement_report_jobs WHERE request_id='{first_request}';") == original, 'Retry recaptured the original report'
        return {'campaign': campaign, 'busySqlstate': 'PT503', 'observedQueueLockWait': True, 'oldHistoryCount': 0, 'newHistoryCount': 1, 'exactOldRetry': True, 'queuedReceipt': json.loads(output)}
    finally:
        finish(held)
        if waiting is not None and waiting.poll() is None:
            waiting.communicate(timeout=20)


results = []
try:
    # This target was explicitly cloned from the rollback proof database. Refuse
    # to initialize again rather than overwriting an existing proof state.
    if query("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='engagement_report_jobs' AND column_name='snapshot_format';") == '0':
        query('BEGIN; ' + migration + ' COMMIT;')
    for name, queue_body, link_body, failure in [
        ('baseline', queue_function, link_function, None),
        ('harmless-comment', queue_function + '\n-- Harmless concurrency note.\n', link_function, None),
        ('queue-lock-removed', queue_function.replace('WHERE id=p_campaign FOR UPDATE;', 'WHERE id=p_campaign;'), link_function, 'Link did not refuse the active report transaction'),
        ('link-lock-removed', queue_function, link_function.replace('FOR SHARE OF c NOWAIT;', ';'), 'Link did not refuse the active report transaction'),
    ]:
        query('BEGIN; ' + queue_body + '\n' + link_body + ' COMMIT;')
        try:
            detail = probe()
        except AssertionError as error:
            assert failure and str(error) == failure, str(error)
            results.append({'case': name, 'outcome': 'killed', 'expectedFailure': str(error)})
        else:
            assert failure is None, 'Targeted concurrency fault survived'
            results.append({'case': name, 'outcome': 'survived', **detail})
        print(name, results[-1]['outcome'], flush=True)
finally:
    query('BEGIN; ' + queue_function + '\n' + link_function + ' COMMIT;')
    (out / 'results.json').write_text(json.dumps({'container': container, 'database': database, 'migrationSha256': hashlib.sha256(migration.encode()).hexdigest(), 'results': results, 'limits': ['Synthetic committed fixtures remain only in a disconnected proof database.', 'Real queue/link transactions and database lock waits; no HTTP interruption, worker delivery or browser claim.', 'Original/refresh/withdrawal completeness is covered separately by rollback native proof.']}, indent=2) + '\n')
