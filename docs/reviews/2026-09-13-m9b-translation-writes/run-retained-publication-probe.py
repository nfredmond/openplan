"""Exercise migration 16 against actual retained output, with rollback containment."""
from pathlib import Path
import hashlib,json,subprocess,uuid
review=Path(__file__).resolve().parent;app=review.parents[2]/'openplan'
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913')
command=['docker','exec','-i','supabase_db_openplan-restore-target-2731143','psql','-X','-U','supabase_admin','-d','openplan_translation_command_proof_20260913','-qAt','-v','ON_ERROR_STOP=1']
def query(sql):return subprocess.run(command,input=sql,text=True,capture_output=True,timeout=20)
source=app/'supabase/migrations/20261014000016_engagement_translation_retained_publication.sql'
base=query("""SELECT jsonb_build_object('campaignId',r.campaign_id,'workspaceId',r.workspace_id,'actorId',r.actor_id,'fieldId',j.id,
 'entry',j.address||jsonb_build_object('generation',jsonb_build_object('requestId',r.id,'fieldId',j.id,'attemptId',j.attempt_id,'deliveryDigest',o.delivery_digest)),
 'words',o.output_json::jsonb#>>'{}','model',r.credential#>>'{configuration,modelId}','outputHash',o.binding_canonical::jsonb->>'outputHash','digest',o.delivery_digest,'providerMetadata',o.provider_metadata_json)
 FROM engagement_translation_generation_fields j JOIN engagement_translation_generation_requests r ON r.id=j.request_id JOIN engagement_translation_generation_outputs o ON o.field_id=j.id
 WHERE j.id='fc5f222b-4b82-4df9-9230-ae54d0dc3098';""")
assert base.returncode==0,base.stderr
f=json.loads(base.stdout);f.update({k:str(uuid.uuid4()) for k in ['publisher','viewer','outsider','writeRequest','secondWrite']})
original=query("SELECT md5(pg_get_functiondef('public.write_engagement_translations(uuid,uuid,text,text,text,jsonb)'::regprocedure)),has_function_privilege('authenticated','public.write_engagement_translations(uuid,uuid,text,text,text,jsonb)','EXECUTE');")
assert original.returncode==0,original.stderr
legacy=(review/'translation-command-probe.sql').read_text()
assert legacy.count('EXCEPTION WHEN feature_not_supported THEN')==1
legacy=legacy.replace('EXCEPTION WHEN feature_not_supported THEN','EXCEPTION WHEN invalid_parameter_value THEN').replace('Unfinished generation publication was not refused','Publication without a retained reference was not refused')
run=query("BEGIN;SET LOCAL statement_timeout='8s';\n"+(app/'supabase/migrations/20261014000014_engagement_translation_generation_reads.sql').read_text()+"\n"+source.read_text()+"\nSELECT set_config('openplan.publication_fixture',$fixture$"+json.dumps(f)+"$fixture$,true) IS NOT NULL;\n"+(review/'retained-publication-probe.sql').read_text()+"\n"+legacy+"\nROLLBACK;")
(private/'retained-publication-sql-latest.log').write_text(run.stdout+run.stderr)
after=query("SELECT md5(pg_get_functiondef('public.write_engagement_translations(uuid,uuid,text,text,text,jsonb)'::regprocedure)),has_function_privilege('authenticated','public.write_engagement_translations(uuid,uuid,text,text,text,jsonb)','EXECUTE');")
contained=query("SELECT to_regprocedure('public.retained_translation_publication(uuid,uuid,text,jsonb)') IS NULL AND to_regprocedure('public.read_translation_generation_request(uuid,uuid)') IS NULL AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id='"+f['publisher']+"') AND NOT EXISTS(SELECT 1 FROM engagement_translation_write_receipts WHERE request_id='"+f['writeRequest']+"');")
assert after.returncode==0 and after.stdout==original.stdout and contained.returncode==0 and contained.stdout.strip()=='t','Publication probe escaped rollback'
if run.returncode!=0 or 'PUBLICATION_PROBE_PASSED' not in run.stdout:print((run.stdout+run.stderr)[-5000:]);raise SystemExit(1)
generation=json.loads(next(line.removeprefix('PUBLICATION_GENERATION:') for line in run.stdout.splitlines() if line.startswith('PUBLICATION_GENERATION:')))
r=json.loads(next(line.removeprefix('PUBLICATION_RESULT:') for line in run.stdout.splitlines() if line.startswith('PUBLICATION_RESULT:')))
native=subprocess.run(['npm','exec','--','tsx',str(review/'retained-publication-native.ts')],cwd=app,input=json.dumps({'fixture':f,'result':r,'generation':generation}),text=True,capture_output=True,timeout=20)
(private/'retained-publication-native-latest.log').write_text(native.stdout+native.stderr)
assert native.returncode==0,'Native publication receipt failed: '+native.stderr
print(json.dumps({'passed':True,'rollbackContained':True,'migrationSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'requestId':r['requestId'],'revision':r['entries'][0]['revision'],'generation':r['entries'][0]['generation'],'wordsSha256':hashlib.sha256(r['entries'][0]['entry']['translated_text'].encode()).hexdigest(),'legacyManualCommands':True,'nativeReceipt':json.loads(native.stdout),'limits':'Actual retained positive output; cloned private rows isolate negative guards and identical-output history. No new model/worker run or browser publication.'}))
