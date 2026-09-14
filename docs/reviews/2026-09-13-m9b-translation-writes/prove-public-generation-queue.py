"""Run candidate and fault probes in rolled-back schema-owner transactions.

Only the named schema-only proof DB is writable. Never attach a worker or
PostgREST to it. Mutation text stays in memory; no application file is edited.
"""
from pathlib import Path
import hashlib
import json
import subprocess
import time

review = Path(__file__).resolve().parent
source = review / 'public-generation-queue-candidate.sql'
original = source.read_text()
probe = (review / 'public-generation-queue-probe.sql').read_text()
container = 'supabase_db_openplan-restore-target-2026091050'
database = 'openplan_translation_resolution_proof_20260913'
private = Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/public-queue-controls') / time.strftime('%Y%m%dT%H%M%S')
private.mkdir(parents=True, exist_ok=False)
base = ['docker', 'exec', '-i', container, 'psql', '-U', 'supabase_admin', '-d', database, '-X', '-v', 'ON_ERROR_STOP=1']
cases = [('baseline', original, None), ('harmless-comment', original + '\n-- Harmless public queue control.\n', None)]

def mutate(name, old, new, target):
    assert original.count(old) == 1, (name, original.count(old))
    cases.append((name, original.replace(old, new, 1), target))

mutate('allow-unapproved-parent', 'IF item.parent_item_id IS NOT NULL AND NOT EXISTS(', 'IF false AND NOT EXISTS(', 'Guard failed: unapproved parent')
mutate('allow-unapproved-item', "WHERE id=p_item AND campaign_id=campaign.id AND status='approved'", 'WHERE id=p_item AND campaign_id=campaign.id', 'Guard failed: unapproved item')
# Both public entry and the locked snapshot require the active campaign.
closed = original.replace("AND status='active'", '').replace("WHERE id=p_campaign AND status='active'", 'WHERE id=p_campaign')
cases.append(('allow-closed-campaign', closed, 'Guard failed: closed campaign completed output'))
mutate('ignore-packet', "IF packet IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'workspaceId',workspace,'campaignId',campaign,'fieldId',p_field,'sourceText',source_text,'targetLanguage',p_locale) THEN", 'IF false THEN', 'Guard failed: wrong packet identity')
mutate('ignore-creation-source', "IF actual IS DISTINCT FROM p_snapshot THEN", 'IF false THEN', 'Guard failed: changed creation source')
mutate('ignore-worker-source', "IF actual IS DISTINCT FROM public_request.source_snapshot OR actual->>'workspaceId' IS DISTINCT FROM request.workspace_id::text THEN", 'IF false THEN', 'Guard failed: changed source before dispatch')
mutate('ignore-public-read-source', 'IF saved.source_snapshot IS DISTINCT FROM source THEN', 'IF false THEN', 'Guard failed: changed public read')
mutate('ignore-request-share-token', "AND campaign_id=(source->>'campaignId')::uuid AND share_token_hash=encode(extensions.digest(p_share_token,'sha256'),'hex');", "AND campaign_id=(source->>'campaignId')::uuid;", 'Guard failed: replaced token old request')
mutate('staff-reader-public-request', "AND workspace_id=workspace AND authority_kind='staff';", 'AND workspace_id=workspace;', 'Guard failed: public request in staff reader')
mutate('staff-catalog-public-request', "AND r.workspace_id=workspace AND r.authority_kind='staff'", 'AND r.workspace_id=workspace', 'Public request leaked into staff catalog')
# Both claim and dispatch have this assignment; change only the claim definition.
needle = "allowance:=CASE WHEN request.authority_kind='public' THEN 30 ELSE 20 END;"
assert original.count(needle) == 2
cases.append(('public-allowance-too-large', original.replace(needle, "allowance:=CASE WHEN request.authority_kind='public' THEN 31 ELSE 20 END;", 1), 'Guard failed: public reservations exhausted'))
mutate('omit-reservations', 'IF recent_dispatches+active_reservations>=allowance THEN', 'IF recent_dispatches>=allowance THEN', 'Guard failed: public reservations exhausted')
mutate('wrong-dispatch-bucket', "job.id::text,CASE WHEN request.authority_kind='public' THEN 'engagement_public_translation' ELSE 'engagement_content_translation' END,1", "job.id::text,'engagement_content_translation',1", 'Public dispatch isolation or exactly-once metering failed')
mutate('ignore-attempt', 'IF p_attempt IS NULL OR job.attempt_id IS DISTINCT FROM p_attempt OR p_reservation IS NULL OR job.reservation_id IS DISTINCT FROM p_reservation THEN', 'IF false THEN', 'Guard failed: wrong dispatch attempt')
mutate('leak-public-dto', "'translated',CASE WHEN job.state='completed' THEN output.output_json::jsonb ELSE 'null'::jsonb END);", "'translated',CASE WHEN job.state='completed' THEN output.output_json::jsonb ELSE 'null'::jsonb END,'packet',job.packet_canonical);", 'Public DTO leaked private fields')
mutate('mutable-public-authority', 'CREATE TRIGGER public_translation_request_immutable BEFORE UPDATE OR DELETE', 'CREATE TRIGGER public_translation_request_immutable BEFORE DELETE', 'Guard failed: public authority immutable')
for role in ['anon', 'authenticated']:
    grant = f'\nGRANT SELECT ON engagement_public_translation_requests TO {role};\n'
    cases.append((f'harmless-{role}-grant-with-rls', original + grant, None))
    label = 'anonymous' if role == 'anon' else role
    cases.append((f'{role}-authority-leak', original + grant + f'CREATE POLICY synthetic_leak ON engagement_public_translation_requests FOR SELECT TO {role} USING(true);\n', f'Private public queue leak: {label} authority rows'))
cases.append(('anonymous-direct-command', original + '\nGRANT EXECUTE ON FUNCTION public.read_public_translation_request(uuid,text,uuid,jsonb) TO anon;\n', 'Guard failed: anonymous direct RPC'))

mutate('foreign-public-credential', "p_credential->>'workspaceId' IS DISTINCT FROM workspace::text", 'false', 'Guard failed: foreign public credential')
mutate('mix-public-staff-reservations', 'AND r.authority_kind=request.authority_kind', '', 'Translation dispatch allowance reserved')
mutate('ignore-staff-source', 'PERFORM assert_translation_generation_source(request.campaign_id,request.locale,job.address);', 'NULL;', 'Guard failed: source changed before claim')

mutate('omit-dispatch-allowance-recheck', 'IF recent_dispatches>=allowance THEN', 'IF false THEN', 'Guard failed: public dispatch allowance recheck')
mutate('blur-public-staff-identity', "((authority_kind='staff' AND actor_id IS NOT NULL) OR (authority_kind='public' AND actor_id IS NULL))", '(true)', 'Guard failed: public request cannot impersonate staff')
dedup = original.replace("AND locale=p_locale AND share_token_hash=token_hash AND source_snapshot=actual AND previous_request_id IS NOT DISTINCT FROM p_previous;", "AND false;")
dedup = dedup.replace("CREATE UNIQUE INDEX public_translation_root ON public.engagement_public_translation_requests(campaign_id,item_id,locale,share_token_hash,source_fingerprint) WHERE previous_request_id IS NULL;", "")
assert dedup != original
cases.append(('duplicate-public-work', dedup, 'Public replay duplicated work'))

mutate('retry-active-request', "IF previous_state NOT IN ('failed','interrupted','incomplete','cancelled') THEN", 'IF false THEN', 'Guard failed: completed request cannot be retried')
mutate('retry-without-predecessor', "IF p_previous IS NULL THEN RAISE EXCEPTION 'Public retry requires its original request' USING ERRCODE='22023'; END IF;", 'NULL;', 'Guard failed: retry needs predecessor')
mutate('lookup-wrong-locale', 'r.item_id=p_item AND r.locale=p_locale', 'r.item_id=p_item', 'Public lookup ignored locale')
mutate('lookup-failed-root', "NOT EXISTS(SELECT 1 FROM engagement_public_translation_requests next WHERE next.previous_request_id=r.request_id)", 'r.previous_request_id IS NULL', 'Public lookup stranded failed root')
mutate('retry-lookup-wrong-attempt', 'ELSE r.previous_request_id=p_previous END;', 'ELSE r.request_id=p_previous END;', 'Absent successor fabricated')
mutate('retry-foreign-item', 'request_id=p_previous AND campaign_id=campaign AND item_id=p_item\n   AND locale=p_locale AND share_token_hash=token_hash AND source_snapshot=actual;', 'request_id=p_previous;', 'Guard failed: retry predecessor item mismatch')
mutate('lookup-foreign-predecessor', "request_id=p_previous AND item_id=p_item\n   AND campaign_id=(source->>'campaignId')::uuid AND locale=p_locale AND source_snapshot=source\n   AND share_token_hash=encode(extensions.digest(p_share_token,'sha256'),'hex');", 'request_id=p_previous;', 'Guard failed: lookup predecessor item mismatch')

snapshot_guard = "IF p_snapshot IS NOT NULL AND source IS DISTINCT FROM p_snapshot THEN RAISE EXCEPTION 'Displayed public original changed' USING ERRCODE='PT409'; END IF;"
assert original.count(snapshot_guard) == 2
cases.append(('receipt-ignores-displayed-source', original.replace(snapshot_guard, 'NULL;', 1), 'Guard failed: receipt displayed source changed'))
left, right = original.rsplit(snapshot_guard, 1)
cases.append(('lookup-ignores-displayed-source', left + 'NULL;' + right, 'Guard failed: lookup displayed source changed'))

fixture_run = subprocess.run(['npm', 'exec', '--', 'tsx', str(review / 'generation-queue-fixture.ts')], cwd=review.parents[2] / 'openplan', capture_output=True, text=True, timeout=30)
assert fixture_run.returncode == 0, fixture_run.stderr
fixture = json.loads(fixture_run.stdout)
(private / 'staff-fixture.json').write_text(json.dumps(fixture, indent=2) + '\n')
staff_probe = (review / 'generation-queue-probe.sql').read_text()
probe += "\nSELECT set_config('openplan.queue_fixture',$fixture$" + json.dumps(fixture) + "$fixture$,true) IS NOT NULL;\n" + staff_probe

def custody():
    sql = "SELECT to_regclass('public.engagement_public_translation_requests') IS NULL AND NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='engagement_translation_generation_requests' AND column_name='authority_kind');"
    run = subprocess.run(base + ['-At', '-c', sql], text=True, capture_output=True, timeout=30)
    assert run.returncode == 0 and run.stdout.strip() == 't', (run.stdout, run.stderr)

custody()
results = []
for name, candidate, expected in cases:
    run = subprocess.run(base, input='BEGIN;\n' + candidate + '\n' + probe + '\nROLLBACK;\n', text=True, capture_output=True, timeout=30)
    output = run.stdout + run.stderr
    (private / (name + '.log')).write_text(output)
    correct = run.returncode == 0 and 'PUBLIC_QUEUE_PROBE_PASSED' in output and 'PUBLIC_RETRY_PROBE_PASSED' in output and '"queueProbePassed": true' in output and 'ROLLBACK' in run.stdout if expected is None else run.returncode != 0 and expected in output
    custody()
    results.append({'case': name, 'outcome': 'survived' if run.returncode == 0 else 'killed', 'expectedFailure': expected, 'expectedOutcome': correct, 'rollbackContained': True})
    (review / 'public-generation-queue-controls.json').write_text(json.dumps({'sourceSha256': hashlib.sha256(original.encode()).hexdigest(), 'composedProbeSha256': hashlib.sha256(probe.encode()).hexdigest(), 'publicProbeSha256': hashlib.sha256((review / 'public-generation-queue-probe.sql').read_bytes()).hexdigest(), 'staffProbeSha256': hashlib.sha256(staff_probe.encode()).hexdigest(), 'privateEvidence': str(private), 'results': results, 'limits': 'Uninstalled SQL candidate in a schema-only proof database. Serial transactions with synthetic unopenable credentials, not concurrent sessions, actual provider calls, worker journal recovery, HTTP or browser acceptance. Explicit SQL successor retry is exercised; HTTP/client recovery is not yet integrated.'}, indent=2) + '\n')
    print(name, results[-1]['outcome'], 'expected' if correct else 'UNEXPECTED', flush=True)
    assert correct, (name, expected, output[-3000:])
assert source.read_text() == original
