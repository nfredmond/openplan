"""Keep native concurrency fixtures in the disconnected decision proof database."""
from pathlib import Path
import hashlib,json,re,select,subprocess,time,uuid
ROOT=Path(__file__).resolve().parents[3]
REVIEW=Path(__file__).resolve().parent
CONTAINER='supabase_db_openplan-restore-target-2026091050'
DB='openplan_decision_link_proof_20260914'
MIGRATION=(ROOT/'openplan/supabase/migrations/20261014000023_engagement_public_copy_privacy.sql').read_text()
PRIVATE=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/decision-context')/('public-copy-concurrency-'+str(time.time_ns()))
PRIVATE.mkdir()
def args(db=DB):return ['docker','exec','-i',CONTAINER,'psql','-U','supabase_admin' if db==DB else 'postgres','-d',db,'-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
def sql(s,db=DB):return subprocess.run(args(db),input=s,text=True,capture_output=True,timeout=20)
def good(s,db=DB):
 r=sql(s,db);assert r.returncode==0,r.stderr;return r.stdout.strip()
def functions(db):
 names=re.findall(r'CREATE OR REPLACE FUNCTION public\.([a-z_]+)\(',MIGRATION)
 return good("SELECT jsonb_object_agg(proname,md5(pg_get_functiondef(oid))) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ("+','.join("'"+n+"'" for n in names)+");",db)
def fingerprint():
 return {t:good(f"SELECT count(*)||':'||md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY id),'')) FROM {t} t") for t in ['engagement_campaigns','engagement_items','engagement_item_history','engagement_closeloop_entries','engagement_response_history','engagement_report_jobs']}
assert good('SELECT current_database()')==DB
before=fingerprint()
if good("SELECT to_regclass('public.engagement_public_items') IS NULL")=='t':good('BEGIN;'+MIGRATION+'COMMIT;')
assert fingerprint()==before,'Definition activation changed retained source records'
assert functions(DB)==functions('postgres'),'Proof definitions do not match installed application functions'
activation={'database':DB,'container':CONTAINER,'migrationSha256':hashlib.sha256(MIGRATION.encode()).hexdigest(),'retainedTables':before,'matchingFunctions':json.loads(functions(DB))}
(PRIVATE/'activation.json').write_text(json.dumps(activation,indent=2))
results=[]
for kind in ['vote','parent-vote','reply','report','translation']:
 for private in [False,True]:
  ids={n:str(uuid.uuid4()) for n in ['actor','workspace','campaign','item','child','write']};a,w,c,i,ch,q=[ids[n] for n in ['actor','workspace','campaign','item','child','write']]
  token='SYNTHETIC-concurrency-'+c
  good(f"""BEGIN;
INSERT INTO auth.users(id,aud,role,email) VALUES('{a}','authenticated','authenticated','{a}@synthetic-privacy.invalid');
INSERT INTO workspaces(id,name,slug) VALUES('{w}','SYNTHETIC privacy concurrency','{w}');
INSERT INTO workspace_members(workspace_id,user_id,role) VALUES('{w}','{a}','owner');
INSERT INTO engagement_campaigns(id,workspace_id,title,created_by,status,share_token,allow_public_submissions) VALUES('{c}','{w}','SYNTHETIC privacy concurrency','{a}','active','{token}',true);
INSERT INTO engagement_items(id,campaign_id,title,body,status,source_type) VALUES('{i}','{c}','SYNTHETIC parent','SYNTHETIC parent words','approved','public');
INSERT INTO engagement_items(id,campaign_id,title,body,status,source_type,parent_item_id) VALUES('{ch}','{c}','SYNTHETIC child','SYNTHETIC child words','approved','public','{i}'); COMMIT;""")
  holder=subprocess.Popen(args(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
  marker='PRIVACY_READY'
  metadata="jsonb_build_object('private_note',true)" if private else "jsonb_build_object('synthetic_control','harmless')"
  holder.stdin.write(f"""BEGIN; SET LOCAL statement_timeout='10s'; SELECT set_config('request.jwt.claim.sub','{a}',true);
SELECT pg_advisory_xact_lock(hashtextextended('engagement-response:{c}',0));
SELECT id FROM engagement_campaigns WHERE id='{c}' FOR UPDATE;
UPDATE engagement_items SET metadata_json={metadata},review_expected_updated_at=updated_at,review_reason='SYNTHETIC concurrency review',moderation_notes='SYNTHETIC concurrency review' WHERE id='{i}';
SELECT '{marker}:'||pg_backend_pid();\n""");holder.stdin.flush()
  holder_output='';deadline=time.monotonic()+12
  while marker not in holder_output:
   assert time.monotonic()<deadline,'Holder did not become ready'
   if select.select([holder.stdout],[],[],.1)[0]:holder_output+=holder.stdout.readline()
   if holder.poll() is not None:raise AssertionError(holder.stderr.read())
  pid=int(holder_output.split(marker+':')[1].strip().splitlines()[0])
  target=ch if kind=='parent-vote' else i
  if kind in ['vote','parent-vote']:command=f"SET LOCAL ROLE service_role; INSERT INTO engagement_item_votes(item_id,campaign_id,voter_fingerprint) VALUES('{target}','{c}','{q}'); SELECT 'VOTE_ACCEPTED';"
  elif kind=='reply':command=f"SET LOCAL ROLE service_role; INSERT INTO engagement_items(id,campaign_id,body,status,source_type,parent_item_id) VALUES('{q}','{c}','SYNTHETIC waiting reply','pending','public','{i}'); SELECT 'REPLY_ACCEPTED';"
  elif kind=='report':command=f"SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','{a}',true); SELECT queue_engagement_report('{c}','{q}','public','{{}}'); RESET ROLE; SELECT 'ITEM_COUNT:'||jsonb_array_length(snapshot_text::jsonb->'items') FROM engagement_report_jobs WHERE campaign_id='{c}';"
  else:command=f"SET LOCAL ROLE service_role; SELECT read_public_translation_source('{token}','{i}');"
  app='privacy-wait-'+q
  waiter=subprocess.Popen(args(),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  waiter.stdin.write(f"BEGIN; SET LOCAL application_name='{app}'; SET LOCAL statement_timeout='12s'; {command} ROLLBACK;\n");waiter.stdin.close();waiter.stdin=None
  blocked=False
  try:
   if kind=='translation':
    out,err=waiter.communicate(timeout=8);assert waiter.returncode!=0 and 'PT503' in err,(out,err)
   else:
    deadline=time.monotonic()+8
    while time.monotonic()<deadline:
     blocked=good(f"SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname='{DB}' AND application_name='{app}' AND wait_event_type='Lock' AND {pid}=ANY(pg_blocking_pids(pid)))")=='t'
     if blocked:break
     assert waiter.poll() is None,'Waiter completed before the asserted overlap'
     time.sleep(.05)
    assert blocked,'No demonstrated native lock overlap'
   assert holder.poll() is None,'Holder ended before competing operation'
   holder.stdin.write('COMMIT;\n');holder.stdin.close();holder.stdin=None
   ho,he=holder.communicate(timeout=8);assert holder.returncode==0,he
   if kind=='translation':
    after=sql('BEGIN;'+command+'ROLLBACK;');out,err=after.stdout,after.stderr;code=after.returncode
   else:out,err=waiter.communicate(timeout=15);code=waiter.returncode
   if private and kind!='report':
    assert code!=0 and ('42501' if kind=='translation' else 'PT409') in err,(kind,code,out,err)
   else:
    assert code==0,(kind,out,err)
    if kind=='report':assert ('ITEM_COUNT:0' if private else 'ITEM_COUNT:2') in out,out
   result={'kind':kind,'privateEdit':private,'ids':ids,'lockOverlap':blocked if kind!='translation' else 'busy while holder live','exitCode':code,'output':out,'error':err}
   results.append(result);(PRIVATE/f'{kind}-{private}.json').write_text(json.dumps(result,indent=2))
   print(kind,'private' if private else 'harmless','passed',flush=True)
  finally:
   if holder.poll() is None:
    holder.stdin.write('ROLLBACK;\n');holder.stdin.close();holder.wait(timeout=12)
   if waiter.poll() is None:waiter.wait(timeout=15)
summary={'activation':activation,'cases':results,'privateEvidence':str(PRIVATE),'limits':['Native synthetic concurrency only; browser navigation and artifacts have separate evidence.','No application or worker connects to the proof database; synthetic source histories remain there.','Waiting write transactions roll back; source edits commit so waiters must evaluate the newly private version.']}
(REVIEW/'public-copy-concurrency-results.json').write_text(json.dumps(summary,indent=2)+'\n')
