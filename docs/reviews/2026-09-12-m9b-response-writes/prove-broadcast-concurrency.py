"""Independent connections in a restored clone; never an app or transport target.

Synthetic fixture rows remain in the clone. Each probe closes every transaction.
No email transport is called. This tests claim ordering, not inbox delivery or the
inevitable interval after a committed claim and before an external provider call.
"""
import importlib.util
import json
import queue
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('response_concurrency', ROOT / 'prove-concurrency.py')
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)
probe.DATABASE = 'response_broadcast_probe_20260913'
probe.COMMAND[probe.COMMAND.index('-d') + 1] = probe.DATABASE
WORKSPACE = 'f02e465a-40bd-4304-b4af-d45daff29d3d'


def fixture():
    assert probe.query("SELECT count(*) FROM engagement_response_broadcast_messages WHERE state='queued';") == '0'
    campaign, subscription, request = (str(uuid.uuid4()) for _ in range(3))
    probe.query(f"INSERT INTO engagement_campaigns(id,workspace_id,title,status,share_token) VALUES ('{campaign}','{WORKSPACE}','SYNTHETIC concurrent delivery','active','{uuid.uuid4()}');"
                f"INSERT INTO engagement_subscriptions(id,campaign_id,email,confirmed,confirm_token,unsubscribe_token) VALUES ('{subscription}','{campaign}','synthetic-{subscription}@example.invalid',true,'{uuid.uuid4()}','{uuid.uuid4()}');")
    probe.CAMPAIGN = campaign
    session = probe.Session()
    try:
        session.start_write(probe.rpc(request, changes={'theme_title': 'SYNTHETIC concurrent delivery', 'status': 'published'}))
        session.result()
        session.commit()
    finally:
        session.close()
    prepared = json.loads(probe.query("SELECT prepare_engagement_response_broadcast('http://localhost:3260');"))
    assert prepared['campaignId'] == campaign and prepared['count'] == 1
    outbox = probe.query(f"SELECT outbox_id FROM engagement_response_broadcast_messages WHERE campaign_id='{campaign}';")
    return campaign, subscription, outbox


def service():
    session = probe.Session()
    session.send("SET LOCAL ROLE service_role; SELECT 'SERVICE';")
    session.until('SERVICE')
    return session


def start_claim(session):
    session.start_write(f"COALESCE(claim_engagement_response_email('{uuid.uuid4()}'),'null'::jsonb)")


def wait_or_result(session, marker='RESULT:'):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        try:
            line = session.lines.get_nowait()
            if line.startswith(marker):
                return 'finished', line[len(marker):]
        except queue.Empty:
            pass
        if probe.query("SELECT wait_event FROM pg_stat_activity WHERE application_name=" + probe.literal(session.name) + " AND wait_event_type='Lock';"):
            return 'waiting', None
        if session.process.poll() is not None:
            raise RuntimeError('Session exited: ' + ''.join(session.errors))
        time.sleep(0.05)
    raise TimeoutError('Neither completion nor a live lock wait was observed')


def scenario(kind):
    campaign, subscription, outbox = fixture()
    first, second = service(), service()
    try:
        if kind == 'two-workers-one-message':
            start_claim(first)
            claimed = first.result()
            assert claimed['state'] == 'attempting' and claimed['outboxId'] == outbox
            start_claim(second)
            state, value = wait_or_result(second)
            assert state == 'finished' and json.loads(value) is None, 'Second worker did not skip the held claim'
            first.commit()
            second.commit()
            return {'secondWorkerSkippedHeldMessage': True}
        if kind == 'claim-before-unsubscribe':
            start_claim(first)
            assert first.result()['state'] == 'attempting'
            second.send(f"UPDATE engagement_subscriptions SET confirmed=false,unsubscribed_at=clock_timestamp() WHERE id='{subscription}'; SELECT 'CHANGED';")
            state, _ = wait_or_result(second, 'CHANGED')
            assert state == 'waiting', 'Unsubscribe row change did not wait for the already-authorized claim'
            first.commit()
            second.until('CHANGED')
            second.commit()
            return {'unsubscribeWaitedForPriorClaim': True}
        if kind == 'unsubscribe-before-claim':
            first.send(f"UPDATE engagement_subscriptions SET confirmed=false,unsubscribed_at=clock_timestamp() WHERE id='{subscription}'; SELECT 'CHANGED';")
        elif kind == 'closure-before-claim':
            first.send(f"UPDATE engagement_campaigns SET status='closed' WHERE id='{campaign}'; SELECT 'CHANGED';")
        else:
            raise ValueError(kind)
        first.until('CHANGED')
        start_claim(second)
        state, _ = wait_or_result(second)
        assert state == 'waiting', f'{kind}: Claim ignored a pending authority change'
        first.commit()
        claimed = second.result()
        assert claimed['state'] == 'cancelled' and 'messageText' not in claimed, f'{kind}: Changed authority still reached transport'
        second.commit()
        return {'claimWaitedAndCancelled': True}
    finally:
        first.close()
        second.close()
        # Confine cleanup to this synthetic message, keeping every row for inspection.
        probe.query(f"UPDATE engagement_response_broadcast_messages SET state='cancelled',finished_at=clock_timestamp() WHERE outbox_id='{outbox}' AND state IN ('queued','attempting');")


if __name__ == '__main__':
    results = []
    for kind in ['two-workers-one-message', 'claim-before-unsubscribe', 'unsubscribe-before-claim', 'closure-before-claim']:
        try:
            evidence = scenario(kind)
            result = {'case': kind, 'passed': True, 'evidence': evidence}
        except (AssertionError, RuntimeError, TimeoutError) as error:
            result = {'case': kind, 'passed': False, 'diagnostic': str(error)}
        results.append(result)
        print(result, flush=True)
        (ROOT / 'broadcast-concurrency-before-locks.json').write_text(json.dumps({'database': probe.DATABASE, 'results': results}, indent=2) + '\n')
    raise SystemExit(0 if all(row['passed'] for row in results) else 1)
