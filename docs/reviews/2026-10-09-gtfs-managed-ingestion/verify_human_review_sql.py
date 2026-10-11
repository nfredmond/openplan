"""Check exact human adoption review with native SQL rollback controls."""
from pathlib import Path
import hashlib,json,re,subprocess,sys
here=Path(__file__).resolve().parent;root=here.parents[2];config=json.loads(Path(sys.argv[1]).read_text());assert config['container']=='supabase_db_openplan-restore-target-2026091050';assert re.fullmatch(r'openplan_attempt_cli_[0-9a-f]{32}',config['database'])
out=Path(sys.argv[2]);out.mkdir(mode=0o700,parents=True,exist_ok=False)
path=root/'openplan/supabase/migrations/20261016000030_gtfs_human_review.sql';original=path.read_text();checks=(here/'adoption-checks.sql').read_text().split('DO $proof$')[0]+(here/'human-review-checks.sql').read_text()
command=['docker','exec','-i',config['container'],'psql','-U','postgres','-d',config['database'],'-X','-qAt','-v','ON_ERROR_STOP=1']
def change(before,after):
 assert original.count(before)==1,before
 return original.replace(before,after)
def guard(message):
 marker="RAISE EXCEPTION '"+message+"'";assert original.count(marker)==1
 end=original.index(marker);start=original.rfind('\n IF ',0,end);then=original.rfind('THEN',start,end)+4;assert start>=0 and then>start
 return original[:start]+'\n IF false THEN'+original[then:]
core=(root/'openplan/supabase/migrations/20261016000028_gtfs_managed_execution.sql').read_text()
start=core.index('CREATE FUNCTION public.adopt_gtfs_ingest');end=core.index('END $$;',start)+len('END $$;')
inner=core[start:end].replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1)
old="IF p_review IS NOT NULL AND p_review IS DISTINCT FROM jsonb_build_object('acceptMaterialShrinkage',true,'basis',basis) THEN"
assert inner.count(old)==1
inner=inner.replace(old,'IF false THEN')
variants=[('baseline',original,None),('harmless',original+'\n-- Harmless reviewed adoption control.\n',None),
 ('member-read',change(" IF NOT FOUND THEN RAISE EXCEPTION 'GTFS review read access is unavailable'", " IF false THEN RAISE EXCEPTION 'GTFS review read access is unavailable'"),'nonmember read review'),
 ('workspace-read',original.replace(' AND workspace_id=p_workspace',''),'foreign workspace read review'),
 ('harmless-wrapper-role',guard('GTFS reviewed adoption write access is unavailable'),None),
 ('viewer-write',original+"\nCREATE OR REPLACE FUNCTION openplan_gtfs.actor_can_write(p_workspace uuid,p_actor uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS 'SELECT true';",'viewer adopted reviewed feed'),
 ('harmless-wrapper-basis',guard('GTFS reviewed counts or predecessor changed'),None),
 ('review-basis',guard('GTFS reviewed counts or predecessor changed')+'\n'+inner,'changed reviewed counts accepted'),
 ('acceptance',guard('GTFS material shrinkage requires human acceptance'),'unaccepted shrinkage adopted'),
 ('receipt-acceptance',change(" OR (saved.response->>'humanAcceptShrinkage')::boolean IS DISTINCT FROM p_accept_shrinkage",''),'changed human acceptance replay accepted'),
 ('receipt-basis',change('saved.payload_hash IS DISTINCT FROM payload_hash','false'),'changed human basis replay accepted'),
 ('harmless-ready-redundancy',guard('GTFS review requires a ready version'),None),
 ('ready',guard('GTFS review requires a ready version'),'unfinished version reviewed as ready'),
 ('completion',guard('Managed GTFS review requires its completion receipt'),'missing completion reviewed'),
 ('shrinkage-disclosure',change("'materialShrinkage',shrinks","'materialShrinkage',false"),'material review concealed shrinkage'),
 ('read-role',original+'\nGRANT EXECUTE ON FUNCTION public.read_gtfs_adoption_review(uuid,uuid,uuid) TO authenticated;','authenticated client invoked review'),
 ('adopt-role',original+'\nGRANT EXECUTE ON FUNCTION public.adopt_reviewed_gtfs_ingest(uuid,uuid,uuid,uuid,jsonb,boolean) TO authenticated;','authenticated client invoked adoption'),
 ('restored',original,None)]
variants = [(name,source.replace(" IF NOT EXISTS(SELECT 1 FROM openplan_gtfs.executions j JOIN openplan_gtfs.completion_receipts c ON c.version_id=j.version_id\n  WHERE j.version_id=p_version AND j.state='ready') THEN",' IF false THEN') if name == 'ready' else source,failure) for name,source,failure in variants]
records=[]
for name,source,failure in variants:
 ddl=source.replace('BEGIN;','',1).replace('COMMIT;','',1)
 result=subprocess.run(command,input='BEGIN;\n'+ddl+'\n'+checks+'\nROLLBACK;\n',text=True,capture_output=True,timeout=30);(out/f'{name}.log').write_text(result.stdout+result.stderr)
 if failure:assert result.returncode!=0 and failure in result.stderr,(name,result.stderr[:2000])
 else:assert result.returncode==0,(name,result.stderr[:2000])
 records.append({'variant':name,'result':'expected assertion failure' if failure else 'pass','assertion':failure});print(name,records[-1]['result'],flush=True)
(out/'result.json').write_text(json.dumps({'records':records,'migrationSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'checksSha256':hashlib.sha256(checks.encode()).hexdigest(),'boundary':'Native PostgreSQL transaction rollback fixtures through managed commands and service/authenticated role checks. Synthetic counts and confirmation receipts do not establish physical Storage custody, actual service, an HTTP/app journey, migration CLI installation/restore or browser acceptance.'},indent=2)+'\n')
