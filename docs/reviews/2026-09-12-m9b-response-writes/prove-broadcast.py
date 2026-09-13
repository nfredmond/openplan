import hashlib
import json
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parent
schema = '\n'.join((root / name).read_text() for name in (
    'response-write-transaction.sql', 'response-write-guards.sql', 'response-broadcast-queue.sql'))
probe = (root / 'broadcast-probe.sql').read_text()
command = ['docker', 'exec', '-i', 'supabase_db_openplan-restore-target-2026091050',
           'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']
cases = [
    ('baseline', None, None, None),
    ('harmless-comment', '-- One statement snapshots all confirmed subscriptions', '-- One statement retains all confirmed subscriptions', None),
    ('lost-publication-job', "IF OLD.result_json IS NULL AND NEW.result_json->>'becamePublished'='true' THEN", 'IF false THEN', 'An unprepared broadcast claimed a known audience'),
    ('incomplete-audience', 'WHERE s.campaign_id=job.campaign_id AND s.confirmed AND s.unsubscribed_at IS NULL\n  ), saved', 'WHERE s.campaign_id=job.campaign_id AND s.confirmed AND s.unsubscribed_at IS NULL LIMIT 1000\n  ), saved', 'Broadcast preparation lost confirmed subscribers'),
    ('missing-opt-out', "'/subscribe/unsubscribe?token='", "'/subscribe/incorrect?token='", 'Retained messages lost their response or per-recipient opt-out'),
    ('unrecorded-attempt', "SET state='attempting',attempt_token=p_attempt", "SET state='queued',attempt_token=p_attempt", 'Transport claim did not retain an outbox row and attempt first'),
    ('foreign-attempt', 'message.attempt_token IS DISTINCT FROM p_attempt', 'false', 'A foreign attempt could finalize delivery'),
    ('mutable-outcome', "IF message.state<>'attempting' AND NOT (message.state='uncertain' AND message.finished_at IS NULL) THEN", 'IF false THEN', 'Completed delivery outcome was replaced'),
    ('reissued-uncertainty', "SELECT * INTO message FROM engagement_response_broadcast_messages WHERE state='queued'", "SELECT * INTO message FROM engagement_response_broadcast_messages WHERE state IN ('queued','uncertain')", 'Interrupted delivery was silently reissued or lost its uncertainty'),
    ('ignored-unsubscribe', 'AND s.confirmed AND s.unsubscribed_at IS NULL AND s.email=outbox.to_email', 'AND s.email=outbox.to_email', 'Unsubscribed participant reached the transport claim'),
    ('altered-message', "OR encode(extensions.digest(text_record,'sha256'),'hex')<>message.content_sha256", 'OR false', 'Changed retained message reached the transport claim'),
    ('ignored-withdrawal', 'IF NOT EXISTS(SELECT 1 FROM engagement_closeloop_entries e JOIN engagement_campaigns c', 'IF false AND NOT EXISTS(SELECT 1 FROM engagement_closeloop_entries e JOIN engagement_campaigns c', 'Withdrawn response reached a later transport claim'),
    ('hidden-preparation-error', 'END $$;\nREVOKE ALL ON FUNCTION public.prepare_engagement_response_broadcast(text)', "EXCEPTION WHEN OTHERS THEN RETURN '{}'::jsonb;\nEND $$;\nREVOKE ALL ON FUNCTION public.prepare_engagement_response_broadcast(text)", 'An outbox failure was disguised as a prepared broadcast'),
    ('public-preparation', 'GRANT EXECUTE ON FUNCTION public.prepare_engagement_response_broadcast(text) TO service_role;', 'GRANT EXECUTE ON FUNCTION public.prepare_engagement_response_broadcast(text) TO service_role,authenticated;', 'Staff caller prepared sensitive delivery messages'),
    ('direct-table-disclosure', 'REVOKE ALL ON public.engagement_response_broadcast_messages FROM PUBLIC,anon,authenticated,service_role;', 'REVOKE ALL ON public.engagement_response_broadcast_messages FROM PUBLIC,anon,authenticated,service_role;\nGRANT SELECT ON public.engagement_response_broadcast_messages TO authenticated;', 'Staff caller read the private broadcast tables directly'),
    ('outsider-summary', 'IF NOT EXISTS(SELECT 1 FROM engagement_campaigns c JOIN workspace_members m ON m.workspace_id=c.workspace_id', 'IF false AND NOT EXISTS(SELECT 1 FROM engagement_campaigns c JOIN workspace_members m ON m.workspace_id=c.workspace_id', 'An outsider read the private broadcast summary'),
]
results = []
for name, before, after, expected in cases:
    changed = schema
    if before:
        assert schema.count(before) == 1, name
        changed = schema.replace(before, after)
    run = subprocess.run(command, input="BEGIN; SET LOCAL statement_timeout='20s';\n" + changed + '\n' + probe + '\nROLLBACK;',
                         text=True, capture_output=True, timeout=30)
    matched = run.returncode == 0 if expected is None else run.returncode != 0 and expected in run.stderr
    results.append({'name': name, 'matched': matched, 'status': run.returncode,
                    'outcome': 'survived' if run.returncode == 0 else 'killed', 'expected': expected,
                    'schemaSha256': hashlib.sha256(changed.encode()).hexdigest(),
                    'probeSha256': hashlib.sha256(probe.encode()).hexdigest(),
                    'diagnostic': None if matched else run.stderr[-2000:]})
    (root / 'broadcast-mutations.json').write_text(json.dumps(results, indent=2) + '\n')
    print(name, results[-1]['outcome'], matched, flush=True)
    if not matched:
        raise RuntimeError(run.stderr)
result = subprocess.run(command, input="SELECT to_regclass('public.engagement_response_broadcasts') IS NULL;", text=True, capture_output=True, check=True)
assert result.stdout.strip() == 't', 'Broadcast prototype remained installed in the source stack'
print('Broadcast prototype absent from source stack after all probes', flush=True)
