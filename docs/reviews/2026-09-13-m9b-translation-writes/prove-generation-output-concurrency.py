"""Reuse the held-transaction queue instrument, then deliver real codec bytes."""
from generation_schema_source import GenerationSection
from pathlib import Path
import hashlib,json,runpy,subprocess
review=Path(__file__).resolve().parent
ns=runpy.run_path(str(review/'prove-generation-queue-concurrency.py'))
f,job,private,app=ns['f'],ns['job'],ns['private'],ns['app']
f['binding']={'workspaceId':f['workspaceId'],'campaignId':f['campaignId'],'requestId':f['requestId'],'fieldId':job['id'],
 'attemptId':job['attempt_id'],'reservationId':job['reservation_id'],'credentialId':f['credential']['credentialId'],
 'configurationHash':f['credential']['configurationHash'],'packetHash':job['packet_hash'],'leaseExpiresAt':job['lease_expires_at']}
run=subprocess.run(['npm','exec','--','tsx',str(review/'generation-output-fixture.ts')],input=json.dumps(f),cwd=app,capture_output=True,text=True,timeout=30)
assert run.returncode==0,run.stderr
delivery=json.loads(run.stdout)['deliveries'][0]
(private/'delivery.json').write_text(json.dumps(delivery,indent=2)+'\n')
literal=ns['literal']
expression='retain_translation_generation_output('+','.join(map(literal,[job['id'],job['attempt_id'],delivery['status'],delivery['outputJson'],delivery['bindingCanonical'],delivery['providerMetadataJson'],delivery['digest']]))+')'
acks=ns['overlapping_calls'](expression,'output')
expected={'fieldId':job['id'],'attemptId':job['attempt_id'],'status':'completed','state':'completed','digest':delivery['digest']}
assert acks[0]==acks[1]==expected,acks
stored=json.loads(ns['must']("SELECT jsonb_build_object('status',status,'outputJson',output_json,'bindingCanonical',binding_canonical,'providerMetadataJson',provider_metadata_json,'digest',delivery_digest) FROM engagement_translation_generation_outputs WHERE field_id="+literal(job['id'])+';','output-readback'))
assert stored==delivery,'Database changed application codec bytes'
roundtrip=subprocess.run(['npm','exec','--','tsx',str(review/'generation-output-fixture.ts'),'--roundtrip'],input=json.dumps(stored),cwd=app,capture_output=True,text=True,timeout=30)
assert roundtrip.returncode==0,roundtrip.stderr
assert json.loads(roundtrip.stdout)==delivery,'Retained delivery cannot be decoded/re-encoded'
count=int(ns['must']('SELECT count(*) FROM usage_events WHERE workspace_id='+literal(f['workspaceId'])+';','output-event-count'))
assert count==1,count
report={'sourceSha256':hashlib.sha256(GenerationSection('output').read_bytes()).hexdigest(),
 'codecSha256':hashlib.sha256((app/'src/lib/engagement/translation-generation-delivery.ts').read_bytes()).hexdigest(),
 'database':'supabase_db_openplan-restore-target-2731143/openplan_translation_command_proof_20260913','privateEvidence':str(private),
 'requestId':f['requestId'],'fieldId':job['id'],'heldTransaction':True,'secondReturnedBusy':True,'sameAcknowledgement':True,
 'readbackEqualsCodecBytes':True,'codecRoundtrip':True,'dispatchEvents':count,
 'limits':'Synthetic encoded output with provider-supplied strings containing unsupported Unicode. Actual independent PostgreSQL transactions and native codec; no model invocation, worker process restart or HTTP/browser publication.'}
(review/'generation-output-concurrency.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
