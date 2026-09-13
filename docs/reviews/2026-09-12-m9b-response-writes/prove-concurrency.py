"""Use only the retained clone database; never the source stack's postgres DB."""
import json
import queue
import subprocess
import threading
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATABASE = 'response_write_probe_20260913'
COMMAND = ['docker', 'exec', '-i', 'supabase_db_openplan-restore-target-2026091050',
           'psql', '-X', '-qAt', '-U', 'postgres', '-d', DATABASE, '-v', 'ON_ERROR_STOP=1']
CAMPAIGN = 'b76fe95e-3a5e-4791-a232-dd65d85b8a57'
ACTOR = '4a21e42f-27a7-474d-9a7a-5912c70af359'


def literal(value):
    return 'NULL' if value is None else "'" + str(value).replace("'", "''") + "'"


def query(sql):
    run = subprocess.run(COMMAND, input=sql, text=True, capture_output=True, timeout=15)
    if run.returncode:
        raise RuntimeError(run.stderr)
    return run.stdout.strip()


def rpc(request, operation='create', entry=None, version=None, reason=None, changes=None):
    return 'public.write_engagement_response(' + ','.join(literal(v) for v in (
        CAMPAIGN, request, operation, entry, version, reason, json.dumps(changes or {}))) + ')'


class Session:
    def __init__(self, isolation="read committed"):
        self.name = 'response-probe-' + uuid.uuid4().hex
        self.process = subprocess.Popen(COMMAND, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.PIPE, text=True, bufsize=1)
        self.lines = queue.Queue()
        self.errors = []
        self.readers = [threading.Thread(target=self.read, args=(self.process.stdout, False)),
                        threading.Thread(target=self.read, args=(self.process.stderr, True))]
        for reader in self.readers:
            reader.start()
        self.send(f"SET application_name={literal(self.name)}; BEGIN ISOLATION LEVEL {isolation}; SET LOCAL ROLE authenticated;"
                  f"SELECT set_config('request.jwt.claim.sub',{literal(ACTOR)},true); SELECT 'READY';")
        self.until('READY')

    def read(self, stream, error):
        for line in stream:
            if error:
                self.errors.append(line)
            else:
                self.lines.put(line.strip())

    def send(self, sql):
        self.process.stdin.write(sql + '\n')
        self.process.stdin.flush()

    def until(self, prefix):
        end = time.monotonic() + 12
        while time.monotonic() < end:
            try:
                line = self.lines.get(timeout=0.1)
                if line.startswith(prefix):
                    return line[len(prefix):]
            except queue.Empty:
                if self.process.poll() is not None:
                    raise RuntimeError('Database session ended: ' + ''.join(self.errors))
        raise TimeoutError('No database result for ' + prefix)

    def start_write(self, expression):
        self.send("SELECT 'RESULT:' || (" + expression + ')::text;')

    def result(self):
        return json.loads(self.until('RESULT:'))

    def commit(self):
        self.send("COMMIT; SELECT 'COMMITTED';")
        self.until('COMMITTED')

    def failure(self, expected):
        status = self.process.wait(timeout=12)
        for reader in self.readers:
            reader.join(timeout=1)
        assert status != 0 and expected in ''.join(self.errors), ''.join(self.errors)

    def close(self):
        if self.process.poll() is None:
            self.send('ROLLBACK;\n\\q')
            self.process.wait(timeout=12)
        for reader in self.readers:
            reader.join(timeout=1)


def wait_for_lock(session):
    end = time.monotonic() + 8
    while time.monotonic() < end:
        event = query('SELECT wait_event FROM pg_stat_activity WHERE application_name=' +
                      literal(session.name) + " AND wait_event_type='Lock';")
        if event:
            return event
        if session.process.poll() is not None:
            raise RuntimeError('Contender exited before the held transaction released it')
        time.sleep(0.05)
    raise TimeoutError('Contender never waited on the held database transaction')


def duplicate_create():
    a, b = Session(), Session()
    try:
        expression = rpc(str(uuid.uuid4()), changes={'theme_title': 'SYNTHETIC concurrent retry'})
        a.start_write(expression)
        first = a.result()
        b.start_write(expression)
        waited = wait_for_lock(b)
        a.commit()
        replay = b.result()
        b.commit()
        assert replay['replayed'] and first['entry'] == replay['entry'], 'Concurrent retry did not replay the exact response'
        count = query('SELECT count(*) FROM public.engagement_response_history WHERE response_id=' + literal(first['entryId']) + ';')
        assert count == '1', 'Concurrent retry duplicated response history'
        return {'case': 'concurrent-identical-create', 'waitEvent': waited, 'historyCount': int(count)}
    finally:
        a.close()
        b.close()


def stale_correction():
    setup = Session()
    try:
        setup.start_write(rpc(str(uuid.uuid4()), changes={'theme_title': 'SYNTHETIC competing editors'}))
        entry = setup.result()['entry']
        setup.commit()
    finally:
        setup.close()
    a, b = Session(), Session()
    try:
        a.start_write(rpc(str(uuid.uuid4()), 'update', entry['id'], entry['updated_at'],
                          'SYNTHETIC first editor', {'we_did': 'First editor retained'}))
        first = a.result()
        b.start_write(rpc(str(uuid.uuid4()), 'update', entry['id'], entry['updated_at'],
                          'SYNTHETIC stale editor', {'we_did': 'Stale overwrite'}))
        waited = wait_for_lock(b)
        a.commit()
        b.failure('Response changed; review the current copy')
        saved = query('SELECT we_did FROM engagement_closeloop_entries WHERE id=' + literal(entry['id']) + ';')
        assert saved == first['entry']['we_did'], 'Concurrent stale editor replaced committed words'
        return {'case': 'concurrent-stale-correction', 'waitEvent': waited}
    finally:
        a.close()
        b.close()


def source_fixture():
    parent, reply = str(uuid.uuid4()), str(uuid.uuid4())
    query('INSERT INTO engagement_items(id,campaign_id,body,status) VALUES(' + literal(parent) + ',' +
          literal(CAMPAIGN) + ",'SYNTHETIC race parent','approved');" +
          'INSERT INTO engagement_items(id,campaign_id,body,status,parent_item_id) VALUES(' + literal(reply) + ',' +
          literal(CAMPAIGN) + ",'SYNTHETIC race reply','approved'," + literal(parent) + ');')
    return parent, reply


def source_race(publication_first):
    parent, reply = source_fixture()
    publish, withdraw = Session(), Session()
    try:
        expression = rpc(str(uuid.uuid4()), changes={
            'theme_title': 'SYNTHETIC publication race', 'status': 'published', 'source_item_ids': [reply]})
        withdrawal = ('UPDATE engagement_items SET status=\'rejected\', review_expected_updated_at=updated_at,'
                      " review_reason='SYNTHETIC concurrent source withdrawal' WHERE id=" + literal(parent) + "; SELECT 'WITHDRAWN';")
        if publication_first:
            publish.start_write(expression)
            result = publish.result()
            withdraw.send(withdrawal)
            waited = wait_for_lock(withdraw)
            publish.commit()
            withdraw.until('WITHDRAWN')
            withdraw.commit()
            status = query('SELECT status FROM engagement_closeloop_entries WHERE id=' + literal(result['entryId']) + ';')
            assert status == 'draft', 'Concurrent parent withdrawal left a newly created response published'
        else:
            withdraw.send(withdrawal)
            withdraw.until('WITHDRAWN')
            publish.start_write(expression)
            waited = wait_for_lock(publish)
            withdraw.commit()
            publish.failure('Review and publish linked contributions before publishing the staff response')
        return {'case': 'publication-first' if publication_first else 'withdrawal-first', 'waitEvent': waited}
    finally:
        publish.close()
        withdraw.close()


def stale_withdrawal_snapshot():
    parent, reply = source_fixture()
    withdraw, publish = Session('repeatable read'), Session()
    try:
        withdraw.send('SELECT status FROM engagement_items WHERE id=' + literal(parent) + "; SELECT 'SNAPSHOT';")
        withdraw.until('SNAPSHOT')
        publish.start_write(rpc(str(uuid.uuid4()), changes={
            'theme_title': 'SYNTHETIC retained snapshot test', 'status': 'published', 'source_item_ids': [reply]}))
        response = publish.result()
        publish.commit()
        withdraw.send("UPDATE engagement_items SET status='rejected', review_expected_updated_at=updated_at,"
                      " review_reason='SYNTHETIC stale snapshot withdrawal' WHERE id=" + literal(parent) + "; SELECT 'WITHDRAWN';")
        try:
            withdraw.until('WITHDRAWN')
        except RuntimeError as error:
            assert 'Source withdrawals require read committed isolation' in str(error), str(error)
        else:
            withdraw.commit()
            raise AssertionError('Unsafe snapshot withdrawal was accepted')
        # The failed source edit rolled back, so the reviewed source and its
        # response stay consistent. It must be retried in the supported mode.
        status = query('SELECT e.status || \':\' || i.status FROM engagement_closeloop_entries e '
                       'CROSS JOIN engagement_items i WHERE e.id=' + literal(response['entryId']) +
                       ' AND i.id=' + literal(parent) + ';')
        assert status == 'published:approved', 'Isolation refusal left a partial source edit'
        return {'case': 'stale-withdrawal-snapshot', 'sourceAndResponseConsistent': True}
    finally:
        withdraw.close()
        publish.close()


if __name__ == '__main__':
    results = []
    for test in (duplicate_create, stale_correction, lambda: source_race(True), lambda: source_race(False), stale_withdrawal_snapshot):
        result = test()
        results.append(result)
        (ROOT / 'concurrency-results.json').write_text(json.dumps({'database': DATABASE, 'results': results}, indent=2) + '\n')
        print(result, flush=True)
