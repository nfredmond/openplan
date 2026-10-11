"""Verify service-only request status and member privacy on a retained clone."""
from pathlib import Path
import hashlib,json,re,subprocess,sys,uuid
import requests
here=Path(__file__).resolve().parent;root=here.parents[2]
sys.path.insert(0,str(here.parent/'2026-10-08-model-custody-metadata/prototype'))
from isolated_postgrest import gateway
source=json.loads(Path(sys.argv[1]).read_text());assert source['container']=='supabase_db_openplan-restore-target-2026091050';assert re.fullmatch(r'openplan_attempt_cli_[0-9a-f]{32}',source['database'])
out=Path(sys.argv[2]);out.mkdir(mode=0o700,parents=True,exist_ok=False)
config={**source,'database':'openplan_attempt_cli_'+uuid.uuid4().hex};(out/'database.json').write_text(json.dumps(config)+'\n');(out/'database.json').chmod(0o600)
def sql(query,database=None):
 r=subprocess.run(['docker','exec','-i',config['container'],'psql','-U','postgres','-d',database or config['database'],'-X','-qAt','-v','ON_ERROR_STOP=1'],input=query,text=True,capture_output=True,timeout=30)
 if r.returncode:raise RuntimeError(r.stderr[:1500])
 return r.stdout.strip()
assert sql('SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid();',source['database'])=='0';sql(f'CREATE DATABASE {config["database"]} TEMPLATE {source["database"]};','postgres')
migration=root/'openplan/supabase/migrations/20261016000029_gtfs_submission_status.sql';original=migration.read_text().replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION')
workspace,other,actor,viewer,outsider,request=[str(uuid.uuid4()) for _ in range(6)]
sql(f"INSERT INTO auth.users(id,email) VALUES('{actor}','{actor}@example.invalid'),('{viewer}','{viewer}@example.invalid'),('{outsider}','{outsider}@example.invalid'); INSERT INTO public.workspaces(id,name,slug) VALUES('{workspace}','Synthetic request status','proof-{workspace}'),('{other}','Synthetic other scope','proof-{other}'); INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('{workspace}','{actor}','owner'),('{workspace}','{viewer}','viewer'),('{other}','{actor}','owner');")
meta={'kind':'url','provisionalName':'Synthetic private status source','sourceUrl':f'https://example.invalid/{request}.zip','normalizedSourceUrl':f'https://example.invalid/{request}.zip'}
receipt=json.loads(sql(f"SELECT public.admit_gtfs_ingest('{request}','{workspace}','{actor}',NULL,'{json.dumps(meta)}'::jsonb);"));sql(original)
records=[]
with gateway('public',database=config['database'],subjects=(actor,viewer)) as rest:
 def rpc(ws,req,user,token=None):
  r=requests.post(rest['url']+'/rpc/read_gtfs_submission_status',headers={'Authorization':'Bearer '+(token or rest['service_token'])},json={'p_workspace':ws,'p_request':req,'p_actor':user},timeout=10);return r.status_code,r.json()
 def check():
  for user in [actor,viewer]:
   status,data=rpc(workspace,request,user);assert status==200 and data.get('workspaceId')==workspace and data.get('requestId')==request and data.get('versionId')==receipt['versionId'],'member progress scope differs'
   assert set(data)=={'schemaVersion','requestId','versionId','feedId','workspaceId','state','stage','attempts','leaseUntil','archiveConfirmed','submittedAt','isCurrent','failureCode','failureDetail','submitterAccessUnavailable'},'private status fields exposed'
   assert data['state']=='queued' and data['isCurrent'] is False,'queue status invented completion or adoption'
  assert rpc(other,request,actor)==(200,None),'cross-workspace request is disclosed'
  assert rpc(workspace,str(uuid.uuid4()),viewer)==(200,None),'uncommitted request does not remain unconfirmed'
  for req in [request,str(uuid.uuid4())]:
   status,data=rpc(workspace,req,outsider);assert status==403 and data.get('code')=='42501','unauthorized missing request bypasses membership'
  for token in [rest['anon_token'],rest['authenticated_tokens'][actor],rest['authenticated_tokens'][viewer]]:
   status,data=rpc(workspace,request,actor,token);assert status in [401,403] and data.get('code')=='42501','untrusted role can impersonate status actor'
 def change(before,after):
  assert original.count(before)==1,before
  return original.replace(before,after)
 variants=[('baseline',original,None),('harmless',original+'\n-- Harmless status control.\n',None),
  ('early-membership',change(" PERFORM 1 FROM public.workspace_members WHERE workspace_id=p_workspace AND user_id=p_actor FOR SHARE;\n IF NOT FOUND THEN\n  RAISE EXCEPTION 'GTFS status read access is unavailable' USING ERRCODE='42501';\n END IF;",''),'unauthorized missing request bypasses membership'),
  ('workspace',change('s.request_id=p_request AND s.workspace_id=p_workspace','s.request_id=p_request'),'cross-workspace request is disclosed'),
  ('request',change('s.request_id=p_request AND s.workspace_id=p_workspace','s.workspace_id=p_workspace'),'uncommitted request does not remain unconfirmed'),
  ('private-source',change('RETURN public.read_gtfs_ingest_status(p_workspace,version_id,p_actor);',"RETURN public.read_gtfs_ingest_status(p_workspace,version_id,p_actor)||jsonb_build_object('privateSource',p_actor);"),'private status fields exposed'),
  ('role',original+'\nGRANT EXECUTE ON FUNCTION public.read_gtfs_submission_status(uuid,uuid,uuid) TO authenticated;','untrusted role can impersonate status actor'),
  ('restored',original,None)]
 try:
  for name,ddl,assertion in variants:
   sql(ddl)
   try:check()
   except AssertionError as error:
    assert assertion and str(error)==assertion,(name,str(error));records.append({'variant':name,'result':'expected assertion failure','assertion':str(error)})
   else:assert assertion is None,(name,'broken status passed');records.append({'variant':name,'result':'pass'})
   print(name,records[-1]['result'],flush=True)
 finally:sql(original)
(out/'result.json').write_text(json.dumps({'records':records,'migrationSha256':hashlib.sha256(migration.read_bytes()).hexdigest(),'runnerSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'boundary':'Actual PostgreSQL/PostgREST member, viewer, outsider, anon and authenticated roles on a retained main-derived clone plus candidate status DDL. No application route, full CLI installation/restore, browser or release acceptance.'},indent=2)+'\n')
