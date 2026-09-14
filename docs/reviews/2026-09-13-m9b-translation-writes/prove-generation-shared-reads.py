"""Hold real database locks across independent sessions; never change saved rows.

Uses the retained browser-created campaign in the named disposable application
stack. Faulted function replacements exist only inside rolled-back transactions.
"""
from pathlib import Path
from contextlib import contextmanager
import hashlib, json, os, select, subprocess, sys, time
review = Path(__file__).resolve().parent
app = review.parents[2] / 'openplan'
source = app / 'supabase/migrations/20261014000018_engagement_translation_shared_reads.sql'
private = Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913') / ('shared-read-controls-' + str(time.time_ns()))
private.mkdir(mode=0o700)
command = ['docker', 'exec', '-i', 'supabase_db_openplan-restore-target-2026091050', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']
campaign = '8e2b0137-5fc8-4506-88eb-2850508a0563'
request = 'f46fffaf-09d4-4b36-b42f-90712f376f06'
actor = '4a21e42f-27a7-474d-9a7a-5912c70af359'
viewer = 'e42ae452-0820-4693-90af-23975ead7369'
workspace = 'f02e465a-40bd-4304-b4af-d45daff29d3d'
def auth(user=actor, role='authenticated'):
    return f"SET LOCAL ROLE {role}; SELECT set_config('request.jwt.claim.sub','{user}',true);"
detail = f"SELECT read_translation_generation_request('{campaign}','{request}')->>'requestId';"
catalog = f"SELECT list_translation_generation_requests('{campaign}')->>'campaignId';"
shared = f"SELECT pg_advisory_xact_lock_shared(hashtextextended('engagement-response:{campaign}',0));"
exclusive = shared.replace('_shared(', '(')
def run(body, label):
    result = subprocess.run(command, input=body, text=True, capture_output=True, timeout=12)
    (private / (label + '.log')).write_text(result.stdout + result.stderr)
    return result
@contextmanager
def holder(statement):
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        process.stdin.write(("BEGIN; SET LOCAL statement_timeout='5s'; " + statement + " SELECT 'LOCK_READY';\n").encode()); process.stdin.flush()
        observed = b''; deadline = time.monotonic() + 8
        while b'LOCK_READY' not in observed:
            assert process.poll() is None, 'Lock holder ended before readiness'
            assert time.monotonic() < deadline, 'Lock holder readiness timed out'
            ready, _, _ = select.select([process.stdout], [], [], 0.1)
            if ready: observed += os.read(process.stdout.fileno(), 4096)
        yield process
        assert process.poll() is None, 'Lock holder ended before contention check'
    finally:
        if process.poll() is None:
            process.stdin.write(b'ROLLBACK;\n'); process.stdin.flush()
        process.stdin.close(); process.stdin = None
        stdout, stderr = process.communicate(timeout=8)
        assert process.returncode == 0, ('Lock holder failed', stderr.decode())
def check_case(label, mutation=''):
    def probe(sql, expected, message, user=actor, role='authenticated'):
        result = run("BEGIN; SET LOCAL statement_timeout='3s';\n" + mutation + '\n' + auth(user, role) + sql + 'ROLLBACK;', label + '-' + message.replace(' ', '-'))
        if expected == 'ok': assert result.returncode == 0 and (request in result.stdout or campaign in result.stdout), message
        else: assert result.returncode != 0 and expected in result.stderr, message
    with holder(auth() + detail):
        probe(detail, 'ok', 'concurrent detail readers coexist')
        probe(catalog, 'ok', 'catalog coexists with detail reader')
        # Writers keep their original exclusive lock, even for the same actor.
        result = run(f"BEGIN; SELECT lock_translation_generation_scope('{campaign}','{actor}'); ROLLBACK;", label + '-writer')
        assert result.returncode != 0 and 'PT503' in result.stderr, 'writer cannot overlap a retained reader'
    with holder(auth() + catalog): probe(detail, 'ok', 'detail coexists with catalog reader')
    with holder(exclusive):
        probe(detail, 'PT503', 'source writer blocks detail')
        probe(catalog, 'PT503', 'source writer blocks catalog')
    with holder(f"SELECT id FROM engagement_campaigns WHERE id='{campaign}' FOR UPDATE;"):
        probe(detail, 'PT503', 'campaign change blocks detail')
    with holder(f"SELECT user_id FROM workspace_members WHERE workspace_id='{workspace}' AND user_id='{actor}' FOR UPDATE;"):
        probe(detail, 'PT503', 'membership change blocks detail')
    probe(detail, '42501', 'viewer cannot read detail', user=viewer)
    probe(catalog, '42501', 'viewer cannot read catalog', user=viewer)
    probe(detail, '42501', 'anonymous cannot read detail', user='', role='anon')
    probe(catalog, '42501', 'anonymous cannot read catalog', user='', role='anon')
    result = run("SELECT has_function_privilege('authenticated','public.lock_translation_generation_read_scope(uuid,uuid)','EXECUTE') OR has_function_privilege('anon','public.lock_translation_generation_read_scope(uuid,uuid)','EXECUTE');", label + '-helper-grants')
    assert result.returncode == 0 and result.stdout.strip() == 'f', 'private helper cannot be called directly'

def snapshot():
    result = run(f"SELECT md5(coalesce(jsonb_agg(to_jsonb(h) ORDER BY id)::text,'')) FROM engagement_translation_history h WHERE campaign_id='{campaign}'; SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY request_id)::text,'')) FROM engagement_translation_write_receipts r WHERE campaign_id='{campaign}'; SELECT md5(string_agg(pg_get_functiondef(p.oid),'' ORDER BY p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('lock_translation_generation_read_scope','read_translation_generation_request','list_translation_generation_requests','lock_translation_generation_scope');", 'state')
    assert result.returncode == 0, 'Snapshot failed'
    return result.stdout

before = snapshot()
body = source.read_text(); helper = body[body.index('CREATE FUNCTION'):body.index('REVOKE ALL')].replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION', 1)
cases = [('baseline', '', None)]
if '--controls' in sys.argv:
    cases += [('harmless', helper + '\n-- Harmless shared read control.\n', None)]
    replacements = [
        ('exclusive-advisory', 'pg_try_advisory_xact_lock_shared(', 'pg_try_advisory_xact_lock(', 'concurrent detail readers coexist'),
        ('exclusive-campaign', 'WHERE id=p_campaign FOR SHARE NOWAIT;', 'WHERE id=p_campaign FOR UPDATE NOWAIT;', 'concurrent detail readers coexist'),
        ('omit-advisory', "IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('engagement-response:'||p_campaign::text,0)) THEN", 'IF false THEN', 'source writer blocks detail'),
        ('omit-campaign-lock', 'WHERE id=p_campaign FOR SHARE NOWAIT;', 'WHERE id=p_campaign;', 'campaign change blocks detail'),
        ('omit-membership-lock', "AND role IN ('owner','admin','member') FOR SHARE NOWAIT)", "AND role IN ('owner','admin','member'))", 'membership change blocks detail'),
    ]
    for name, old, new, expected in replacements:
        assert helper.count(old) == 1, name
        cases.append((name, helper.replace(old, new), expected))
    bypass = helper.replace("IN ('owner','admin','member')", "IN ('owner','admin','member','viewer')")
    assert bypass != helper
    cases.append(('allow-viewer', bypass, 'viewer cannot read detail'))
results = []
try:
    for name, mutation, expected in cases:
        failure = None
        try: check_case(name, mutation)
        except AssertionError as error: failure = str(error)
        correct = failure == expected
        results.append({'case': name, 'outcome': 'survived' if failure is None else 'killed', 'expectedFailure': expected, 'failure': failure, 'expectedOutcome': correct})
        print(name, results[-1]['outcome'], failure or '', flush=True)
        assert correct, (name, failure, expected)
finally:
    unchanged = snapshot() == before
    report = {'database': command[3], 'campaignId': campaign, 'privateEvidence': str(private), 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'results': results, 'historyReceiptsAndFunctionsUnchanged': unchanged, 'limits': 'Real independent database sessions and held locks using a browser-created synthetic campaign. Function mutations roll back. No provider calls. Does not prove high-volume performance, arbitrary source adapters, browser rendering, or complete release acceptance.'}
    (review / 'generation-shared-read-controls.json').write_text(json.dumps(report, indent=2) + '\n')
    assert unchanged, 'Concurrency checks changed retained history, receipts or functions'
