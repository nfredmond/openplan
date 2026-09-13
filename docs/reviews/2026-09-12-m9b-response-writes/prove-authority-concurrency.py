"""Serialize permission changes with response writes, only in the retained prototype clone."""
import hashlib
import importlib.util
import json
import re
import time
from pathlib import Path

root = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('response_concurrency', root / 'prove-concurrency.py')
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)
probe.ACTOR = 'ad000000-0000-4000-8000-000000000001'
workspace = 'f02e465a-40bd-4304-b4af-d45daff29d3d'
probe.query("INSERT INTO auth.users(id,email,aud,role) VALUES ('" + probe.ACTOR + "','response-concurrency-probe@example.invalid','authenticated','authenticated') ON CONFLICT(id) DO NOTHING;")
original = probe.query("SELECT pg_get_functiondef('public.write_engagement_response(uuid,uuid,text,uuid,timestamptz,text,jsonb)'::regprocedure);")
source = (root / 'response-write-transaction.sql').read_text()
function = re.search(r'CREATE FUNCTION public\.write_engagement_response\(.*?END \$\$;', source, re.DOTALL).group().replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION', 1)


def staff():
    probe.query("INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ('" + workspace + "','" + probe.ACTOR + "','member') ON CONFLICT(workspace_id,user_id) DO UPDATE SET role='member';")


def wait_or_marker(session, marker):
    end = time.monotonic() + 8
    while time.monotonic() < end:
        if not session.lines.empty():
            line = session.lines.get_nowait()
            if line.startswith(marker):
                return 'finished'
        event = probe.query('SELECT wait_event FROM pg_stat_activity WHERE application_name=' + probe.literal(session.name) + " AND wait_event_type='Lock';")
        if event:
            return 'waiting'
        if session.process.poll() is not None:
            raise RuntimeError('Unexpected session failure: ' + ''.join(session.errors))
        time.sleep(0.05)
    raise TimeoutError('Neither a lock nor completion was observed')


def race(write_first):
    staff()
    writer, revoker = probe.Session(), probe.Session()
    try:
        revoke = "RESET ROLE; UPDATE workspace_members SET role='viewer' WHERE workspace_id='" + workspace + "' AND user_id='" + probe.ACTOR + "'; SELECT 'REVOKED';"
        expression = probe.rpc(str(probe.uuid.uuid4()), changes={'theme_title': 'SYNTHETIC permission ordering'})
        if write_first:
            writer.start_write(expression)
            result = writer.result()
            revoker.send(revoke)
            state = wait_or_marker(revoker, 'REVOKED')
            if state == 'finished':
                revoker.commit()
                writer.commit()
                raise AssertionError('Revocation committed before the already-authorized response transaction finished')
            writer.commit()
            revoker.until('REVOKED')
            revoker.commit()
            return {'case': 'write-before-revocation', 'revokerWaited': True, 'responseId': result['entryId']}
        revoker.send(revoke)
        revoker.until('REVOKED')
        writer.start_write(expression)
        state = wait_or_marker(writer, 'RESULT:')
        if state == 'finished':
            raise AssertionError('Response write ignored an in-flight membership revocation')
        revoker.commit()
        writer.failure('Staff campaign access required')
        return {'case': 'revocation-before-write', 'writerWaitedAndWasRefused': True}
    finally:
        writer.close()
        revoker.close()
        staff()


cases = [('baseline', function, None), ('harmless-comment', function + '\n-- Harmless authority control.\n', None)]
lock = "AND role IN ('owner', 'admin', 'member') FOR SHARE) THEN"
if lock in function:
    cases.append(('missing-membership-lock', function.replace(lock, "AND role IN ('owner', 'admin', 'member')) THEN"), 'Revocation committed before'))
results = []
try:
    for name, definition, expected in cases:
        probe.query(definition)
        evidence, diagnostic = [], None
        try:
            evidence.append(race(True))
            evidence.append(race(False))
        except (AssertionError, RuntimeError, TimeoutError) as error:
            diagnostic = str(error)
        matched = diagnostic is None if expected is None else diagnostic is not None and expected in diagnostic
        results.append({'name': name, 'matched': matched, 'outcome': 'survived' if diagnostic is None else 'killed', 'diagnostic': diagnostic,
                        'expected': expected, 'evidence': evidence, 'functionSha256': hashlib.sha256(definition.encode()).hexdigest()})
        (root / 'authority-concurrency.json').write_text(json.dumps({'database': probe.DATABASE, 'results': results}, indent=2) + '\n')
        print(name, results[-1]['outcome'], matched, diagnostic or '', flush=True)
        if not matched:
            raise RuntimeError(diagnostic)
finally:
    probe.query(original)
    restored = probe.query("SELECT pg_get_functiondef('public.write_engagement_response(uuid,uuid,text,uuid,timestamptz,text,jsonb)'::regprocedure);")
    assert restored == original, 'Clone function restoration did not match original definition'
    (root / 'authority-concurrency-restoration.json').write_text(json.dumps({'database': probe.DATABASE, 'restored': True, 'definitionSha256': hashlib.sha256(restored.encode()).hexdigest()}, indent=2) + '\n')
    print('Original clone response function restored', flush=True)
