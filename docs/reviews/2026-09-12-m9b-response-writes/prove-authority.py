"""Run synthetic authority probes with the complete prototype in rolled-back transactions only."""
import hashlib
import json
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parent
parts = {name: (root / name).read_text() for name in ('response-write-transaction.sql', 'response-write-guards.sql', 'response-broadcast-queue.sql')}
probe = (root / 'authority-probe.sql').read_text()
command = ['docker', 'exec', '-i', 'supabase_db_openplan-restore-target-2026091050', 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']
write = 'response-write-transaction.sql'
queue = 'response-broadcast-queue.sql'
cases = [
    ('baseline', write, [], None),
    ('harmless-comment', write, [('-- Only one finalization is possible.', '-- Only one finalization is allowed.')], None),
    ('different-actor-replay', write, [('receipt.actor_id IS DISTINCT FROM auth.uid() OR ', '')], 'A different staff actor replayed the original request'),
    ('cross-campaign-update', write, [('WHERE id = p_response AND campaign_id = p_campaign FOR UPDATE;', 'WHERE id = p_response FOR UPDATE;')], 'A staff actor corrected a response through another campaign'),
    ('viewer-receipt-disclosure', write, [("AND m.user_id = auth.uid() AND m.role IN ('owner', 'admin', 'member')", 'AND m.user_id = auth.uid()')], 'Viewer read private write receipts'),
    ('viewer-write', write, [("AND role IN ('owner', 'admin', 'member') FOR SHARE) THEN", "AND role IN ('owner', 'admin', 'member', 'viewer') FOR SHARE) THEN")], 'Viewer wrote a staff response'),
    ('viewer-status-disclosure', queue, [("m.role IN ('owner','admin','member')", "m.role IN ('owner','admin','member','viewer')")], 'Viewer read private subscriber status'),
    ('revoked-replay', write, [
        ('IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.workspace_members', 'IF (NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.workspace_members'),
        ("AND role IN ('owner', 'admin', 'member') FOR SHARE) THEN", "AND role IN ('owner', 'admin', 'member') FOR SHARE)) AND NOT EXISTS (SELECT 1 FROM public.engagement_response_write_receipts WHERE campaign_id=p_campaign AND request_id=p_request AND actor_id=auth.uid()) THEN"),
    ], 'Revoked actor replayed a private receipt'),
    ('anonymous-rpc-privilege', write, [('TO authenticated;\n\n--', 'TO authenticated,anon;\n\n--')], 'Anonymous caller has private response RPC privilege'),
]
results = []
for name, key, replacements, expected in cases:
    changed = dict(parts)
    for before, after in replacements:
        assert changed[key].count(before) == 1, (name, changed[key].count(before))
        changed[key] = changed[key].replace(before, after)
    schema = '\n'.join(changed.values())
    run = subprocess.run(command, input="BEGIN; SET LOCAL statement_timeout='20s';\n" + schema + '\n' + probe + '\nROLLBACK;', text=True, capture_output=True, timeout=30)
    matched = run.returncode == 0 and 'privacy, revocation' in run.stderr if expected is None else run.returncode != 0 and expected in run.stderr
    results.append({'name': name, 'matched': matched, 'status': run.returncode, 'outcome': 'survived' if run.returncode == 0 else 'killed',
                    'expected': expected, 'schemaSha256': hashlib.sha256(schema.encode()).hexdigest(), 'probeSha256': hashlib.sha256(probe.encode()).hexdigest(),
                    'diagnostic': None if matched else run.stderr[-2000:]})
    (root / 'authority-mutations.json').write_text(json.dumps(results, indent=2) + '\n')
    print(name, results[-1]['outcome'], matched, flush=True)
    if not matched:
        raise RuntimeError(run.stderr)
check = subprocess.run(command, input="SELECT to_regclass('public.engagement_response_write_receipts') IS NULL; SELECT count(*) FROM auth.users WHERE id IN ('ac000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000002');", text=True, capture_output=True, check=True)
assert check.stdout.strip() == 't\n0', check.stdout
print('Prototype and synthetic authority accounts absent after rollback', flush=True)
