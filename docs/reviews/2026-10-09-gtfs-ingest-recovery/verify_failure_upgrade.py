"""Apply migration 26 to a populated owned upgrade clone after rollback controls."""
from pathlib import Path
import hashlib,json,re,subprocess,sys
p=Path(__file__).resolve().parent
config=json.loads(Path(sys.argv[1]).read_text())
if config['container']!='supabase_db_openplan-restore-target-2026091050' or not re.fullmatch('openplan_gtfs_recovery_[0-9a-f]{32}',config['database']): raise SystemExit('Expected owned populated upgrade database')
source=(p.parents[2]/'openplan/supabase/migrations/20261016000026_gtfs_failure_closure.sql').read_text()
ddl=source.replace('BEGIN;\n','',1).removesuffix('COMMIT;\n')
base=['docker','exec','-i',config['container'],'psql','-U','postgres','-d',config['database'],'-X','-qAt','-v','ON_ERROR_STOP=1']
def snapshot(after=False):
 parts=[]
 for table in ['gtfs_feeds','gtfs_feed_versions','gtfs_route_service_levels','gtfs_stop_service_levels','gtfs_ingest_storage_cleanup']:
  value="to_jsonb(t)-'ingest_closed_at'-'ingest_failure_receipt'" if after and table=='gtfs_feed_versions' else 'to_jsonb(t)'
  key='version_id' if table=='gtfs_ingest_storage_cleanup' else 'id'
  parts.extend(["'"+table+"'",f"(SELECT coalesce(jsonb_agg({value} ORDER BY {key}),'[]'::jsonb) FROM public.{table} t)"])
 return 'jsonb_build_object('+','.join(parts)+')'
checks=f"""
DO $proof$
BEGIN
 IF (SELECT count(*) FROM public.gtfs_feed_versions WHERE status='ready' AND is_current)=0
 OR (SELECT count(*) FROM public.gtfs_route_service_levels)=0
 OR (SELECT count(*) FROM public.gtfs_stop_service_levels)=0 THEN RAISE EXCEPTION 'populated upgrade fixture missing'; END IF;
 IF (SELECT data FROM upgrade_before) IS DISTINCT FROM {snapshot(True)} THEN RAISE EXCEPTION 'existing GTFS rows changed'; END IF;
 IF EXISTS(SELECT 1 FROM public.gtfs_feed_versions WHERE ingest_closed_at IS NOT NULL OR ingest_failure_receipt IS NOT NULL) THEN RAISE EXCEPTION 'existing version falsely closed'; END IF;
 IF has_function_privilege('anon','public.close_failed_gtfs_version(uuid,text,text,text)','EXECUTE')
 OR has_function_privilege('authenticated','public.close_failed_gtfs_version(uuid,text,text,text)','EXECUTE')
 OR NOT has_function_privilege('service_role','public.close_failed_gtfs_version(uuid,text,text,text)','EXECUTE') THEN RAISE EXCEPTION 'closure privileges incorrect'; END IF;
END $proof$;
SELECT json_build_object('feeds',(SELECT count(*) FROM gtfs_feeds),'versions',(SELECT count(*) FROM gtfs_feed_versions),'routes',(SELECT count(*) FROM gtfs_route_service_levels),'stops',(SELECT count(*) FROM gtfs_stop_service_levels));
"""
cases=[('baseline',ddl,True,'',False),('harmless',ddl+'\n-- harmless\n',True,'',False),('change-existing-row',ddl+"\nUPDATE public.gtfs_feeds SET agency_name='mutated';",False,'existing GTFS rows changed',False),('close-existing-version',ddl.replace('ADD COLUMN ingest_closed_at timestamptz,','ADD COLUMN ingest_closed_at timestamptz DEFAULT now(),'),False,'existing version falsely closed',False),('restored-committed',ddl,True,'',True)]
results=[]
for name,definition,expected,reason,commit in cases:
 sql='BEGIN;\nCREATE TEMP TABLE upgrade_before AS SELECT '+snapshot()+' AS data;\n'+definition+'\n'+checks+('\nCOMMIT;' if commit else '\nROLLBACK;')
 r=subprocess.run(base,input=sql,text=True,capture_output=True,timeout=30)
 if (r.returncode==0)!=expected or (not expected and reason not in r.stderr): raise RuntimeError(name+'\n'+r.stdout+r.stderr)
 results.append({'case':name,'expectedPass':expected,'exitCode':r.returncode,'reason':reason or None,'committed':commit,'counts':json.loads(r.stdout.strip()) if expected else None})
print(json.dumps({'migrationSha256':hashlib.sha256(source.encode()).hexdigest(),'database':config['database'],'comparison':'Exact JSON comparison of all rows in five GTFS tables, excluding only the two new nullable version columns; new columns checked NULL','controls':results},indent=2))
