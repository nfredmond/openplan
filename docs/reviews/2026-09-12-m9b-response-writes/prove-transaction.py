import hashlib
import json
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parent
schema = (root / 'response-write-transaction.sql').read_text() + '\n' + (root / 'response-write-guards.sql').read_text()
probe = (root / 'transaction-probe.sql').read_text() + '\n' + (root / 'guards-probe.sql').read_text()
command = ['docker', 'exec', '-i', 'supabase_db_openplan-restore-target-2026091050',
           'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']
cases = [
    ('baseline', None, None, None),
    ('harmless-comment', '-- Only one finalization is possible.', '-- One finalization is allowed.', None),
    ('accept-stale-version', 'IF previous.updated_at IS DISTINCT FROM p_expected_updated_at THEN', 'IF false THEN', 'Stale editor overwrote the first correction'),
    ('accept-changed-retry', 'OR receipt.payload_json <> envelope', 'OR false', 'Changed-payload retry was accepted'),
    ('regressing-clock', "greatest(clock_timestamp(), OLD.updated_at + interval '1 microsecond')", 'now()', 'Response version did not advance'),
    ('direct-insert', 'REVOKE INSERT, UPDATE, DELETE ON public.engagement_closeloop_entries', 'REVOKE UPDATE, DELETE ON public.engagement_closeloop_entries', 'Direct INSERT bypassed the response transaction'),
    ('direct-update', 'REVOKE INSERT, UPDATE, DELETE ON public.engagement_closeloop_entries', 'REVOKE INSERT, DELETE ON public.engagement_closeloop_entries', 'Direct UPDATE bypassed the response transaction'),
    ('direct-delete', 'REVOKE INSERT, UPDATE, DELETE ON public.engagement_closeloop_entries', 'REVOKE INSERT, UPDATE ON public.engagement_closeloop_entries', 'Direct DELETE bypassed the response transaction'),
    ('forged-withdrawal', 'REVOKE ALL ON FUNCTION public.withdraw_engagement_source_responses(uuid,uuid,jsonb,jsonb)', 'GRANT EXECUTE ON FUNCTION public.withdraw_engagement_source_responses(uuid,uuid,jsonb,jsonb)', 'Ordinary caller could invoke the trusted source helper'),
    ('reader-reason', "'change_reason', h.change_reason", "'change_reason', NULL::text", 'Complete history reader lost the retained correction metadata'),
    ('cleared-ai-provenance', "IF previous.ai_assisted AND p_changes->'ai_assisted' = 'false'::jsonb THEN", 'IF false THEN', 'Recorded AI assistance could be cleared'),
    ('missing-reason', "write_receipt.payload_json->>'reason'", 'NULL::text', 'Correction reason or request was lost from private history'),
    ('direct-withdrawal', "p_source = ANY(e.source_item_ids)", 'false', 'Direct source change did not withdraw its published response'),
    ('parent-withdrawal', 'reply.parent_item_id = p_source', 'false', 'Parent change left a linked reply response published'),
    ('source-provenance', "'sourceAfter', p_after", "'sourceAfter', '{}'::jsonb", 'Automatic withdrawal lost source provenance or invented a human response reason'),
    ('service-bypass', 'ON public.engagement_closeloop_entries\n  FROM PUBLIC, anon, authenticated, service_role;', 'ON public.engagement_closeloop_entries\n  FROM PUBLIC, anon, authenticated;', 'Service role bypassed the response transaction'),
    ('mutable-receipt', "IF TG_OP = 'UPDATE' AND OLD.result_json IS NULL", "IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;\n  IF TG_OP = 'UPDATE' AND OLD.result_json IS NULL", 'Completed receipt could be changed'),
]
results = []
for name, before, after, expected in cases:
    changed = schema
    if before:
        assert schema.count(before) == (3 if name == 'missing-reason' else 1), name
        changed = schema.replace(before, after)
        if name == 'forged-withdrawal':
            changed = changed.replace('GRANT EXECUTE ON FUNCTION public.withdraw_engagement_source_responses(uuid,uuid,jsonb,jsonb)\n  FROM', 'GRANT EXECUTE ON FUNCTION public.withdraw_engagement_source_responses(uuid,uuid,jsonb,jsonb)\n  TO')
    sql = "BEGIN; SET LOCAL statement_timeout='20s';\n" + changed + '\n' + probe + '\nROLLBACK;\n'
    run = subprocess.run(command, input=sql, text=True, capture_output=True, timeout=30)
    matched = run.returncode == 0 if expected is None else run.returncode != 0 and expected in run.stderr
    results.append({'name': name, 'status': run.returncode, 'matched': matched,
                    'outcome': 'survived' if run.returncode == 0 else 'killed',
                    'expected': expected, 'schemaSha256': hashlib.sha256(changed.encode()).hexdigest(),
                    'probeSha256': hashlib.sha256(probe.encode()).hexdigest(),
                    'diagnostic': None if matched else run.stderr[-2000:]})
    (root / 'transaction-mutations.json').write_text(json.dumps(results, indent=2) + '\n')
    print(name, results[-1]['outcome'], matched, flush=True)
    if not matched:
        raise RuntimeError(run.stderr)
# Each connection ends after rollback or an error. Neither commits the prototype.
check = subprocess.run(command + ['-Atc', "SELECT to_regclass('public.engagement_response_write_receipts') IS NULL"],
                       text=True, capture_output=True, timeout=30)
assert check.returncode == 0 and check.stdout.strip() == 't', 'Prototype schema remained installed'
print('Prototype schema absent after rolled-back probes', flush=True)
