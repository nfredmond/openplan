"""Run the portable live suite against temporary, restored SQL guard faults.

Only the named disposable stack is touched. Requests produced by the suite are
terminal before commit and remain as synthetic immutable evidence.
"""
from pathlib import Path
import hashlib, json, os, subprocess, time
review=Path(__file__).resolve().parent; app=review.parents[2]/'openplan'
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913')/('portable-read-controls-'+str(time.time_ns()));private.mkdir(mode=0o700)
container='supabase_db_openplan-restore-target-2026091050'
command=['docker','exec','-i',container,'psql','-X','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1']
def sql(statement):
 r=subprocess.run(command,input=statement,text=True,capture_output=True,timeout=12);assert r.returncode==0,r.stderr;return r.stdout.strip()
signature='public.lock_translation_generation_read_scope(uuid,uuid)'
original=sql(f"SELECT pg_get_functiondef('{signature}'::regprocedure);")
write_signature='public.create_translation_generation_request(uuid,uuid,uuid,text,jsonb,jsonb,text)'
write_original=sql(f"SELECT pg_get_functiondef('{write_signature}'::regprocedure);")
acl_query="SELECT string_agg(p.oid::regprocedure::text||':'||p.proacl::text,E'\\n' ORDER BY p.oid) FROM pg_proc p WHERE p.oid IN ('public.read_translation_generation_request(uuid,uuid)'::regprocedure,'public.list_translation_generation_requests(uuid,timestamptz,uuid)'::regprocedure,'public.lock_translation_generation_read_scope(uuid,uuid)'::regprocedure);"
original_acl=sql(acl_query)
read_signatures='public.read_translation_generation_request(uuid,uuid), public.list_translation_generation_requests(uuid,timestamptz,uuid)'
restore_grants=f'REVOKE EXECUTE ON FUNCTION {read_signatures}, {signature} FROM anon; REVOKE EXECUTE ON FUNCTION {signature} FROM authenticated;'
cases=[('baseline',original,None,None),('harmless',original+'\n-- Harmless portable concurrency control.\n',None,None)]
def mutate(name,old,new,expected,filter=None):
 assert original.count(old)==1,(name,original.count(old));cases.append((name,original.replace(old,new),expected,filter))
mutate('exclusive-reader', 'pg_try_advisory_xact_lock_shared(', 'pg_try_advisory_xact_lock(', ['detail readers coexist','catalog readers coexist'], 'readers coexist')
mutate('exclusive-campaign-reader','WHERE id=p_campaign FOR SHARE NOWAIT;', 'WHERE id=p_campaign FOR UPDATE NOWAIT;', ['detail readers coexist'], 'detail readers coexist')
mutate('omit-source-lock', "IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('engagement-response:'||p_campaign::text,0)) THEN",'IF false THEN',['source changes exclude'], 'source changes exclude')
mutate('omit-campaign-lock','WHERE id=p_campaign FOR SHARE NOWAIT;', 'WHERE id=p_campaign;', ['campaign changes exclude'], 'campaign changes exclude')
mutate('omit-membership-lock', "AND role IN ('owner','admin','member') FOR SHARE NOWAIT)", "AND role IN ('owner','admin','member'))", ['membership changes exclude'], 'membership changes exclude')
cases.append(('allow-viewer',original.replace("IN ('owner','admin','member')", "IN ('owner','admin','member','viewer')"), ['viewer cannot read','revoked staff access refuses'], 'viewer cannot read|revoked staff access refuses'))
bypass=original.replace('IF p_actor IS NULL OR NOT EXISTS','IF false AND NOT EXISTS').replace('IF NOT FOUND OR NOT EXISTS','IF false AND NOT EXISTS')
cases.append(('allow-outsider',bypass,['outsider cannot read'],'outsider cannot read'))
cases.append(('allow-anonymous',bypass+f';\nGRANT EXECUTE ON FUNCTION {read_signatures} TO anon;', ['anonymous cannot read'], 'anonymous cannot read'))
cases.append(('allow-helper',original+f';\nGRANT EXECUTE ON FUNCTION {signature} TO authenticated;', ['callers cannot invoke'], 'callers cannot invoke'))
old='workspace:=lock_translation_generation_scope(p_campaign,p_actor);';assert write_original.count(old)==1
cases.append(('unlocked-write-replay',write_original.replace(old,'SELECT workspace_id INTO workspace FROM engagement_campaigns WHERE id=p_campaign;'), ['a retained reader excludes generation writes'], 'a retained reader excludes generation writes'))
results=[]
try:
 for name,body,expected,filter in cases:
  sql('BEGIN;\n'+body+'\n;\nCOMMIT;')
  target=private/(name+'.json');args=['npm','exec','--','vitest','run','src/test/engagement-translation-read-concurrency.test.ts','--reporter=json','--outputFile='+str(target)]
  if filter:args+=['-t',filter]
  try:
   run=subprocess.run(args,cwd=app,env={**os.environ,'OPENPLAN_RLS_LIVE_TEST':'1','OPENPLAN_SUPABASE_WORKDIR':'/home/nathaniel/.local/state/openplan/openplan-restore-target-2026091050'},text=True,capture_output=True,timeout=60)
  finally:sql('BEGIN;\n'+original+';\n'+write_original+';\n'+restore_grants+'COMMIT;')
  (private/(name+'.log')).write_text(run.stdout+run.stderr)
  report=json.loads(target.read_text());failed=[a['fullName'] for s in report['testResults'] for a in s['assertionResults'] if a['status']=='failed']
  correct=run.returncode==0 and report['numPassedTests']==11 if expected is None else run.returncode!=0 and all(any(e in f for f in failed) for e in expected)
  results.append({'case':name,'outcome':'survived' if run.returncode==0 else 'killed','expectedFailures':expected,'failedTests':failed,'expectedOutcome':correct});print(name,results[-1]['outcome'],flush=True);assert correct,(name,failed)
finally:
 sql('BEGIN;\n'+original+';\n'+write_original+';\n'+restore_grants+'COMMIT;')
 restored=sql(f"SELECT pg_get_functiondef('{signature}'::regprocedure);")==original and sql(f"SELECT pg_get_functiondef('{write_signature}'::regprocedure);")==write_original and sql(acl_query)==original_acl
 assert restored,'Installed SQL or grants were not restored'
 report={'sourceSha256':hashlib.sha256((app/'supabase/migrations/20261014000018_engagement_translation_shared_reads.sql').read_bytes()).hexdigest(),'testSha256':hashlib.sha256((app/'src/test/engagement-translation-read-concurrency.test.ts').read_bytes()).hexdigest(),'privateEvidence':str(private),'results':results,'functionsAndGrantsRestored':restored,'limits':'Portable Vitest live tests against actual independent PostgreSQL sessions on the named disposable stack. SQL faults restored between runs. Synthetic requests are cancelled before commit and retained; no model calls, real staff data or browser operations. Does not measure high-volume performance or complete release readiness.'}
 (review/'portable-translation-read-controls.json').write_text(json.dumps(report,indent=2)+'\n')
