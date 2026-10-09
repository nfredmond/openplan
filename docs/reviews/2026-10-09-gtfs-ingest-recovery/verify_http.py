"""Native sweep through an isolated schema; inject only a Storage interruption."""
import json
import os
import re
from pathlib import Path
import subprocess
import sys
import uuid
from contextlib import nullcontext
from isolated_storage import storage
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT/'docs/reviews/2026-10-08-model-custody-metadata/prototype'))
from isolated_postgrest import gateway
config = json.loads(Path(sys.argv[1]).read_text())
assert config['container'] == os.environ['OPENPLAN_MODEL_ATTEMPT_TEST_CONTAINER']
if not re.fullmatch(r'openplan_attempt_cli_[0-9a-f]{32}', config['database']):
    raise SystemExit('Expected isolated HTTP proof database')
# Each run keeps fresh synthetic fixtures in this owned clone.
workspace, feed, version = [str(uuid.uuid4()) for _ in range(3)]
config['schema'] = 'http_recovery_' + uuid.uuid4().hex
schema = config['schema']
statement = f"""INSERT INTO workspaces(id,name,slug) VALUES('{workspace}','Synthetic HTTP recovery','proof-{workspace}');
INSERT INTO gtfs_feeds(id,workspace_id,agency_name) VALUES('{feed}','{workspace}','Synthetic HTTP recovery');
INSERT INTO gtfs_feed_versions(id,workspace_id,feed_id,source_kind,status,storage_path,updated_at)
VALUES('{version}','{workspace}','{feed}','upload','parsing','{workspace}/{feed}/{version}.zip',now()-interval '20 minutes');
CREATE SCHEMA {schema}; GRANT USAGE ON SCHEMA {schema} TO service_role;
CREATE VIEW {schema}.gtfs_feed_versions WITH(security_invoker=true) AS SELECT * FROM public.gtfs_feed_versions WHERE workspace_id='{workspace}';
CREATE VIEW {schema}.gtfs_ingest_storage_cleanup WITH(security_invoker=true) AS SELECT * FROM public.gtfs_ingest_storage_cleanup WHERE storage_path LIKE '{workspace}/%';
GRANT SELECT,UPDATE ON {schema}.gtfs_feed_versions TO service_role;
GRANT SELECT,DELETE ON {schema}.gtfs_ingest_storage_cleanup TO service_role;
CREATE FUNCTION {schema}.reap_gtfs_feed_version(p_version_id uuid,p_cutoff timestamptz) RETURNS boolean LANGUAGE sql SECURITY INVOKER AS 'SELECT public.reap_gtfs_feed_version(p_version_id,p_cutoff)';
REVOKE ALL ON FUNCTION {schema}.reap_gtfs_feed_version(uuid,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION {schema}.reap_gtfs_feed_version(uuid,timestamptz) TO service_role;"""
subprocess.run(['docker','exec','-i',config['container'],'psql','-U','postgres','-d',config['database'],'-X','-q','-v','ON_ERROR_STOP=1'],input=statement,text=True,capture_output=True,check=True,timeout=15)
with storage(config) if os.environ.get('OPENPLAN_PROOF_NATIVE_STORAGE') == '1' else nullcontext(None) as native, gateway(config['schema'], database=config['database']) as rest:
    env = {**os.environ, 'OPENPLAN_PROOF_HTTP_URL': rest['url'], 'OPENPLAN_PROOF_HTTP_TOKEN': rest['service_token'], 'OPENPLAN_PROOF_HTTP_SCHEMA': config['schema'], 'OPENPLAN_PROOF_VERSION_ID': version}
    if native:
        env.update(OPENPLAN_PROOF_STORAGE_URL=native['url'],OPENPLAN_PROOF_STORAGE_TOKEN=native['token'],OPENPLAN_PROOF_OBJECT_PATH=f'{workspace}/{feed}/{version}.zip')
    result = subprocess.run([str(ROOT/'openplan/node_modules/.bin/tsx'),str(Path(__file__).with_name('verify_http.mts'))], cwd=ROOT/'openplan', env=env, text=True, capture_output=True, timeout=30)
    if result.returncode:
        raise RuntimeError(result.stdout+result.stderr)
    print(result.stdout)
