"""Prove bounded rotating candidate discovery against native service-only SQL."""
from pathlib import Path
import hashlib
import json
import os
import re
import subprocess
import sys
import uuid
import requests

here=Path(__file__).resolve().parent;root=here.parents[2]
sys.path.insert(0,str(here.parent/'2026-10-08-model-custody-metadata/prototype'))
from isolated_postgrest import gateway
source=json.loads(Path(sys.argv[1]).read_text())
assert source['container']=='supabase_db_openplan-restore-target-2026091050'
assert re.fullmatch(r'openplan_attempt_cli_[0-9a-f]{32}',source['database'])
out=Path(sys.argv[2]);out.mkdir(mode=0o700,parents=True,exist_ok=False)
config={**source,'database':'openplan_attempt_cli_'+uuid.uuid4().hex}
(out/'database.json').write_text(json.dumps(config)+'\n');(out/'database.json').chmod(0o600)
def sql(query,database=None):
 r=subprocess.run(['docker','exec','-i',config['container'],'psql','-U','postgres','-d',database or config['database'],'-X','-qAt','-v','ON_ERROR_STOP=1'],input=query,text=True,capture_output=True,timeout=30)
 if r.returncode:raise RuntimeError(r.stderr[:1500])
 return r.stdout.strip()
assert sql('SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid();',source['database'])=='0'
sql(f'CREATE DATABASE {config["database"]} TEMPLATE {source["database"]};','postgres')
migration=root/'openplan/supabase/migrations/20261016000028_gtfs_managed_execution.sql'
fragment='-- UUID pagination rotates eligible discovery'+migration.read_text().split('-- UUID pagination rotates eligible discovery')[1].split('-- Retained tokens can inspect')[0]
original=fragment.replace('CREATE FUNCTION public.scan_gtfs_ingest_candidates','CREATE OR REPLACE FUNCTION public.scan_gtfs_ingest_candidates')
workspace,actor,removed=str(uuid.uuid4()),str(uuid.uuid4()),str(uuid.uuid4())
sql(f"INSERT INTO auth.users(id,email) VALUES('{actor}','{actor}@example.invalid'),('{removed}','{removed}@example.invalid'); INSERT INTO public.workspaces(id,name,slug) VALUES('{workspace}','Synthetic queue scan','proof-{workspace}'); INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('{workspace}','{actor}','owner'),('{workspace}','{removed}','member');")
def admit(user,kind='url'):
 request=str(uuid.uuid4());source={'kind':kind,'provisionalName':'Synthetic scan fixture'}
 if kind=='url':source.update(sourceUrl=f'https://example.invalid/{request}.zip',normalizedSourceUrl=f'https://example.invalid/{request}.zip')
 else:source.update(uploadSha256=hashlib.sha256(b'x').hexdigest(),uploadBytes=1)
 return json.loads(sql(f"SELECT public.admit_gtfs_ingest('{request}','{workspace}','{user}',NULL,'{json.dumps(source)}'::jsonb);"))['versionId']
eligible=sorted([admit(actor) for _ in range(3)])
revoked,live,awaiting=admit(removed),admit(actor),admit(actor,'upload')
sql(f"DELETE FROM public.workspace_members WHERE workspace_id='{workspace}' AND user_id='{removed}'; SELECT public.claim_gtfs_ingest('{live}','{uuid.uuid4()}',300);")
records=[]
sql(original)
with gateway('public',database=config['database'],subjects=(actor,)) as rest:
 def rpc(limit,after,token=None):
  r=requests.post(rest['url']+'/rpc/scan_gtfs_ingest_candidates',headers={'Authorization':'Bearer '+(token or rest['service_token'])},json={'p_limit':limit,'p_after':after},timeout=10)
  return r.status_code,r.json()
 def check():
  assert rpc(100,None)==(200,[{'version_id':v} for v in eligible]),'active, awaiting or revoked work appears eligible'
  assert rpc(2,None)==(200,[{'version_id':v} for v in eligible[:2]]),'initial bounded page differs'
  assert rpc(2,eligible[1])==(200,[{'version_id':eligible[2]},{'version_id':eligible[0]}]),'rotating cursor page differs'
  assert rpc(1,eligible[-1])==(200,[{'version_id':eligible[0]}]),'cursor wrap differs'
  for limit in [None,0,101]:
   status,data=rpc(limit,None);assert status==400 and data.get('code')=='22023','invalid limit is accepted'
  for token in [rest['anon_token'],rest['authenticated_tokens'][actor]]:
   status,data=rpc(1,None,token);assert status in [401,403] and data.get('code')=='42501','untrusted role can scan private queue'
 def altered(before,after):
  assert original.count(before)==1,before
  return original.replace(before,after)
 variants=[('baseline',original,None),('harmless',original+'\n-- Harmless native scan control.\n',None),
  ('cursor',altered('CASE WHEN p_after IS NULL OR v.id>p_after THEN 0 ELSE 1 END','CASE WHEN true THEN 0 ELSE 1 END'),'rotating cursor page differs'),
  ('limit',altered('LIMIT p_limit',''),'initial bounded page differs'),
  ('membership',altered("  AND EXISTS(SELECT 1 FROM public.workspace_members m WHERE m.workspace_id=s.workspace_id\n    AND m.user_id=s.actor_id AND m.role IN ('owner','admin','member'))",''),'active, awaiting or revoked work appears eligible'),
  ('lease-state',altered("(j.state='queued' OR (j.state='running' AND j.lease_until<=clock_timestamp()))","j.state IN ('queued','running','awaiting_archive')"),'active, awaiting or revoked work appears eligible'),
  ('limit-guard',altered('IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN','IF false THEN'),'invalid limit is accepted'),
  ('role',original+'\nGRANT EXECUTE ON FUNCTION public.scan_gtfs_ingest_candidates(integer,uuid) TO authenticated;','untrusted role can scan private queue'),
  ('restored',original,None)]
 try:
  for name,ddl,failure in variants:
   sql(ddl)
   try:check()
   except AssertionError as error:
    assert failure and str(error)==failure,(name,str(error));records.append({'variant':name,'result':'expected assertion failure','assertion':str(error)})
   else:
    assert failure is None,(name,'broken scan passed');records.append({'variant':name,'result':'pass'})
   print(name,records[-1]['result'],flush=True)
 finally:sql(original)
summary={'records':records,'eligibleVersions':eligible,'excluded':{'revoked':revoked,'liveLease':live,'awaitingArchive':awaiting},
 'migrationSha256':hashlib.sha256(migration.read_bytes()).hexdigest(),'runnerSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
 'boundary':'Native PostgreSQL and PostgREST service/anon/authenticated roles. Retained main-derived clone plus current candidate scan fragment, not full CLI upgrade, application enrollment or browser acceptance.'}
(out/'result.json').write_text(json.dumps(summary,indent=2)+'\n')
