"""Probe real SQL behavior under one harmless and targeted publication mutations."""
from pathlib import Path
import hashlib,json,subprocess,time
review=Path(__file__).resolve().parent;app=review.parents[2]/'openplan'
source=app/'supabase/migrations/20261014000016_engagement_translation_retained_publication.sql'
original=source.read_text();cases=[('baseline',original,None),('harmless',original+'\n-- Harmless publication control.\n',None)]
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/retained-publication-controls')/time.strftime('%Y%m%dT%H%M%S');private.mkdir(parents=True)
def mutate(name,old,new,expected):
 assert original.count(old)==1,(name,original.count(old),old)
 cases.append((name,original.replace(old,new),expected))
start=original.index(" IF jsonb_typeof(ref)");end=original.index(" END IF;",start)+len(" END IF;")
mutate('reference-validation',original[start:end]," -- Reference validation removed.",'malformed reference or supplied text')
mutate('ref-extras',"OR EXISTS(SELECT 1 FROM jsonb_object_keys(ref) k WHERE k NOT IN ('requestId','fieldId','attemptId','deliveryDigest'))",'OR false','malformed reference or supplied text')
mutate('ref-digest-shape',"OR ref->>'deliveryDigest' !~ '^[a-f0-9]{64}$'",'OR false','malformed reference or supplied text')
mutate('request-id',"job.request_id IS DISTINCT FROM (ref->>'requestId')::uuid OR",'false OR','wrong request identity')
mutate('attempt-id',"job.attempt_id IS DISTINCT FROM (ref->>'attemptId')::uuid",'false','wrong attempt identity')
mutate('field-id',"WHERE id=(ref->>'fieldId')::uuid;","WHERE id='fc5f222b-4b82-4df9-9230-ae54d0dc3098';",'missing field identity')
mutate('scope-campaign','request.campaign_id IS DISTINCT FROM p_campaign OR','false OR','campaign retained output')
mutate('scope-workspace','request.workspace_id IS DISTINCT FROM p_workspace OR','false OR','workspace retained output')
mutate('scope-locale','request.locale IS DISTINCT FROM p_locale','false','locale retained output')
mutate('original-baseline',"job.address IS DISTINCT FROM (p_entry-'generation')",'false','source retained output')
mutate('original-saved-baseline',"job.address IS DISTINCT FROM (p_entry-'generation')","(job.address-'expectedTranslation') IS DISTINCT FROM (p_entry-'generation'-'expectedTranslation')",'rebased old generation')
mutate('delivery-digest',"output.delivery_digest IS DISTINCT FROM ref->>'deliveryDigest'",'false','wrong delivery identity')
mutate('job-state',"job.state<>'completed' OR",'false OR','job_state retained output')
mutate('output-status',"output.status<>'completed' OR",'false OR','output_status retained output')
mutate('accepted-state',"output.accepted_state<>'completed'",'false','accepted_state retained output')
mutate('output-hash',"OR output.binding_canonical::jsonb->>'outputHash' IS DISTINCT FROM encode(extensions.digest(words,'sha256'),'hex')",'OR false','hash retained output')
mutate('model',"OR output.binding_canonical::jsonb->>'model' IS DISTINCT FROM model",'OR false','model retained output')
mutate('nonblank',"OR translation_source_compatibility_hash(words)=translation_source_compatibility_hash('')",'OR false','blank retained output')
mutate('unicode-blank-reason',"translation_source_compatibility_hash(p_reason)=translation_source_compatibility_hash('')","NULLIF(btrim(p_reason),'') IS NULL",'blank publication reason')
mutate('submitted-words',"OR (p_operation<>'save' AND e ? 'text')",'OR false','malformed reference or supplied text')
mutate('publisher-row',"VALUES(campaign.workspace_id,p_campaign,entry->>'entityType',target_entity_id,entry->>'field',p_locale,publication->>'words','machine',publication->>'model',\n     translation_source_compatibility_hash(actual_source->>'text'),auth.uid())", "VALUES(campaign.workspace_id,p_campaign,entry->>'entityType',target_entity_id,entry->>'field',p_locale,publication->>'words','machine',publication->>'model',\n     translation_source_compatibility_hash(actual_source->>'text'),(publication#>>'{generation,actorId}')::uuid)",'Retained publication lost words authorship or reference')
mutate('generation-actor',"'actorId',request.actor_id", "'actorId',auth.uid()",'Retained publication lost words authorship or reference')
mutate('exact-words',"p_locale,publication->>'words','machine'","p_locale,btrim(publication->>'words'),'machine'",'Retained publication lost words authorship or reference')
mutate('reference-receipt',"jsonb_build_object('generation',publication->'generation')", "'{}'::jsonb",'Retained publication lost words authorship or reference')
mutate('identical-history',"IF p_operation='publish_generated' AND has_previous AND revision=(expected->>'revision')::bigint THEN",'IF false THEN','Identical new generation lost revision')
mutate('helper-private','REVOKE ALL ON FUNCTION public.retained_translation_publication(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;','GRANT EXECUTE ON FUNCTION public.retained_translation_publication(uuid,uuid,text,jsonb) TO authenticated;','Private publication helper exposed for execution')
mutate('command-disabled','REVOKE ALL ON FUNCTION public.write_engagement_translations(uuid,uuid,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;','-- Premature activation.','Publication migration prematurely enabled command')
mutate('current-key-required'," RETURN jsonb_build_object('words',words", " PERFORM assert_translation_generation_selection(request.workspace_id,request.credential,request.selected_key_ciphertext_hash);\n RETURN jsonb_build_object('words',words",'Retained publication must succeed without current key or generating membership')
mutate('generating-membership-required'," RETURN jsonb_build_object('words',words", " PERFORM lock_translation_generation_scope(request.campaign_id,request.actor_id);\n RETURN jsonb_build_object('words',words",'Retained publication must succeed without current key or generating membership')
results=[]
try:
 for name,body,expected in cases:
  assert source.read_text()==original;source.write_text(body)
  try:run=subprocess.run(['python3',str(review/'run-retained-publication-probe.py')],cwd=app,text=True,capture_output=True,timeout=30)
  finally:source.write_text(original)
  output=run.stdout+run.stderr;(private/(name+'.log')).write_text(output)
  correct=run.returncode==0 and '"rollbackContained": true' in output if expected is None else run.returncode!=0 and expected in output
  results.append({'case':name,'outcome':'survived' if run.returncode==0 else 'killed','expectedFailure':expected,'expectedOutcome':correct})
  (review/'retained-publication-controls.json').write_text(json.dumps({'migrationSha256':hashlib.sha256(original.encode()).hexdigest(),'probeSha256':hashlib.sha256((review/'retained-publication-probe.sql').read_bytes()).hexdigest(),'privateEvidence':str(private),'results':results,'limits':'SQL-only write boundary, actual retained output and crafted private rows for independent failure conditions. All probes rolled back; no UI, new worker/model run or concurrent publication evidence.'},indent=2)+'\n')
  print(name,results[-1]['outcome'],'expected' if correct else 'UNEXPECTED',flush=True)
  assert correct,name
finally:assert source.read_text()==original
