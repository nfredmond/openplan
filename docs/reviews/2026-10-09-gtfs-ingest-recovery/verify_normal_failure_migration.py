"""Rollback-only checks of the candidate failure-closure migration."""
from pathlib import Path
import subprocess,json,sys,re
p=Path(__file__).resolve().parent
config=json.loads(Path(sys.argv[1]).read_text())
if config['container']!='supabase_db_openplan-restore-target-2026091050' or not re.fullmatch('openplan_attempt_cli_[0-9a-f]{32}',config['database']): raise SystemExit('Expected owned proof database')
prototype=(p.parents[2]/'openplan/supabase/migrations/20261016000026_gtfs_failure_closure.sql').read_text().replace('BEGIN;\n','',1).removesuffix('COMMIT;\n')
fixtures=(p/'verify-recovery.sql').read_text().replace('BEGIN;','',1).replace('ROLLBACK;','')
checks="""
DO $proof$
DECLARE result jsonb;
BEGIN
 result:=close_failed_gtfs_version('33333333-3333-4333-8333-333333333333','partial_write','late');
 IF result->>'recorded'<>'false' OR (SELECT count(*) FROM gtfs_route_service_levels WHERE feed_version_id='33333333-3333-4333-8333-333333333333')<>1 THEN RAISE EXCEPTION 'current ready version changed'; END IF;
 result:=close_failed_gtfs_version('66666666-6666-4666-8666-666666666666','partial_write','late');
 IF result->>'recorded'<>'false' OR (SELECT count(*) FROM gtfs_stop_service_levels WHERE feed_version_id='66666666-6666-4666-8666-666666666666')<>1 THEN RAISE EXCEPTION 'noncurrent ready version changed'; END IF;
END $proof$;
INSERT INTO gtfs_route_service_levels(workspace_id,feed_version_id,route_id,route_type,service_day,trips_per_day,derivation_method) VALUES('11111111-1111-4111-8111-111111111111','55555555-5555-4555-8555-555555555555','R',3,'monday',1,'scheduled');
DO $proof$
DECLARE result jsonb;
BEGIN
 result:=close_failed_gtfs_version('55555555-5555-4555-8555-555555555555','partial_write','interrupted','11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/55555555-5555-4555-8555-555555555555.zip');
 IF close_failed_gtfs_version('55555555-5555-4555-8555-555555555555','partial_write','interrupted','11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/55555555-5555-4555-8555-555555555555.zip') IS DISTINCT FROM result THEN RAISE EXCEPTION 'retry receipt changed'; END IF;
 IF close_failed_gtfs_version('55555555-5555-4555-8555-555555555555','partial_write','different')->>'recorded'<>'false' THEN RAISE EXCEPTION 'conflicting retry accepted'; END IF;
 IF result<>jsonb_build_object('recorded',true,'feedStatusChanged',false) THEN RAISE EXCEPTION 'closure outcome incorrect'; END IF;
 IF EXISTS(SELECT 1 FROM gtfs_route_service_levels WHERE feed_version_id='55555555-5555-4555-8555-555555555555') THEN RAISE EXCEPTION 'partial rows survived'; END IF;
 IF NOT EXISTS(SELECT 1 FROM gtfs_ingest_storage_cleanup WHERE version_id='55555555-5555-4555-8555-555555555555') THEN RAISE EXCEPTION 'object removal not retained'; END IF;
 BEGIN
  UPDATE gtfs_feed_versions SET status='parsing' WHERE id='55555555-5555-4555-8555-555555555555';
  RAISE EXCEPTION 'closed stage reopened';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 BEGIN
  INSERT INTO gtfs_route_service_levels(workspace_id,feed_version_id,route_id,route_type,service_day,trips_per_day,derivation_method) VALUES('11111111-1111-4111-8111-111111111111','55555555-5555-4555-8555-555555555555','late',3,'monday',1,'scheduled');
  RAISE EXCEPTION 'closed derived write accepted';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 IF has_function_privilege('authenticated','public.close_failed_gtfs_version(uuid,text,text,text)','EXECUTE') THEN RAISE EXCEPTION 'closure privilege widened'; END IF;
END $proof$;
"""
cases=[('baseline',prototype,True,''),('harmless',prototype+'\n-- Harmless control\n',True,''),('allow-ready',prototype.replace("v.status NOT IN ('pending','fetching','parsing')","false"),False,'noncurrent ready version changed'),('omit-route-cleanup',prototype.replace('DELETE FROM public.gtfs_route_service_levels WHERE feed_version_id=v.id;',''),False,'partial rows survived'),('omit-stage-fence',prototype.replace('OLD.ingest_closed_at IS NOT NULL AND NEW IS DISTINCT FROM OLD','false'),False,'closed stage reopened'),('omit-derived-fence',prototype.replace('closed_at IS NOT NULL THEN','false THEN'),False,'closed derived write accepted'),('omit-retry-receipt',prototype.replace("RETURN v.ingest_failure_receipt->'result';","RETURN jsonb_build_object('recorded',false,'feedStatusChanged',false);"),False,'retry receipt changed'),('restored',prototype,True,'')]
results=[]
for name,sql,passed,reason in cases:
 r=subprocess.run(['docker','exec','-i',config['container'],'psql','-U','postgres','-d',config['database'],'-X','-qAt','-v','ON_ERROR_STOP=1'],input='BEGIN;\n'+sql+'\n'+fixtures+'\n'+checks+'\nROLLBACK;',text=True,capture_output=True,timeout=25)
 if (r.returncode==0)!=passed or (not passed and reason not in r.stderr): raise RuntimeError(name+'\n'+r.stdout+r.stderr)
 results.append({'case':name,'exitCode':r.returncode,'expectedPass':passed,'failureReason':reason or None})
print(json.dumps(results,indent=2))
