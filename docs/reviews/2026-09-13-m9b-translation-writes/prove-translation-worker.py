"""Mutation controls for real private journal/lock and mocked database/adapter.

Run only in the owned idle checkout. No provider calls, live database, browser or
process restart is established by this instrument. Per-case failures must name an
actual failed assertion; syntax errors cannot count as a killed mutation.
"""
from pathlib import Path
import hashlib,json,subprocess,time
review=Path(__file__).resolve().parent
app=review.parents[2]/'openplan'
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/worker-controls')/time.strftime('%Y%m%dT%H%M%S')
private.mkdir(parents=True,exist_ok=False)
paths={'worker':app/'src/lib/engagement/translation-generation-worker.ts','workspace':app/'src/lib/integrations/workspace-keys.ts'}
original={k:p.read_text() for k,p in paths.items()}
cases=[('baseline','worker',original['worker'],None)]
for k in paths: cases.append(('harmless-'+k,k,original[k]+'\n// Harmless worker custody control.\n',None))
def mutate(name,k,old,new,expected):
 assert original[k].count(old)==1,(name,old,original[k].count(old))
 cases.append((name,k,original[k].replace(old,new,1),expected))
w='worker';c='workspace'
mutate('journal-before-dispatch',w,'await writeConnectorJournal(args.directory, { version: 1, target, phase: "running", job });','void job;','claims with exact projections')
mutate('journal-before-delivery',w,'await writeConnectorJournal(args.directory, { version: 1, target, phase: "completed", job, delivery });','void delivery;','claims with exact projections')
mutate('forget-recovered-output',w,'pending.phase === "completed" ? pending.delivery :','false ? pending.delivery :','replays only saved bytes')
mutate('retry-running-as-new',w,'if (pending?.phase === "delivered") pending = null;','if (pending) pending = null;','recovers a running journal')
mutate('ignore-target',w,'if (pending && pending.target !== target) failure();','void target;','refuses moving a pending journal')
mutate('ignore-journal-hash',w,'createHash("sha256").update(job.packetCanonical).digest("hex") !== job.binding.packetHash','false','refuses a changed pending packet')
mutate('skip-preclaim-key',w,'try { await verify(); }','try { /* skipped key check */ }','refuses an environment-key change before_claim')
mutate('skip-dispatch-key',w,'        await verify();','        /* skipped key recheck */','refuses an environment-key change after_claim')
mutate('dispatch-ack-error',w,'rpcError(authorized.error);','void authorized.error;','does not invoke after dispatch acknowledgement loss')
# A syntactically valid null acknowledgement still fails schema parsing, so this
# single guard is redundant. Demonstrate that redundancy as a survivor instead.
cases.pop()
cases.append(('dispatch-error-schema-control',w,original[w].replace('rpcError(authorized.error);','void authorized.error;'),None))
for key,old in [('fieldId','ack.fieldId !== field.id ||'),('attemptId','ack.attemptId !== field.attempt_id ||'),('reservationId','ack.reservationId !== field.reservation_id ||'),('state','ack.state !== "running" ||'),('leaseExpiresAt','Date.parse(ack.leaseExpiresAt) !== Date.parse(field.lease_expires_at)')]:
 mutate('dispatch-'+key,w,old,'false ||' if old.endswith('||') else 'false','does not invoke after a changed dispatch '+key)
for key,old in [('fieldId','ack.fieldId !== job.binding.fieldId ||'),('attemptId','ack.attemptId !== job.binding.attemptId ||'),('status','ack.status !== value.status ||'),('digest','ack.digest !== value.digest')]:
 mutate('delivery-'+key,w,old,'false ||' if old.endswith('||') else 'false','preserves output after a changed delivery acknowledgement '+key)
mutate('cancel-observer',w,'current.state !== "running" ||','false ||','aborts the provider when status becomes cancelled')
mutate('failed-status-read',w,'} catch { cancelled.abort(); }','} catch { /* ignored */ }','aborts the provider when status becomes read_failure')
mutate('status-lease-change',w,'Date.parse(current.leaseExpiresAt) !== Date.parse(job.binding.leaseExpiresAt) ||','false ||','aborts the provider when status becomes lease_changed')
cases.append(('claimed-identity-schema-control',w,original[w].replace('field.id !== candidate.id ||','false ||'),None))
body=original[w].replace('field.id !== candidate.id ||','false ||').replace('packet.fieldId !== job.binding.fieldId ||','false ||')
cases.append(('claimed-identity-combined',w,body,'refuses a changed claimed id'))
mutate('claimed-packet',w,'field.packet_canonical !== candidate.packet_canonical ||','false ||','refuses a changed claimed packet_canonical')
# checkedJob also rejects the changed packet, so the overlap must survive.
cases.pop();cases.append(('claimed-packet-schema-control',w,original[w].replace('field.packet_canonical !== candidate.packet_canonical ||','false ||'),None))
mutate('received-source',w,'result.receipt.sourceHash !== createHash("sha256").update(packet.sourceText).digest("hex")','false','refuses generated output with changed receipt sourceHash')
mutate('received-language',w,'result.receipt.targetLanguage !== packet.targetLanguage ||','false ||','refuses generated output with changed receipt targetLanguage')
mutate('received-model',w,'result.receipt.model !== job.model ||','false ||','refuses generated output with changed receipt model')
mutate('received-binding',w,'!isDeepStrictEqual(binding, job.binding) ||','false ||','refuses generated output with changed receipt attemptId')
mutate('selection-digest',c,'selection.selectedKeyCiphertextHash !== selectedKeyCiphertextHash ||','false ||','refuses changed ciphertext before a queued dispatch')
mutate('selection-plaintext',c,'selection.apiKey !== original','false','refuses changed plaintext before a queued dispatch')
mutate('environment-plaintext',c,'selection.apiKey !== original','false','refuses changed environment before a queued dispatch')
mutate('captured-digest',c,'selectedKeyCiphertextHash: selection.selectedKeyCiphertextHash','selectedKeyCiphertextHash: null','captures the digest and envelope from one read')
results=[];count=None
try:
 for name,k,body,expected in cases:
  assert paths[k].read_text()==original[k]
  output=private/(name+'.json')
  paths[k].write_text(body)
  try:
   command=['npm','exec','--','vitest','run','src/test/translation-generation-worker.test.ts','src/test/translation-generation-credentials.test.ts','--reporter=json','--outputFile='+str(output)]
   if expected: command+=['-t',expected]
   run=subprocess.run(command,cwd=app,capture_output=True,text=True,timeout=45)
  finally: paths[k].write_text(original[k])
  (private/(name+'.log')).write_text(run.stdout+run.stderr)
  report=json.loads(output.read_text())
  failed=[a['fullName'] for suite in report['testResults'] for a in suite['assertionResults'] if a['status']=='failed']
  if count is None: count=report['numPassedTests'];assert count>=60
  correct=(run.returncode==0 and report['numPassedTests']==count) if expected is None else (run.returncode!=0 and any(expected in f for f in failed))
  results.append({'case':name,'outcome':'survived' if run.returncode==0 else 'killed','expectedFailure':expected,'failedAssertions':failed,'expectedOutcome':correct})
  (review/'translation-worker-controls.json').write_text(json.dumps({'sourceSha256':{k:hashlib.sha256(s.encode()).hexdigest() for k,s in original.items()},'testCount':count,'privateEvidence':str(private),'results':results,'limits':__doc__},indent=2)+'\n')
  print(name,results[-1]['outcome'],'expected' if correct else 'UNEXPECTED',flush=True)
  assert correct,(name,failed)
finally:
 for k,p in paths.items():assert p.read_text()==original[k]
