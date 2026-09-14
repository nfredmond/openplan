"""Independent held-transaction resolution races in the disconnected proof DB."""
from pathlib import Path
import contextlib, hashlib, json, os, select, subprocess, time, uuid
review = Path(__file__).resolve().parent
app = review.parents[2] / 'openplan'
manifest = json.loads((review / 'translation-resolution-proof-database.json').read_text())
assert manifest['database'] == 'openplan_translation_resolution_proof_20260913'
assert manifest['container'] == 'supabase_db_openplan-restore-target-2026091050'
private = Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913') / ('resolution-concurrency-' + str(time.time_ns()))
private.mkdir(mode=0o700)
command = ['docker', 'exec', '-i', manifest['container'], 'psql', '-X', '-U', 'supabase_admin', '-d', manifest['database'], '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']
def q(value): return "'" + str(value).replace("'", "''") + "'"
def sql(statement, label):
 run = subprocess.run(command, input=statement, text=True, capture_output=True, timeout=12)
 (private / (label + '.log')).write_text(run.stdout + run.stderr)
 return {'code': run.returncode, 'out': run.stdout, 'error': run.stderr}
def must(statement, label):
 result = sql(statement, label)
 assert result['code'] == 0, (label, result['error'])
 return result['out'].strip()
def call(statement, label, commit=False):
 return sql("BEGIN; SET LOCAL statement_timeout='3s'; " + statement + ('COMMIT;' if commit else 'ROLLBACK;'), label)
def objects(result):
 assert result['code'] == 0, result['error']
 return [json.loads(line) for line in result['out'].splitlines() if line.startswith('{')]
def fixture(label):
 run = subprocess.run(['npm', 'exec', '--', 'tsx', str(review / 'generation-queue-fixture.ts')], cwd=app, text=True, capture_output=True, timeout=20)
 assert run.returncode == 0, run.stderr
 f = json.loads(run.stdout)
 w, c, a = [f[k] for k in ['workspaceId', 'campaignId', 'actorId']]
 statement = f"BEGIN; INSERT INTO auth.users(id,aud,role,email) VALUES({q(a)},'authenticated','authenticated',{q(a+'@resolution-race.invalid')});"
 statement += f"INSERT INTO workspaces(id,name,slug) VALUES({q(w)},'SYNTHETIC resolution race',{q(w)});"
 statement += f"INSERT INTO workspace_members(workspace_id,user_id,role) VALUES({q(w)},{q(a)},'owner');"
 statement += f"INSERT INTO engagement_campaigns(id,workspace_id,title,summary,created_by,default_content_locale) VALUES({q(c)},{q(w)},{q(f['source'])},{q(f['source'])},{q(a)},NULL);"
 statement += f"INSERT INTO workspace_integration_keys(workspace_id,provider,key_ciphertext,key_last4,configured_by) VALUES({q(w)},'anthropic',{q(f['keyCiphertext'])},'-KEY',{q(a)}); COMMIT;"
 must(statement, label+'-fixture')
 f['create'] = 'SET LOCAL ROLE service_role; SELECT create_translation_generation_request(' + ','.join(map(q, [f['requestId'], a, c, 'es', json.dumps(f['fields']), json.dumps(f['credential']), f['selectedKeyHash']])) + ');'
 f['resolutionId'] = str(uuid.uuid4())
 f['resolve'] = f"SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub',{q(a)},true); SELECT resolve_translation_generation_request(" + ','.join(map(q, [f['resolutionId'], f['requestId'], c, json.dumps('SYNTHETIC damaged\0\ud800 copy'), 'Resolve synthetic concurrent request'])) + ');'
 f['claim'] = 'SET LOCAL ROLE service_role; SELECT claim_translation_generation_field(' + q(f['fields'][0]['id']) + ');'
 return f
@contextlib.contextmanager
def held(statement, label):
 child = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
 observed = b''
 try:
  child.stdin.write(("BEGIN; SET LOCAL statement_timeout='5s'; " + statement + "SELECT 'RESOLUTION_RACE_READY';\n").encode()); child.stdin.flush()
  deadline = time.monotonic() + 8
  while b'RESOLUTION_RACE_READY' not in observed:
   assert child.poll() is None, label + ': first transaction ended before readiness'
   assert time.monotonic() < deadline, label + ': first transaction readiness expired'
   ready, _, _ = select.select([child.stdout], [], [], 0.1)
   if ready: observed += os.read(child.stdout.fileno(), 65536)
  (private / (label+'-held.log')).write_bytes(observed)
  yield child, objects({'code': 0, 'out': observed.decode()})
 finally:
  if child.poll() is None and child.stdin is not None:
   child.stdin.write(b'ROLLBACK;\n'); child.stdin.flush(); child.stdin.close(); child.stdin = None
  out, error = child.communicate(timeout=8)
  (private / (label+'-closed.log')).write_bytes(out+error)
  assert child.returncode == 0, (label, error.decode())
def finish(child, commit=True):
 assert child.poll() is None, 'Transaction ended before the competing operation returned'
 child.stdin.write(b'COMMIT;\n' if commit else b'ROLLBACK;\n'); child.stdin.flush(); child.stdin.close(); child.stdin = None
 child.wait(timeout=8)
 assert child.returncode == 0, 'Held transaction failed to finish'
def overlap(first, second, label, commit=True):
 with held(first, label) as (child, value):
  result = call(second, label+'-competing')
  assert result['code'] != 0 and 'PT503' in result['error'], label + ': must refuse overlap as busy'
  assert child.poll() is None, label + ': first lock was not held'
  finish(child, commit)
  return value[-1]
def run_case(kind, label):
 f = fixture(label)
 if kind == 'resolution-first':
  first = overlap(f['resolve'], f['create'], label)
  late = call(f['create'], label+'-late')
  assert late['code'] != 0 and 'PT409' in late['error'], label + ': must refuse late creation as resolved'
  replay = objects(call(f['resolve'], label+'-replay'))[-1]
  assert replay == {**first, 'replayed': True}, label + ': resolution replay changed'
 elif kind == 'create-first':
  overlap(f['create'], f['resolve'], label)
  receipt = objects(call(f['resolve'], label+'-resolution-retry', True))[-1]
  states = json.loads(receipt['resultText'])['fields']
  assert len(states) == 2 and all(x['previousState']=='queued' and x['state']=='cancelled' for x in states), label + ': committed creation not cancelled'
 elif kind == 'resolution-replay':
  first = overlap(f['resolve'], f['resolve'], label)
  assert objects(call(f['resolve'], label+'-retry'))[-1] == {**first, 'replayed': True}, label + ': replay changed'
 elif kind == 'resolution-rollback':
  overlap(f['resolve'], f['create'], label, False)
  ack = objects(call(f['create'], label+'-retry', True))[-1]
  assert ack['created'] is True, label + ': rollback left a tombstone'
  objects(call(f['resolve'], label+'-finish', True))
 else:
  objects(call(f['create'], label+'-create', True))
  if kind == 'resolution-before-claim':
   overlap(f['resolve'], f['claim'], label)
   result = call(f['claim'], label+'-retry')
   assert result['code'] == 0 and result['out'].strip() == '', label + ': cancelled field was claimed'
  else:
   if kind == 'claim-before-resolution':
    job = overlap(f['claim'], f['resolve'], label)
   else:
    job = objects(call(f['claim'], label+'-claim', True))[-1]
   dispatch = 'SET LOCAL ROLE service_role; SELECT authorize_translation_generation_dispatch(' + ','.join(map(q, [f['fields'][0]['id'], job['attempt_id'], job['reservation_id']])) + ');'
   if kind == 'dispatch-before-resolution': overlap(dispatch, f['resolve'], label)
   receipt = objects(call(f['resolve'], label+'-retry', True))[-1]
   field = json.loads(receipt['resultText'])['fields'][0]
   expected = 'interrupted' if kind == 'dispatch-before-resolution' else 'cancelled'
   assert field['state'] == expected and field['attemptId'] == job['attempt_id'], label + ': lost running uncertainty or attempt'
   state = objects(call(dispatch, label+'-late-dispatch'))[-1]
   assert state['state'] == expected, label + ': late dispatch revived resolution'
 return {'case': label, 'outcome': 'survived', 'requestId': f['requestId'], 'overlapRefused': True}

signatures = {'resolve': 'public.resolve_translation_generation_request(uuid,uuid,uuid,text,text)', 'create': 'public.create_translation_generation_request(uuid,uuid,uuid,text,jsonb,jsonb,text)'}
original = {key: must(f'SELECT pg_get_functiondef({q(signature)}::regprocedure);', 'original-'+key) for key, signature in signatures.items()}
results = []
cases = ['resolution-first', 'create-first', 'resolution-replay', 'resolution-rollback', 'resolution-before-claim', 'claim-before-resolution', 'dispatch-before-resolution']
try:
 for kind in cases: results.append(run_case(kind, 'baseline-'+kind)); print(results[-1]['case'], 'survived', flush=True)
 for key, body in original.items(): must(body+';\n-- Harmless concurrency comment.', 'harmless-'+key)
 for kind in cases: results.append(run_case(kind, 'harmless-'+kind)); print(results[-1]['case'], 'survived', flush=True)
 for key, body in original.items(): must(body+';', 'restore-before-fault-'+key)
 for key, old, new, kind, expected in [
  ('resolve', 'workspace:=lock_translation_generation_scope(p_campaign,actor);', 'SELECT workspace_id INTO workspace FROM engagement_campaigns WHERE id=p_campaign;', 'resolution-first', 'must refuse overlap as busy'),
  ('create', 'workspace:=lock_translation_generation_scope(p_campaign,p_actor);', 'SELECT workspace_id INTO workspace FROM engagement_campaigns WHERE id=p_campaign;', 'resolution-first', 'must refuse overlap as busy'),
  ('create', 'IF EXISTS(SELECT 1 FROM engagement_translation_generation_resolutions', 'IF false AND EXISTS(SELECT 1 FROM engagement_translation_generation_resolutions', 'resolution-first', 'must refuse late creation as resolved'),
 ]:
  label = 'fault-'+key+('-lock' if 'lock_translation' in old else '-tombstone')
  assert original[key].count(old)==1
  must(original[key].replace(old,new)+';', label+'-install')
  try:
   run_case(kind, label)
  except AssertionError as error:
   assert expected in str(error), (label, 'unexpected failure', str(error))
   results.append({'case': label, 'outcome': 'killed', 'failure': str(error)})
   print(label, 'killed', flush=True)
  else: raise AssertionError(label+': targeted fault survived')
  finally: must(original[key]+';', label+'-restore')
finally:
 for key, body in original.items(): must(body+';', 'final-restore-'+key)
 restored = all(must(f'SELECT pg_get_functiondef({q(signature)}::regprocedure);', 'final-definition-'+key)==original[key] for key,signature in signatures.items())
 assert restored
 state = must("SELECT coalesce(json_object_agg(state,n),'{}'::json) FROM (SELECT state,count(*) n FROM engagement_translation_generation_fields GROUP BY state) counts;", 'final-field-states')
 assert not any(json.loads(state).get(s,0) for s in ['queued','reserved','running']), state
 (review / 'generation-resolution-concurrency.json').write_text(json.dumps({'database': manifest['database'], 'container': manifest['container'], 'privateEvidence': str(private), 'results': results, 'definitionsRestored': restored, 'terminalFieldCounts': json.loads(state), 'sourceSha256': manifest['candidateSha256'], 'limits': 'Independent live psql sessions on a disconnected schema-only database. Actual transaction readiness and liveness checked; no provider, worker, browser or HTTP invocation. Synthetic records retained. Fault competitors roll back even if erroneously accepted; failed held transactions roll back.'}, indent=2)+'\n')
