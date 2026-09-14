"""Fault controls for resolution receipts and rolled-back candidate SQL.

The candidate is never installed. Each native test uses a disposable transaction
and restores all DDL, fixtures and corruption probes on connection exit.
"""
from pathlib import Path
import hashlib, json, os, re, subprocess, time
review = Path(__file__).resolve().parent
app = review.parents[2] / 'openplan'
paths = {
 'sql': app / 'supabase/migrations/20261014000019_engagement_translation_generation_resolution.sql',
 'schema': app / 'src/lib/engagement/translation-generation-resolution.ts',
 'server': app / 'src/lib/engagement/translation-generation-resolution-server.ts',
}
original = {key: path.read_text() for key, path in paths.items()}
tests = {'sql': 'src/test/translation-generation-resolution-live.test.ts', 'unit': 'src/test/translation-generation-resolution.test.ts'}
private = Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913') / ('generation-resolution-controls-' + str(time.time_ns()))
private.mkdir(mode=0o700)
cases = []
for key, body in original.items():
 cases += [('baseline-' + key, key, body, None), ('harmless-' + key, key, body + '\n// Harmless resolution control.\n' if key != 'sql' else body + '\n-- Harmless resolution control.\n', None)]
def mutate(name, key, old, new, expected):
 assert original[key].count(old) == 1, (name, original[key].count(old))
 cases.append((name, key, original[key].replace(old, new), expected))
mutate('allow-late-create', 'sql', 'IF EXISTS(SELECT 1 FROM engagement_translation_generation_resolutions', 'IF false AND EXISTS(SELECT 1 FROM engagement_translation_generation_resolutions', 'refuses a late create after resolving an absent request')
mutate('overwrite-replay', 'sql', 'IF saved.payload_json::jsonb IS DISTINCT FROM payload THEN', 'IF false THEN', 'refuses a different payload for the same resolution identity')
mutate('allow-other-requester', 'sql', 'IF existed AND (request.campaign_id', 'IF false AND (request.campaign_id', "refuses staff resolution of another actor's request")
mutate('leak-to-staff', 'sql', 'USING(actor_id=auth.uid() AND EXISTS', 'USING(EXISTS', 'hides receipt bytes from other staff and revoked original staff')
mutate('leak-to-service', 'sql', 'GRANT SELECT(request_id,campaign_id,workspace_id,actor_id)', 'GRANT SELECT', 'exposes only resolution metadata to the service role')
mutate('mutable-receipt', 'sql', 'FOR EACH ROW EXECUTE FUNCTION public.preserve_translation_generation_request();', 'FOR EACH ROW WHEN (false) EXECUTE FUNCTION public.preserve_translation_generation_request();', 'refuses direct receipt mutation even for the database owner')
mutate('retain-running', 'sql', "WHEN field.state='running' THEN 'interrupted'", "WHEN field.state='running' THEN 'cancelled'", 'interrupts dispatched work and retains late output without reviving it')
mutate('lose-inventory', 'sql', "IF jsonb_array_length(fields)<>jsonb_array_length(request.intent->'fields') THEN", 'IF false THEN', 'refuses an incomplete field inventory instead of confirming resolution')
mutate('ignore-missing-output', 'sql', "IF field.state IN ('completed','incomplete') AND NOT EXISTS", "IF false AND NOT EXISTS", 'refuses a claimed completed field without retained output')
mutate('cross-actor-tombstone', 'sql', 'WHERE request_id=p_request AND campaign_id=p_campaign AND actor_id=p_actor)', 'WHERE request_id=p_request AND campaign_id=p_campaign)', "does not let an absent resolution block another actor's request identity")
mutate('ignore-payload-binding', 'schema', 'canonicalizeActionPayload(payload) !== canonicalizeActionPayload({ schema: 1, ...scope, ...intent })', 'false', 'rejects a different payload copyJson even with valid digests')
mutate('ignore-result-binding', 'schema', 'canonicalizeActionPayload({ campaignId: result.campaignId, workspaceId: result.workspaceId, actorId: result.actorId }) !== canonicalizeActionPayload(scope)', 'false', 'rejects a different result actorId even with valid digests')
mutate('ignore-result-identity', 'schema', 'result.resolutionId !== intent.resolutionId || result.requestId !== intent.requestId', 'false', 'rejects a different result requestId even with valid digests')
mutate('ignore-field-inventory', 'schema', 'result.requestExisted !== (result.fields.length > 0) || new Set(result.fields.map(field => field.fieldId)).size !== result.fields.length', 'false', 'rejects incoherent outcome missing_fields')
mutate('ignore-state-transition', 'schema', 'field.state !== expected', 'false', 'rejects incoherent outcome revived_running')
mutate('ignore-output-loss', 'schema', '(["completed", "incomplete"].includes(field.previousState) && !field.outputRetained)', 'false', 'rejects incoherent outcome lost_output')
mutate('ignore-attempt-loss', 'schema', '(["reserved", "running", "completed", "incomplete"].includes(field.previousState) && field.attemptId === null)', 'false', 'rejects incoherent outcome lost_attempt')
mutate('ignore-queued-attempt', 'schema', '(field.previousState === "queued" && field.attemptId !== null)', 'false', 'rejects incoherent outcome queued_attempt')
mutate('ignore-opaque-encoding', 'schema', 'if (typeof decoded !== "string" || JSON.stringify(decoded) !== value || new TextEncoder().encode(value).length > GENERATION_RESOLUTION_COPY_LIMIT)', 'if (false)', 'refuses unsafe copy encoding {}')
mutate('ignore-reason-validity', 'schema', '.refine(value => value.trim().length > 0 && value.isWellFormed() && !value.includes("\\0"))', '', 'refuses an invalid reason "  "')
mutate('ignore-payload-hash', 'server', 'createHash("sha256").update(packet.payloadText).digest("hex") !== packet.payloadSha256', 'false', 'rejects a mismatched payloadSha256 before acknowledgement')
mutate('ignore-result-hash', 'server', 'createHash("sha256").update(packet.resultText).digest("hex") !== packet.resultSha256', 'false', 'rejects a mismatched resultSha256 before acknowledgement')
mutate('write-before-scope-validation', 'server', 'const scope = translationGenerationResolutionScopeSchema.parse(rawScope);', 'const scope = rawScope;', 'refuses an invalid scope before any write')
mutate('write-before-intent-validation', 'server', 'const intent = translationGenerationResolutionIntentSchema.parse(raw);', 'const intent = raw;', 'refuses an invalid intent before any write')
mutate('acknowledge-unchecked', 'server', 'return verifyTranslationGenerationResolution(response.data, scope, intent).packet;', 'return response.data;', 'does not acknowledge unchecked database output')
mutate('lose-refusal-kind', 'server', 'const code = response.error.code;', 'const code = "PT503";', 'preserves refusal 42501')
mutate('lose-replay-marker', 'sql', "'resultText',saved.result_json::text,'resultSha256',saved.result_sha256,'replayed',true)", "'resultText',saved.result_json::text,'resultSha256',saved.result_sha256,'replayed',false)", 'retains exact damaged bytes and replays the original receipt')
mutate('reject-second-copy', 'sql', 'CREATE INDEX translation_generation_resolved_request ON', 'CREATE UNIQUE INDEX translation_generation_resolved_request ON', 'preserves two distinct copies without rewriting the first')
mutate('lose-queued-cancellation', 'sql', "WHEN field.state IN ('queued','reserved') THEN 'cancelled'", "WHEN field.state IN ('queued','reserved') THEN field.state", 'cancels queued work and refuses its original creation replay')
mutate('erase-terminal-outcome', 'sql', "ELSE field.state END;", "ELSE 'cancelled' END;", 'preserves prior terminal failed outcome and attempt')
mutate('lose-incomplete-output-flag', 'sql', "'outputRetained',EXISTS(SELECT 1 FROM engagement_translation_generation_outputs WHERE field_id=field.id)", "'outputRetained',false", 'preserves incomplete output and the original request exactly')
policy = "USING(actor_id=auth.uid() AND EXISTS(SELECT 1 FROM public.workspace_members m\n  WHERE m.workspace_id=engagement_translation_generation_resolutions.workspace_id AND m.user_id=auth.uid() AND m.role IN ('owner','admin','member')));"
mutate('leak-receipts-to-outsider', 'sql', policy, 'USING(true);', 'hides retained receipts from outsider')
mutate('allow-anonymous-enumeration', 'sql', 'GRANT SELECT ON public.engagement_translation_generation_resolutions TO authenticated;', 'GRANT SELECT ON public.engagement_translation_generation_resolutions TO authenticated,anon;', 'denies anonymous receipt enumeration')
mutate('allow-direct-receipt-change', 'sql', 'GRANT SELECT ON public.engagement_translation_generation_resolutions TO authenticated;', 'GRANT SELECT,UPDATE ON public.engagement_translation_generation_resolutions TO authenticated;', 'denies direct authenticated receipt changes')
mutate('allow-service-resolution', 'sql', 'GRANT EXECUTE ON FUNCTION public.resolve_translation_generation_request(uuid,uuid,uuid,text,text) TO authenticated;', 'GRANT EXECUTE ON FUNCTION public.resolve_translation_generation_request(uuid,uuid,uuid,text,text) TO authenticated,service_role;', 'denies service invocation of the authenticated resolution command')
results = []
try:
 for name, key, body, expected in cases:
  assert all(p.read_text() == original[k] for k, p in paths.items())
  target = private / (name + '.json')
  args = ['npm', 'exec', '--', 'vitest', 'run', tests['sql' if key == 'sql' else 'unit'], '--reporter=json', '--outputFile=' + str(target)]
  if expected: args += ['-t', re.escape(expected)]
  paths[key].write_text(body)
  try:
   run = subprocess.run(args, cwd=app, env={**os.environ, 'OPENPLAN_RLS_LIVE_TEST': '1', 'OPENPLAN_TRANSLATION_RESOLUTION_CANDIDATE': '1', 'OPENPLAN_SUPABASE_WORKDIR': '/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050'}, text=True, capture_output=True, timeout=45)
  finally:
   paths[key].write_text(original[key])
  (private / (name + '.log')).write_text(run.stdout + run.stderr)
  report = json.loads(target.read_text())
  failed = [a['fullName'] for suite in report['testResults'] for a in suite['assertionResults'] if a['status'] == 'failed']
  correct = run.returncode == 0 and report['numPassedTests'] == (30 if key == 'sql' else 39) if expected is None else run.returncode != 0 and any(expected in test for test in failed)
  results.append({'case': name, 'outcome': 'survived' if run.returncode == 0 else 'killed', 'expectedFailure': expected, 'failedTests': failed, 'expectedOutcome': correct})
  print(name, results[-1]['outcome'], flush=True)
  assert correct, (name, failed, run.stderr)
finally:
 assert all(p.read_text() == original[k] for k, p in paths.items())
 (review / 'generation-resolution-controls.json').write_text(json.dumps({'sourceSha256': {k: hashlib.sha256(v.encode()).hexdigest() for k, v in original.items()}, 'testSha256': {k: hashlib.sha256((app / p).read_bytes()).hexdigest() for k, p in tests.items()}, 'privateEvidence': str(private), 'results': results, 'limits': 'Candidate SQL and synthetic records run only inside rolled-back transactions on the named disposable stack. Native output custody and unit receipt/server binding are exercised. No browser/API integration, simultaneous create/resolve, installed migration, full QA or release acceptance is established.'}, indent=2) + '\n')
