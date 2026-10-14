"""Check the row guard in a retained clone, leaving the source database unchanged."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import select
import subprocess
import time
import uuid

PG = 'a79d62deecea7fd1d1099b35863ca3de50ef7f44618c3c130c9f5b34b024bed3'
SOURCE = 'odm_output_68adf5426c164b71b653efeb24d42c9a'
PROOF = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009')
PROFILE = PROOF/'odm-output-schema-recovery-20261014/main41c-controls-01/baseline-private'
MIGRATION = 'openplan/supabase/migrations/20261017000011_aerial_preserve_held_custody.sql'


def run(repo, out, migration=None, only=None):
    os.umask(0o077)
    out.mkdir(mode=0o700, parents=True)
    original = json.loads(next((PROFILE/'upgraded-runtime').glob('original-dispatch-*/receipt.json')).read_text())['applicationJob']
    state = json.loads(subprocess.check_output(['docker', 'inspect', PG]))[0]
    assert not state['State']['Running'] and state['HostConfig']['Memory']==state['HostConfig']['MemorySwap']==1073741824
    assert state['Config']['Labels'].get('openplan.purpose')=='odm-private-dispatch-rpc-cli-20261012'
    assert state['Image']=='sha256:ca7871b587ca2c401ac0f325df6249c9aa0d25647ded34631158efc51176767f'
    assert not state['HostConfig']['PortBindings']
    database='odm_held_'+uuid.uuid4().hex
    prefix=['docker','exec','-i',PG,'psql','-U','postgres','-XqAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
    sequence=0
    def sql(text, target=database, expected=0):
        nonlocal sequence
        sequence+=1
        result=subprocess.run(prefix+['-d',target],input=text,text=True,capture_output=True,timeout=15)
        (out/(str(sequence).zfill(3)+'-sql-private.log')).write_text(result.stdout+result.stderr)
        if expected is not None:assert result.returncode==expected, 'Native SQL returns its expected exit'
        return result
    def quoted(value):
        return "'"+str(value).replace("'","''")+"'"
    job=str(uuid.uuid4())
    def fresh(kind='orthomosaic'):
        identifier=str(uuid.uuid4())
        sql('INSERT INTO public.aerial_artifact_custody(id,workspace_id,mission_id,processing_job_id,kind,ordinal,state,source_host,source_expires_at) VALUES ('+
            ','.join(quoted(value) for value in [identifier,original['workspace_id'],original['mission_id'],job,kind,0,'pending','example.invalid','2099-01-01T00:00:00Z'])+');')
        return identifier
    held="state='held',storage_bucket='aerial-artifacts',storage_path='synthetic/original.tif',byte_size=3,checksum_sha256="+quoted(hashlib.sha256(bytes([1,2,3])).hexdigest())+",content_type='image/tiff',held_at='2026-10-14T12:00:00Z',failure_code=NULL,failure_detail=NULL"
    failed="state='failed',storage_bucket=NULL,storage_path=NULL,byte_size=NULL,checksum_sha256=NULL,content_type=NULL,held_at=NULL,failure_code='storage_write_failed',failure_detail='Synthetic late attempt failed'"
    rows=[]
    first=second=None
    try:
        subprocess.run(['docker','start',PG],check=True,stdout=subprocess.DEVNULL)
        for _ in range(120):
            if subprocess.run(['docker','exec',PG,'pg_isready','-U','postgres'],capture_output=True).returncode==0:break
            time.sleep(.25)
        else:raise TimeoutError('Owned PostgreSQL readiness')
        assert sql('SELECT count(*) FROM pg_stat_activity WHERE datname='+quoted(SOURCE)+';',target='postgres').stdout.strip()=='0'
        sql('CREATE DATABASE '+database+' TEMPLATE '+SOURCE+';',target='postgres')
        (out/'database-private.json').write_text(json.dumps({'container':PG,'database':database,'source':SOURCE})+'\n')
        assert sql('SELECT count(*) FROM supabase_migrations.schema_migrations;').stdout.strip()=='409'
        sql('INSERT INTO public.aerial_processing_jobs(id,workspace_id,mission_id,created_by,request_id,status,imagery_url) VALUES ('+
            ','.join(quoted(value) for value in [job,original['workspace_id'],original['mission_id'],original['created_by'],'held-'+uuid.uuid4().hex,'succeeded','https://example.invalid/synthetic.zip'])+');')
        path=migration or repo/MIGRATION
        candidate=path.read_bytes()
        (out/'candidate.sql').write_bytes(candidate)
        sql(candidate.decode())
        if only in [None,'direct']:
            identifier=fresh()
            sql('UPDATE public.aerial_artifact_custody SET '+held+' WHERE id='+quoted(identifier)+';')
            before=sql('SELECT to_jsonb(c)::text FROM public.aerial_artifact_custody c WHERE id='+quoted(identifier)+';').stdout.strip()
            error=sql('UPDATE public.aerial_artifact_custody SET '+failed+' WHERE id='+quoted(identifier)+';',expected=None)
            assert error.returncode==3 and '23514: Original held aerial custody cannot be replaced' in error.stderr, 'Direct late failure rejects replacement of held facts'
            after=sql('SELECT to_jsonb(c)::text FROM public.aerial_artifact_custody c WHERE id='+quoted(identifier)+';').stdout.strip()
            assert after==before, 'Direct failed write preserves every original row field'
            sql('UPDATE public.aerial_artifact_custody SET attempt_count=attempt_count+1,last_attempt_at=now() WHERE id='+quoted(identifier)+';')
            rows.append({'case':'direct-failure','outcome':'preserved'})
        if only in [None,'fields']:
            identifier=fresh('dtm')
            sql('UPDATE public.aerial_artifact_custody SET '+held+' WHERE id='+quoted(identifier)+';')
            for field,value in [('checksum_sha256',quoted('b'*64)),('storage_path',quoted('synthetic/replacement.tif')),('byte_size','4'),('held_at',quoted('2026-10-14T12:01:00Z')),('source_host',quoted('changed.example.invalid')),('crs',quoted('EPSG:32615'))]:
                error=sql('UPDATE public.aerial_artifact_custody SET '+field+'='+value+' WHERE id='+quoted(identifier)+';',expected=None)
                assert error.returncode==3 and '23514: Original held aerial custody cannot be replaced' in error.stderr, 'Held field cannot change: '+field
            rows.append({'case':'original-fields','outcome':'preserved','fields':6})
        if only in [None,'privileges']:
            if only == 'privileges':
                fresh('orthomosaic')
            access=sql("SELECT json_build_object('definer',p.prosecdef,'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),'service',has_function_privilege('service_role',p.oid,'EXECUTE'),'path',p.proconfig)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='preserve_aerial_held_custody';").stdout.strip()
            access=json.loads(access)
            assert access=={'definer':False,'anon':False,'authenticated':False,'service':True,'path':['search_path=pg_catalog, public']}, 'Guard retains invoker role and narrow function access'
            error=sql("SET ROLE anon; UPDATE public.aerial_artifact_custody SET attempt_count=attempt_count+1;",expected=None)
            assert error.returncode==3 and '42501:' in error.stderr, 'Anonymous role receives no custody write'
            claims=quoted(json.dumps({'sub':original['created_by'],'role':'authenticated'}))
            setup="SET ROLE authenticated; SET request.jwt.claims="+claims+'; '
            visible=sql(setup+'SELECT count(*) FROM public.aerial_artifact_custody WHERE processing_job_id='+quoted(job)+';').stdout.strip()
            assert int(visible)>0, 'Member RLS fixture actually sees its original custody rows'
            written=sql(setup+'WITH written AS (UPDATE public.aerial_artifact_custody SET attempt_count=attempt_count+1 WHERE processing_job_id='+quoted(job)+' RETURNING id) SELECT count(*) FROM written;').stdout.strip()
            assert written=='0', 'Visible member custody rows remain unwritable under RLS'
            rows.append({'case':'existing-member-write-refusal','outcome':'refused','roles':2,'memberVisibleRows':int(visible)})
        if only in [None,'concurrency']:
            identifier=fresh('dsm')
            first=subprocess.Popen(prefix+['-d',database],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            first.stdin.write("BEGIN; SET LOCAL statement_timeout='10s'; UPDATE public.aerial_artifact_custody SET "+held+' WHERE id='+quoted(identifier)+"; SELECT 'held-write-ready';\n")
            first.stdin.flush()
            assert select.select([first.stdout],[],[],10)[0], 'Owned first transaction reaches its row write'
            assert first.stdout.readline().strip()=='held-write-ready'
            second_name='held-late-'+uuid.uuid4().hex
            second=subprocess.Popen(prefix+['-d',database],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            second.stdin.write("SET application_name="+quoted(second_name)+"; SET statement_timeout='10s'; INSERT INTO public.aerial_artifact_custody(workspace_id,mission_id,processing_job_id,kind,ordinal,state,source_host,source_expires_at,failure_code,failure_detail) VALUES ("+
                ','.join(quoted(value) for value in [original['workspace_id'],original['mission_id'],job,'dsm',0,'failed','example.invalid','2099-01-01T00:00:00Z','storage_write_failed','Synthetic late attempt failed'])+
                ') ON CONFLICT(processing_job_id,kind,ordinal) DO UPDATE SET '+failed+';\n')
            second.stdin.close();second.stdin=None
            for _ in range(50):
                waits=sql("SELECT count(*) FROM pg_stat_activity WHERE application_name="+quoted(second_name)+" AND wait_event_type='Lock';").stdout.strip()
                if waits=='1':break
                time.sleep(.05)
            else:raise AssertionError('Late upsert reaches an actual database lock wait')
            first.stdin.write('COMMIT;\n');first.stdin.close();first.stdin=None
            first.communicate(timeout=5)
            assert first.returncode==0
            _,error=second.communicate(timeout=10)
            assert second.returncode==3 and '23514: Original held aerial custody cannot be replaced' in error, 'Concurrent late upsert rejects replacement after the held commit'
            retained=json.loads(sql('SELECT to_jsonb(c)::text FROM public.aerial_artifact_custody c WHERE id='+quoted(identifier)+';').stdout.strip())
            assert retained['state']=='held' and retained['storage_path']=='synthetic/original.tif' and retained['checksum_sha256']==hashlib.sha256(bytes([1,2,3])).hexdigest(), 'Concurrent held row retains its original path and hash'
            rows.append({'case':'locked-late-upsert','outcome':'preserved'})
        report={'cases':rows,'database':database,'sourceSchema':409,'candidateSha256':hashlib.sha256(candidate).hexdigest(),'scope':'Row-only guard on synthetic records in a retained clone; no Storage bytes, live REST RLS, current-main upgrade/restore, browser, quality or complete recovery acceptance.'}
        (out/'result.json').write_text(json.dumps(report,indent=2)+'\n')
        print(report)
    finally:
        for process in [second,first]:
            if process and process.poll() is None:
                process.terminate();process.communicate(timeout=10)
        value=json.loads(subprocess.check_output(['docker','inspect',PG]))[0]
        if value['State']['Running']:subprocess.run(['docker','stop','--time','120',PG],check=True,stdout=subprocess.DEVNULL)
        assert not json.loads(subprocess.check_output(['docker','inspect',PG]))[0]['State']['OOMKilled']


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--repo',type=Path,required=True);parser.add_argument('--out',type=Path,required=True);parser.add_argument('--migration',type=Path);parser.add_argument('--only',choices=['direct','fields','privileges','concurrency']);a=parser.parse_args()
    run(a.repo.resolve(),a.out.resolve(),a.migration.resolve() if a.migration else None,a.only)
