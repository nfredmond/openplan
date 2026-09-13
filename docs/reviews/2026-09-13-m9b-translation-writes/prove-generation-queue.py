"""Harmless and targeted failures of the rollback-only durable queue candidate."""
from pathlib import Path
import hashlib,json,subprocess,time
review=Path(__file__).resolve().parent
source=review/'generation-queue-candidate.sql'
original=source.read_text()
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/queue-controls')/time.strftime('%Y%m%dT%H%M%S')
private.mkdir(parents=True,exist_ok=False)
cases=[('baseline',original,None),('harmless-comment',original+'\n-- Harmless queue control.\n',None)]
stray_grant='\nGRANT SELECT ON engagement_translation_generation_requests,engagement_translation_generation_fields TO anon,authenticated;\n'
cases.append(('harmless-read-grant-with-rls',original+stray_grant,None))
def mutate(name,old,new,target):
 assert original.count(old)==1,(name,original.count(old),old)
 cases.append((name,original.replace(old,new,1),target))
# Probe actual private rows, not a read of an empty table before fixture creation.
for role in ('anon','authenticated'):
 for table,label in [('requests','request'),('fields','fields')]:
  cases.append((f'{role}-{table}-leak',original+stray_grant+f'CREATE POLICY synthetic_leak ON engagement_translation_generation_{table} FOR SELECT TO {role} USING(true);\n',f'Private queue leak: {"anonymous" if role=="anon" else role} {label}'))
cases.append(('anonymous-service-command',original+'\nGRANT EXECUTE ON FUNCTION create_translation_generation_request(uuid,uuid,uuid,text,jsonb,jsonb,text) TO anon;\n','Guard failed: anonymous queue command'))
body=original.replace("m.role IN ('owner','admin','member')",'true').replace("role IN ('owner','admin','member') FOR SHARE NOWAIT",'true FOR SHARE NOWAIT')
cases.append(('viewer-queue',body,'Guard failed: viewer queue'))
mutate('changed-request-replay','IF saved.intent IS DISTINCT FROM intent THEN','IF false THEN','Guard failed: changed request retry')
mutate('foreign-credential',"p_credential->>'workspaceId' IS DISTINCT FROM workspace::text",'false','Guard failed: foreign credential workspace')
mutate('ignore-current-key',"p_selected_hash IS DISTINCT FROM encode(extensions.digest(selected.key_ciphertext,'sha256'),'hex')",'false','Guard failed: changed key before queue')
mutate('source-conflict',"actual IS DISTINCT FROM p_address->'expectedSource'",'false','Guard failed: source changed before claim')
mutate('translation-version-conflict',"IF expected IS DISTINCT FROM p_address->'expectedTranslation' THEN",'IF false THEN','Guard failed: translation version changed before claim')
old="(SELECT count(*) FROM jsonb_array_elements(p_fields))<>(SELECT count(DISTINCT (e#>>'{address,entityType}',e#>>'{address,entityId}',e#>>'{address,field}')) FROM jsonb_array_elements(p_fields) e)"
mutate('duplicate-addresses',old,'false','Guard failed: duplicate addresses with distinct field identities')
mutate('packet-content',"IF packet IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'workspaceId',workspace,'campaignId',p_campaign,'fieldId',(entry->>'id')::uuid,\n    'sourceText',actual->>'text','targetLanguage',p_locale) THEN",'IF false THEN','Guard failed: packet differs from source')
mutate('forget-exact-packet',"entry->'address',entry->>'packetCanonical');", "entry->'address',(entry->>'packetCanonical')::jsonb::text);",'Queue source custody or unspent state failed')
mutate('wrong-dispatch-attempt','job.attempt_id IS DISTINCT FROM p_attempt OR p_reservation IS NULL','false OR p_reservation IS NULL','Guard failed: wrong attempt')
mutate('change-running-attempt','OLD.attempt_id IS NOT NULL AND ROW(NEW.attempt_id','false AND ROW(NEW.attempt_id','Guard failed: attempt immutable')
mutate('rewrite-request',"BEGIN RAISE EXCEPTION 'Generation requests are retained unchanged' USING ERRCODE='23514'; END",'BEGIN RETURN NEW; END','Guard failed: request immutable')
mutate('rewrite-packet','ROW(NEW.id,NEW.request_id,NEW.ordinal,NEW.address,NEW.packet_canonical) IS DISTINCT FROM','false AND ROW(NEW.id,NEW.request_id,NEW.ordinal,NEW.address,NEW.packet_canonical) IS DISTINCT FROM','Guard failed: packet immutable')
mutate('rewrite-terminal',"OLD.state IN ('completed','incomplete','failed','interrupted','cancelled') AND NEW IS DISTINCT FROM OLD",'false','Guard failed: terminal outcome immutable')
mutate('uninterrupt-expiry',"IF job.state IN ('reserved','running') AND job.lease_expires_at<=clock_timestamp() THEN\n  UPDATE engagement_translation_generation_fields SET state='interrupted',failure_code='translation_attempt_expired',finished_at=clock_timestamp() WHERE id=job.id;", "IF false THEN\n  UPDATE engagement_translation_generation_fields SET state='interrupted',failure_code='translation_attempt_expired',finished_at=clock_timestamp() WHERE id=job.id;",'Expired reservation was reclaimed')
mutate('ignore-held-reservations','IF recent_dispatches+active_reservations>=20 THEN','IF recent_dispatches>=20 THEN','Guard failed: reserved staff allowance')
mutate('ignore-dispatch-capacity','IF recent_dispatches>=20 THEN','IF false THEN','Guard failed: allowance consumed after reservation')
start=original.index('  INSERT INTO usage_events(workspace_id,event_key,bucket_key,weight,idempotency_key,source_route,metadata_json)')
end=original.index("  UPDATE engagement_translation_generation_fields SET state='running'",start)
cases.append(('no-dispatch-event',original[:start]+'  PERFORM 1;\n'+original[end:],'Dispatch retry or conservative usage evidence failed'))
mutate('claim-running-again',"IF job.state<>'queued' THEN PERFORM set_config('lock_timeout',old_timeout,true); RETURN NULL; END IF;",'IF false THEN RETURN NULL; END IF;','Generation identity or terminal outcome changed')
mutate('different-failure-replay','ELSIF job.state IS DISTINCT FROM p_state OR job.failure_code IS DISTINCT FROM p_code THEN','ELSIF false THEN','Guard failed: different failure replay')
mutate('status-key-change',"WHEN SQLSTATE 'PT409' THEN failure:='translation_source_or_key_changed';","WHEN SQLSTATE 'PT409' THEN failure:=NULL;",'Changed-key status or minimal disclosure failed')
mutate('status-extra-private-data',"'failureCode',job.failure_code,'leaseExpiresAt',job.lease_expires_at);", "'failureCode',job.failure_code,'leaseExpiresAt',job.lease_expires_at,'credential',request.credential);",'Changed-key status or minimal disclosure failed')

report=review/'generation-queue-controls.json'
results=[]
try:
 for name,body,target in cases:
  assert source.read_text()==original
  source.write_text(body)
  try: run=subprocess.run(['python3',str(review/'run-generation-queue-probe.py')],capture_output=True,text=True,timeout=45)
  finally: source.write_text(original)
  output=run.stdout+run.stderr
  (private/(name+'.log')).write_text(output)
  metadata=json.loads(output.splitlines()[0])
  expected=metadata['rollbackContained'] and ((run.returncode==0 and metadata['passed']) if target is None else (run.returncode!=0 and not metadata['passed'] and target in output))
  results.append({'case':name,'outcome':'survived' if run.returncode==0 else 'killed','expectedFailure':target,'expectedOutcome':expected,'rollbackContained':metadata['rollbackContained']})
  report.write_text(json.dumps({'sourceSha256':hashlib.sha256(original.encode()).hexdigest(),'privateEvidence':str(private),'results':results,
   'limits':'Rolled-back staff queue SQL with real application-generated packets and encrypted synthetic credentials. Serial probe, not concurrent claimants, a live worker, completed generation delivery, public queue dispatch or HTTP/browser acceptance.'},indent=2)+'\n')
  print(name,results[-1]['outcome'],'expected' if expected else 'UNEXPECTED',flush=True)
  assert expected,(name,target,output[-3000:])
finally: source.write_text(original)
