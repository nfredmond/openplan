import os,sys,json,re,uuid,subprocess
from pathlib import Path
p=Path(__file__).resolve().parent
root=Path(__file__).resolve().parents[3]
config=json.loads(Path(sys.argv[1]).read_text())
assert config['container']=='supabase_db_openplan-restore-target-2026091050'
assert re.fullmatch('openplan_attempt_cli_[0-9a-f]{32}',config['database'])
os.environ['OPENPLAN_MODEL_ATTEMPT_TEST_CONTAINER']=config['container']
sys.path.insert(0,str(root/'docs/reviews/2026-10-08-model-custody-metadata/prototype'))
from isolated_postgrest import gateway
workspace=str(uuid.uuid4()); schema='http_recovery_'+uuid.uuid4().hex
sql=f"INSERT INTO public.workspaces(id,name,slug) VALUES('{workspace}','Synthetic GTFS measurement','profile-{workspace}'); CREATE SCHEMA {schema}; GRANT USAGE ON SCHEMA {schema} TO service_role;"
for table in ['gtfs_feeds','gtfs_feed_versions','gtfs_route_service_levels','gtfs_stop_service_levels']:
 sql+=f"CREATE VIEW {schema}.{table} WITH(security_invoker=true) AS SELECT * FROM public.{table} WHERE workspace_id='{workspace}' WITH LOCAL CHECK OPTION; GRANT SELECT,INSERT,UPDATE,DELETE ON {schema}.{table} TO service_role;"
for name,param,returns in [('compute_gtfs_tract_service','p_feed_version_id','integer'),('promote_gtfs_feed_version','p_version_id','void')]:
 sql+=f"CREATE FUNCTION {schema}.{name}({param} uuid) RETURNS {returns} LANGUAGE sql SECURITY INVOKER AS 'SELECT public.{name}({param})'; REVOKE ALL ON FUNCTION {schema}.{name}(uuid) FROM PUBLIC; GRANT EXECUTE ON FUNCTION {schema}.{name}(uuid) TO service_role;"
version=str(uuid.uuid4()); feed=str(uuid.uuid4())
sql+=f"INSERT INTO public.gtfs_feeds(id,workspace_id,agency_name) VALUES('{feed}','{workspace}','Synthetic failure receipt'); INSERT INTO public.gtfs_feed_versions(id,workspace_id,feed_id,source_kind,status,updated_at) VALUES('{version}','{workspace}','{feed}','upload','parsing',now()-interval '20 minutes'); SELECT public.reap_gtfs_feed_version('{version}',now()-interval '15 minutes');"
psql=['docker','exec','-i',config['container'],'psql','-U','postgres','-d',config['database'],'-X','-qAt','-v','ON_ERROR_STOP=1']
r=subprocess.run(psql,input=sql,text=True,capture_output=True,timeout=20)
if r.returncode: raise RuntimeError(r.stderr)
with gateway(schema,database=config['database']) as rest:
 env={**os.environ,'OPENPLAN_PROOF_HTTP_URL':rest['url'],'OPENPLAN_PROOF_HTTP_TOKEN':rest['service_token'],'OPENPLAN_PROOF_HTTP_SCHEMA':schema,'OPENPLAN_PROOF_WORKSPACE':workspace,'NODE_OPTIONS':'--max-old-space-size=512','OPENPLAN_PROOF_VERSION':version}
 r=subprocess.run([str(root/'openplan/node_modules/.bin/tsx'),str(p/'failure-receipt.mts')],cwd=root/'openplan',env=env,capture_output=True,text=True,timeout=110)
 (p/'failure-receipt.json').write_text(r.stdout); (p/'failure-receipt-stderr.txt').write_text(r.stderr)
 (p/'failure-receipt-custody.json').write_text(json.dumps({'container':config['container'],'database':config['database'],'workspace':workspace,'schema':schema,'exitCode':r.returncode,'checkoutCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'gatewayImage':rest['image'],'scope':'Late failure receipt after native abandonment fence; synthetic empty version, no archive or browser journey.'},indent=2)+'\n')
 print('exit',r.returncode); print(r.stdout); print(r.stderr[-1800:])
