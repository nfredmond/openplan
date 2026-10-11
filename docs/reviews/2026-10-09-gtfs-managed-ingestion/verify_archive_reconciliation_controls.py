"""Rollback-only controls for archive retirement, identity and fair selection."""
from pathlib import Path
import hashlib,json,re,subprocess,sys
here=Path(__file__).resolve().parent;root=here.parents[2]
config=json.loads(Path(sys.argv[1]).read_text());out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=False)
assert config['container']=='supabase_db_openplan-restore-target-2026091050'
assert re.fullmatch(r'openplan_attempt_cli_[a-f0-9]{32}',config['database'])
source=(root/'openplan/supabase/migrations/20261016000028_gtfs_managed_execution.sql').read_text()
checks=(here/'archive-reconciliation-checks.sql').read_text()
def mutation(before,after):
 assert source.count(before)==1,before
 return source.replace(before,after)
variants=[('baseline',source,None),('harmless',source.replace('-- Begin recurring archive retirement','-- Harmless comment\n-- Begin recurring archive retirement'),None),
 ('page-bound',mutation('IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 THEN','IF false THEN'),'unbounded reconciliation accepted'),
 ('key-shape',mutation("p_path !~\n  '^[0-9a-f]", "false AND p_path !~\n  '^[0-9a-f]"),'invalid key retired'),
 ('version-suffix',mutation("OR split_part(p_path,'/',3)<>p_version::text||'.zip'",''),'different version key retired'),
 ('scope',mutation("IF FOUND AND p_path<>v.workspace_id::text||'/'||v.feed_id::text||'/'||v.id::text||'.zip' THEN",'IF false THEN'),'foreign scope retired'),
 ('identity',mutation('IF saved_path IS DISTINCT FROM p_path THEN','IF false THEN'),'retired identity changed'),
 ('queue-capture',mutation('PERFORM openplan_gtfs.remember_retired_archive(NEW.version_id,NEW.storage_path);','NULL;'),'cleanup request not retained'),
 ('legacy-close-capture',mutation('FOR EACH ROW EXECUTE FUNCTION openplan_gtfs.retire_closed_archive();','FOR EACH ROW EXECUTE FUNCTION openplan_gtfs.retire_closed_archive();\nDROP TRIGGER gtfs_retire_closed_archive ON public.gtfs_feed_versions;'),'unconfirmed legacy archive lost'),
 ('closed-state',mutation("(v.status<>'failed' OR (v.ingest_closed_at IS NULL AND v.ingest_abandoned_at IS NULL))",'false'),'open archive selected'),
 ('closure-required',mutation("OR (v.ingest_closed_at IS NULL AND v.ingest_abandoned_at IS NULL)",''),'unclosed archive selected'),
 ('deletion-capture',mutation('FOR EACH ROW EXECUTE FUNCTION openplan_gtfs.retire_deleted_archive();','FOR EACH ROW EXECUTE FUNCTION openplan_gtfs.retire_deleted_archive();\nDROP TRIGGER gtfs_retire_archive_before_delete ON public.gtfs_feed_versions;'),'deleted parent archive lost'),
 ('rotation',mutation('SET last_selected_at=clock_timestamp() WHERE a.version_id=r.version_id','SET last_selected_at=NULL WHERE a.version_id=r.version_id'),'reconciliation rotation starved later keys'),
 ('restored',source,None)]
records=[]
for name,definition,failure in variants:
 statement=definition.removesuffix('COMMIT;\n')+'\n'+checks+'\nROLLBACK;'
 command=['docker','exec','-i',config['container'],'psql','-U','postgres','-d',config['database'],'-X','-qAt','-v','ON_ERROR_STOP=1']
 result=subprocess.run(command,input=statement,text=True,capture_output=True,timeout=25)
 if failure is None:assert result.returncode==0,(name,result.stderr[-2000:])
 else:assert result.returncode!=0 and failure in result.stderr,(name,result.returncode,result.stderr[-2000:])
 absent=subprocess.run(command,input="SELECT count(*) FROM pg_namespace WHERE nspname='openplan_gtfs';",text=True,capture_output=True,timeout=10)
 assert absent.returncode==0 and absent.stdout.strip()=='0','Candidate schema escaped rollback'
 records.append({'variant':name,'result':'pass' if failure is None else 'expected assertion failure','assertion':failure})
result={'sourceSha256':hashlib.sha256(source.encode()).hexdigest(),'checksSha256':hashlib.sha256(checks.encode()).hexdigest(),'records':records}
(out/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
