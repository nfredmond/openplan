"""Verify invalid object refusal and rollback after cleanup but before closure."""
from pathlib import Path
import json,re,subprocess,sys
p=Path(__file__).resolve().parent
config=json.loads(Path(sys.argv[1]).read_text())
if config['container']!='supabase_db_openplan-restore-target-2026091050' or not re.fullmatch('openplan_attempt_cli_[0-9a-f]{32}',config['database']): raise SystemExit('Expected owned proof database')
source=(p.parents[2]/'openplan/supabase/migrations/20261016000026_gtfs_failure_closure.sql').read_text()
a=source.index('CREATE FUNCTION public.close_failed_gtfs_version(')
function=source[a:source.index('END $$;',a)+len('END $$;')].replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1)
proof="""
CREATE TEMP TABLE failure_probe_ids(workspace uuid,feed uuid,version uuid);
INSERT INTO failure_probe_ids VALUES(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
INSERT INTO workspaces(id,name,slug) SELECT workspace,'Synthetic rollback','proof-'||workspace FROM failure_probe_ids;
INSERT INTO gtfs_feeds(id,workspace_id,agency_name) SELECT feed,workspace,'Synthetic rollback' FROM failure_probe_ids;
INSERT INTO gtfs_feed_versions(id,workspace_id,feed_id,source_kind,status) SELECT version,workspace,feed,'upload','parsing' FROM failure_probe_ids;
INSERT INTO gtfs_route_service_levels(workspace_id,feed_version_id,route_id,route_type,service_day,trips_per_day,derivation_method) SELECT workspace,version,'R',3,'monday',1,'scheduled' FROM failure_probe_ids;
DO $proof$
DECLARE v uuid;
BEGIN
 SELECT version INTO v FROM failure_probe_ids;
 BEGIN
  PERFORM close_failed_gtfs_version(v,'partial_write','interrupted','wrong-scope.zip');
  RAISE EXCEPTION 'invalid object path accepted';
 EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 IF NOT EXISTS(SELECT 1 FROM gtfs_feed_versions WHERE id=v AND status='parsing' AND ingest_closed_at IS NULL)
 OR (SELECT count(*) FROM gtfs_route_service_levels WHERE feed_version_id=v)<>1
 OR EXISTS(SELECT 1 FROM gtfs_ingest_storage_cleanup WHERE version_id=v) THEN RAISE EXCEPTION 'invalid request changed data'; END IF;
END $proof$;
CREATE FUNCTION pg_temp.refuse_failure_probe() RETURNS trigger LANGUAGE plpgsql AS $trigger$
BEGIN
 IF NEW.id=(SELECT version FROM failure_probe_ids) AND NEW.ingest_closed_at IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM gtfs_route_service_levels WHERE feed_version_id=NEW.id)
  OR NOT EXISTS(SELECT 1 FROM gtfs_ingest_storage_cleanup WHERE version_id=NEW.id) THEN
   RAISE EXCEPTION 'injection did not occur after cleanup';
  END IF;
  RAISE EXCEPTION 'injected final update refusal';
 END IF;
 RETURN NEW;
END $trigger$;
CREATE TRIGGER failure_probe_refusal BEFORE UPDATE ON gtfs_feed_versions FOR EACH ROW EXECUTE FUNCTION pg_temp.refuse_failure_probe();
DO $proof$
DECLARE v uuid; object_path text;
BEGIN
 SELECT version,workspace::text||'/'||feed::text||'/'||version::text||'.zip' INTO v,object_path FROM failure_probe_ids;
 BEGIN
  PERFORM close_failed_gtfs_version(v,'partial_write','interrupted',object_path);
  RAISE EXCEPTION 'final update refusal not exercised';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'injected final update refusal' THEN RAISE; END IF;
 END;
 IF NOT EXISTS(SELECT 1 FROM gtfs_feed_versions WHERE id=v AND status='parsing' AND ingest_closed_at IS NULL AND ingest_failure_receipt IS NULL)
 OR (SELECT count(*) FROM gtfs_route_service_levels WHERE feed_version_id=v)<>1
 OR EXISTS(SELECT 1 FROM gtfs_ingest_storage_cleanup WHERE version_id=v)
 OR NOT EXISTS(SELECT 1 FROM gtfs_feeds WHERE id=(SELECT feed FROM failure_probe_ids) AND status='pending') THEN RAISE EXCEPTION 'failed transaction left partial changes'; END IF;
END $proof$;
"""
start=function.index(' IF p_storage_path IS NOT NULL AND p_storage_path IS DISTINCT FROM')
end=function.index(' END IF;',start)+len(' END IF;')
no_path=function[:start]+function[end:]
cases=[('baseline',function,proof,True,''),('harmless',function+'\n-- harmless\n',proof,True,''),('omit-object-scope',no_path,proof,False,'invalid object path accepted'),('omit-injected-refusal',function,proof.replace("RAISE EXCEPTION 'injected final update refusal';",'RETURN NEW;'),False,'final update refusal not exercised'),('restored',function,proof,True,'')]
results=[]
for name,definition,checks,expected,reason in cases:
 r=subprocess.run(['docker','exec','-i',config['container'],'psql','-U','postgres','-d',config['database'],'-X','-qAt','-v','ON_ERROR_STOP=1'],input='BEGIN;\n'+definition+'\n'+checks+'\nROLLBACK;',text=True,capture_output=True,timeout=20)
 if (r.returncode==0)!=expected or (not expected and reason not in r.stderr): raise RuntimeError(name+'\n'+r.stdout+r.stderr)
 results.append({'case':name,'expectedPass':expected,'exitCode':r.returncode,'reason':reason or None})
print(json.dumps(results,indent=2))
