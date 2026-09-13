"""Prove byte retention and SQL/codec refusal boundaries with harmless controls."""
from generation_schema_source import GenerationSection
from pathlib import Path
import hashlib,json,subprocess,time
review=Path(__file__).resolve().parent
app=review.parents[2]/'openplan'
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/output-controls')/time.strftime('%Y%m%dT%H%M%S')
private.mkdir(parents=True,exist_ok=False)
paths={'sql':GenerationSection('output'),'codec':app/'src/lib/engagement/translation-generation-delivery.ts'}
originals={key:path.read_text() for key,path in paths.items()}
cases=[('sql-baseline','sql',originals['sql'],None),('sql-harmless','sql',originals['sql']+'\n-- Harmless output retention control.\n',None),
 ('sql-stray-read-grant','sql',originals['sql']+'\nGRANT SELECT ON engagement_translation_generation_outputs TO anon,authenticated;\n',None),
 ('codec-baseline','codec',originals['codec'],None),('codec-harmless','codec',originals['codec']+'\n// Harmless serialized-output control.\n',None)]
def mutation(name,key,old,new,target):
 assert originals[key].count(old)==1,(name,old,originals[key].count(old))
 cases.append((name,key,originals[key].replace(old,new,1),target))
for role in ['anon','authenticated']:
 cases.append((role+'-output-leak','sql',originals['sql']+f'\nGRANT SELECT ON engagement_translation_generation_outputs TO {role}; CREATE POLICY leak ON engagement_translation_generation_outputs FOR SELECT TO {role} USING(true);\n',('Anonymous' if role=='anon' else 'Authenticated')+' retained output leak'))
mutation('wrong-attempt','sql','job.attempt_id IS DISTINCT FROM p_attempt OR job.dispatch_authorized_at IS NULL','false OR job.dispatch_authorized_at IS NULL','Guard failed: wrong output attempt')
mutation('skip-delivery-digest','sql','IF p_digest IS DISTINCT FROM actual_digest THEN','IF false THEN','Guard failed: changed delivery digest')
mutation('ignore-bound-identity','sql',"(binding-ARRAY['outputHash','finishReason','inputTokens','outputTokens']) IS DISTINCT FROM expected",'false','Guard failed: foreign receipt campaign')
mutation('misclassify-complete','sql',"IF ((binding->>'finishReason'='stop' AND words IS NOT NULL AND length(words) BETWEEN 1 AND 8000\n  AND translation_source_compatibility_hash(words)<>translation_source_compatibility_hash('')) IS TRUE) IS DISTINCT FROM (p_status='completed') THEN",'IF false THEN','Guard failed: complete output marked incomplete')
# Normalizing JSON through JSONB destroys the intentionally retained invalid strings.
mutation('jsonb-output-coercion','sql','p_status,p_output_json,p_binding_canonical,p_provider_metadata_json,job.state)',"p_status,(p_output_json::jsonb)::text,p_binding_canonical,p_provider_metadata_json,job.state)",'Invalid generation delivery value')
mutation('jsonb-metadata-coercion','sql','p_status,p_output_json,p_binding_canonical,p_provider_metadata_json,job.state)',"p_status,p_output_json,p_binding_canonical,(p_provider_metadata_json::jsonb)::text,job.state)",'Invalid generation delivery value')
mutation('skip-scope-status','sql','PERFORM read_translation_generation_status(job.id,job.attempt_id);','PERFORM 1;','Late changed-scope output was discarded or reactivated')
mutation('discard-late-output','sql',"IF job.state='running' THEN\n   UPDATE", "IF job.state IN ('cancelled','interrupted') THEN RETURN jsonb_build_object('discarded',true); END IF;\n  IF job.state='running' THEN\n   UPDATE",'Late changed-scope output was discarded or reactivated')
mutation('lose-finish-state','sql','p_binding_canonical,p_provider_metadata_json,job.state) RETURNING * INTO saved;',"p_binding_canonical,p_provider_metadata_json,p_status) RETURNING * INTO saved;",'Late changed-scope output was discarded or reactivated')
mutation('rewrite-output','sql',"BEGIN RAISE EXCEPTION 'Generated output is retained unchanged' USING ERRCODE='23514'; END",'BEGIN RETURN NEW; END','Guard failed: output immutable')
mutation('coerce-replay-bytes','sql','saved.output_json IS DISTINCT FROM p_output_json','saved.output_json::jsonb IS DISTINCT FROM p_output_json::jsonb','Invalid generation delivery value')
# Digest and raw-byte checks are independently protective. This combined fault
# accepts a differently encoded replay while returning the original digest.
body=originals['sql'].replace('saved.output_json IS DISTINCT FROM p_output_json','false').replace('saved.delivery_digest IS DISTINCT FROM p_digest','false')
cases.append(('ignore-replay-bytes-and-digest','sql',body,'Guard failed: equivalent words changed retained bytes'))
mutation('strip-output-whitespace','codec','outputJson: JSON.stringify(result.output)','outputJson: JSON.stringify(result.output.trim())','retains exact output and unusual provider metadata')
mutation('drop-provider-id','codec','canonicalizeActionPayload({ responseId, reportedModel })','canonicalizeActionPayload({ responseId: null, reportedModel })','retains exact output and unusual provider metadata')
mutation('skip-output-hash','codec','if (sha256(result.output) !== result.receipt.outputHash)','if (false)','refuses a changed output hash or completeness claim')
mutation('skip-completeness','codec','if ((result.status === "completed") !== complete)','if (false)','refuses a changed output hash or completeness claim')
mutation('skip-codec-size','codec','Buffer.byteLength(value.outputJson + value.bindingCanonical + value.providerMetadataJson, "utf8") > 200000','false','refuses an oversized retained metadata record')
mutation('skip-codec-digest','codec','if (deliveryDigest(saved) !== saved.digest)','if (false)','refuses changed retained bytes even if')
mutation('skip-canonical-round-trip','codec','if (canonicalizeActionPayload(encodeTranslationGenerationDelivery(result)) !== canonicalizeActionPayload(saved))','if (false)','refuses changed retained bytes even if')
results=[];report=review/'generation-output-controls.json';baseline_count=None
try:
 for name,key,body,target in cases:
  assert paths[key].read_text()==originals[key]
  paths[key].write_text(body)
  try:
   if key=='sql':
    run=subprocess.run(['python3',str(review/'run-generation-output-probe.py')],capture_output=True,text=True,timeout=45)
    output=run.stdout+run.stderr
    info=json.loads(output.splitlines()[0])
    expected=info['rollbackContained'] and ((run.returncode==0 and info['passed']) if target is None else (run.returncode!=0 and not info['passed'] and target in output))
   else:
    result_path=private/(name+'.json')
    command=['npm','exec','--','vitest','run','src/test/translation-generation.test.ts','--reporter=json','--outputFile='+str(result_path)]
    if target: command+=['-t',target]
    run=subprocess.run(command,cwd=app,capture_output=True,text=True,timeout=45)
    output=run.stdout+run.stderr;info=json.loads(result_path.read_text())
    failed=[a['fullName'] for suite in info['testResults'] for a in suite['assertionResults'] if a['status']=='failed']
    if baseline_count is None: baseline_count=info['numPassedTests'];assert baseline_count>=35
    expected=run.returncode==0 and info['numPassedTests']==baseline_count if target is None else run.returncode!=0 and any(target in title for title in failed)
  finally: paths[key].write_text(originals[key])
  (private/(name+'.log')).write_text(output)
  results.append({'case':name,'outcome':'survived' if run.returncode==0 else 'killed','expectedFailure':target,'expectedOutcome':expected})
  report.write_text(json.dumps({'sourceSha256':{key:hashlib.sha256(value.encode()).hexdigest() for key,value in originals.items()},'privateEvidence':str(private),'results':results,
   'limits':'Application codec with intercepted SDK fetch and rolled-back PostgreSQL output delivery. No worker restart, live provider call, HTTP or browser publication. SQL treats provider metadata and unsupported output escapes as opaque text; the codec validates their reconstruction.'},indent=2)+'\n')
  print(name,results[-1]['outcome'],'expected' if expected else 'UNEXPECTED',flush=True)
  assert expected,(name,target,output[-2500:])
finally:
 for key,path in paths.items(): path.write_text(originals[key])
