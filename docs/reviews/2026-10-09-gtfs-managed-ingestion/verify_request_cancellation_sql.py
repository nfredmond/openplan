"""Exercise request cancellation reservations in isolated rollback transactions."""
from pathlib import Path
import hashlib,json,re,subprocess,sys
here=Path(__file__).resolve().parent;root=here.parents[2]
config=json.loads(Path(sys.argv[1]).read_text());assert config['container']=='supabase_db_openplan-restore-target-2026091050';assert re.fullmatch(r'openplan_attempt_cli_[0-9a-f]{32}',config['database'])
out=Path(sys.argv[2]);out.mkdir(mode=0o700,parents=True,exist_ok=False)
path=root/'openplan/supabase/migrations/20261016000031_gtfs_request_cancellation.sql';original=path.read_text()
checks=(here/'adoption-checks.sql').read_text().split('DO $proof$')[0]+(here/'request-cancellation-checks.sql').read_text()
command=['docker','exec','-i',config['container'],'psql','-U','postgres','-d',config['database'],'-X','-qAt','-v','ON_ERROR_STOP=1']
def change(before,after):
 assert original.count(before)==1,before
 return original.replace(before,after)
def guard(message):
 marker="RAISE EXCEPTION '"+message+"'";assert original.count(marker)==1
 end=original.index(marker);start=original.rfind('\n IF ',0,end);then=original.rfind('THEN',start,end)+4;assert start>=0 and then>start
 return original[:start]+'\n IF false THEN'+original[then:]
variants=[('baseline',original,None),('harmless',original+'\n-- Harmless cancellation control.\n',None),
 ('late-admission',guard('GTFS request is cancelled'),'late admission created cancelled request'),
 ('writer',guard('GTFS request cancellation write access is unavailable'),'viewer cancelled request'),
 ('reason',guard('GTFS request cancellation requires complete identity and reason'),'empty cancellation reason accepted'),
 ('replay',change('saved.payload_hash IS DISTINCT FROM hash','false'),'changed reason replay accepted'),
 ('request-identity',guard('GTFS request cancellation already has its command identity').replace('VALUES(p_request,p_workspace,p_actor,p_command,hash,result);','VALUES(p_request,p_workspace,p_actor,p_command,hash,result) ON CONFLICT(request_id) DO UPDATE SET command_id=excluded.command_id,payload_hash=excluded.payload_hash,response=excluded.response;'),'second cancellation command replaced identity'),
 ('read-scope',change('WHERE request_id=p_request AND workspace_id=p_workspace','WHERE request_id=p_request'),'foreign cancellation disclosed'),
 ('reader',change("IF NOT FOUND THEN RAISE EXCEPTION 'GTFS cancellation read access is unavailable'","IF false THEN RAISE EXCEPTION 'GTFS cancellation read access is unavailable'"),'outsider read cancellation'),
 ('native-close',change("    terminal:=public.cancel_gtfs_ingest(p_workspace,submission.version_id,p_command,p_actor,p_reason);","    terminal:=NULL;"),'unfinished request was not closed'),
 ('private-bypass',original+'\nGRANT USAGE ON SCHEMA openplan_gtfs TO service_role; GRANT EXECUTE ON FUNCTION openplan_gtfs.admit_gtfs_ingest(uuid,uuid,uuid,uuid,jsonb) TO service_role;','service bypassed cancellation wrapper'),
 ('write-role',original+'\nGRANT EXECUTE ON FUNCTION public.cancel_gtfs_submission(uuid,uuid,uuid,uuid,text) TO authenticated;','authenticated client cancelled request'),
 ('read-role',original+'\nGRANT EXECUTE ON FUNCTION public.read_gtfs_submission_cancellation(uuid,uuid,uuid) TO authenticated;','authenticated client read cancellation'),
 ('restored',original,None)]
records=[]
for name,source,failure in variants:
 ddl=source.replace('BEGIN;','',1).replace('COMMIT;','',1)
 result=subprocess.run(command,input='BEGIN;\n'+ddl+'\n'+checks+'\nROLLBACK;\n',text=True,capture_output=True,timeout=30);(out/f'{name}.log').write_text(result.stdout+result.stderr)
 if failure:assert result.returncode!=0 and failure in result.stderr,(name,result.stderr[:2500])
 else:assert result.returncode==0,(name,result.stderr[:2500])
 records.append({'variant':name,'result':'expected assertion failure' if failure else 'pass','assertion':failure});print(name,records[-1]['result'],flush=True)
(out/'result.json').write_text(json.dumps({'records':records,'migrationSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'checksSha256':hashlib.sha256(checks.encode()).hexdigest(),'boundary':'Actual PostgreSQL rollback fixtures and current service/authenticated roles. Does not establish concurrent interleaving, HTTP/session authorization, Storage cleanup, official migration installation/restore, power-loss durability or browser usability.'},indent=2)+'\n')
