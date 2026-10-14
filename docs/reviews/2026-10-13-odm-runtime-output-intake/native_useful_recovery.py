"""Exercise useful output recovery with actual RPC on the retained isolated schema.

Processing originally used supplied receipts. This proof covers later output
custody under current permissions, not current-main restore or survey accuracy.
"""
import argparse
import base64
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from urllib.parse import urlsplit
from unittest.mock import patch


def run(repo, fixture, useful, out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    assert shutil.disk_usage(out).free > 5*1024**3
    sys.path.insert(0, str(repo/'workers/odm_worker'))
    from application_dispatch_http import Transport
    from application_dispatch_reader import Reader
    from native_engine_attestation import Attestor
    from retained_source import digest
    from runtime_admission import Runtime
    from runtime_dispatch_custody import Custody
    from runtime_observation import Observer
    from runtime_output_intake import Intake
    spec=importlib.util.spec_from_file_location('owned_rpc_profile',repo/'docs/reviews/2026-10-12-odm-private-dispatch-reader/native_rpc_recovery.py')
    helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    migration=repo/'openplan/supabase/migrations/20261017000003_aerial_private_dispatch_custody.sql'
    assert json.loads((fixture/'result.json').read_text())['migrationSha256']==hashlib.sha256(migration.read_bytes()).hexdigest()
    source=useful/'runtime'
    receipt=json.loads(next(source.glob('original-dispatch-*/receipt.json')).read_bytes())
    job=receipt['applicationJob'];request=json.loads(receipt['payloadText']);binding=receipt['binding']
    expected=json.loads((useful/'retained-output.json').read_bytes())
    observation=expected['archive']['observationSha256']
    original_archive=expected['archive']['archive']
    engine=json.loads((useful/'engine/engine-identity.json').read_bytes())
    engine_id=json.loads((useful/'engine/owned-engine.json').read_bytes())['id']
    pg=(fixture/'create-private-database-private.log').read_text().strip()
    rest=(fixture/'baseline-create-rest-private.log').read_text().strip()
    def inspect(identity):return json.loads(subprocess.check_output(['docker','inspect',identity]))[0]
    def checked(identity,image,memory,purpose=None,proof=None):
        v=inspect(identity);h=v['HostConfig']
        assert v['Id']==identity and v['Image']==image and h['Memory']==h['MemorySwap']==memory and not h['PortBindings']
        if purpose:assert v['Config']['Labels'].get('openplan.purpose')==purpose
        if proof:assert v['Config']['Labels'].get('openplan.proof')==str(proof)
        return v
    pv=checked(pg,helper.PG_IMAGE,1073741824,purpose=helper.PURPOSE)
    rv=checked(rest,helper.REST_IMAGE,134217728,purpose=helper.PURPOSE)
    ev=checked(engine_id,engine['imageId'],2147483648,proof=useful/'engine')
    assert not any(v['State']['Running'] for v in (pv,rv,ev)), 'Owned fixture services must be stopped before reopening'
    network=next(iter(pv['NetworkSettings']['Networks']))
    assert list(rv['NetworkSettings']['Networks'])==list(ev['NetworkSettings']['Networks'])==[network]
    net=json.loads(subprocess.check_output(['docker','network','inspect',network]))[0]
    assert net['Internal'] is True and net['Labels'].get('openplan.purpose')==helper.PURPOSE
    env=dict(s.split('=',1) for s in rv['Config']['Env'] if '=' in s)
    database=urlsplit(env['PGRST_DB_URI']).path[1:]
    assert __import__('re').fullmatch(r'rpc_dispatch_[0-9a-f]{32}',database)
    def token(role):
        encode=lambda x:base64.urlsafe_b64encode(json.dumps(x,separators=(',',':')).encode()).rstrip(b'=')
        raw=encode({'alg':'HS256','typ':'JWT'})+b'.'+encode({'role':role,'exp':int(time.time())+3600})
        return (raw+b'.'+base64.urlsafe_b64encode(hmac.new(env['PGRST_JWT_SECRET'].encode(),raw,hashlib.sha256).digest()).rstrip(b'=')).decode()
    sequence=0
    def sql(query):
        nonlocal sequence
        sequence+=1
        p=subprocess.run(['docker','exec','-i',pg,'psql','-XqAt','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1'],input=query.encode(),capture_output=True,timeout=35)
        (out/f'sql-{sequence:03d}-private.log').write_bytes(p.stdout+p.stderr)
        assert p.returncode==0, 'Owned useful output SQL failed'
        return p.stdout.decode().strip()
    q=helper.quote
    where='workspace_id='+q(job['workspace_id'])+' AND user_id='+q(job['created_by'])
    started=[];rows=[]
    try:
        subprocess.run(['docker','start',engine_id],check=True,stdout=subprocess.DEVNULL);started.append(engine_id)
        actual=inspect(engine_id)['NetworkSettings']['Networks'][network]['IPAddress']
        assert urlsplit(engine['endpoint']).hostname==actual, 'Reopened original useful engine must retain its exact endpoint'
        subprocess.run(['docker','start',pg],check=True,stdout=subprocess.DEVNULL);started.append(pg)
        for _ in range(120):
            if subprocess.run(['docker','exec',pg,'pg_isready','-U','supabase_admin'],capture_output=True).returncode==0:break
            time.sleep(.25)
        else:raise TimeoutError('Owned output database readiness')
        existing=sql('SELECT count(*) FROM public.aerial_processing_jobs WHERE id='+q(job['id'])+';')
        assert existing in ('0','1'), 'Useful output fixture job cardinality differs'
        if existing=='0':
            sql('BEGIN; INSERT INTO auth.users(id,email) VALUES ('+q(job['created_by'])+','+q('output-'+job['id']+'@example.invalid')+') ON CONFLICT(id) DO NOTHING; INSERT INTO public.workspaces(id,name,slug) VALUES ('+q(job['workspace_id'])+','+q('Owned useful output recovery')+','+q('useful-output-'+job['id'])+'); INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES ('+q(job['workspace_id'])+','+q(job['created_by'])+",'member'); INSERT INTO public.aerial_missions(id,workspace_id,title) VALUES ("+q(job['mission_id'])+','+q(job['workspace_id'])+','+q('Owned native output recovery')+'); INSERT INTO public.aerial_processing_jobs(id,workspace_id,mission_id,request_id,preset_id,imagery_url,imagery_type,created_by) VALUES ('+','.join(q(job[k]) for k in ('id','workspace_id','mission_id','request_id','preset_id'))+','+q(request['imagery']['url'])+','+q(job['imagery_type'])+','+q(job['created_by'])+'); COMMIT;')
        admission=sql('BEGIN; SET LOCAL ROLE service_role; SELECT public.record_aerial_original_dispatch('+','.join(q(x) for x in [job['id'],job['created_by'],binding['installationId'],binding['targetId'],receipt['payloadText']])+'); COMMIT;')
        recorded=json.loads(admission)
        assert recorded['payloadSha256']==receipt['payloadSha256'] and recorded['applicationJob']==job and recorded['payloadText']==receipt['payloadText'], 'Native admission must preserve useful original bytes and identity'
        subprocess.run(['docker','start',rest],check=True,stdout=subprocess.DEVNULL);started.append(rest)
        endpoint='http://'+inspect(rest)['NetworkSettings']['Networks'][network]['IPAddress']+':3000'
        transport=Transport(endpoint,'owned-useful-output-service',lambda ref:{'apiKey':token('service_role'),'bearerToken':token('service_role')},allow_http=True)
        arguments={'p_request':request['requestId'],'p_installation':binding['installationId'],'p_target':binding['targetId']}
        for _ in range(120):
            try:
                value=json.loads(transport(arguments,time.monotonic()+2,owned=lambda:True));assert value['authorizedNow'] is True;break
            except (OSError,ValueError,TimeoutError):time.sleep(.25)
        else:raise TimeoutError('Owned output RPC readiness')
        def consumer(root,revoke_at=None):
            runtime=Runtime(root,binding['installationId'],max_queued=2,pipeline=lambda job:None)
            custody=Custody(runtime,binding['targetId'],timeout=30);reads=[];children=[]
            def rpc(args,end,*,owned):
                reads.append(args)
                if revoke_at==len(reads):sql("UPDATE public.workspace_members SET role='viewer' WHERE "+where+';')
                return transport(args,end,owned=owned)
            observer=Observer(Reader(custody,rpc,timeout=10),lambda ref:None,Attestor(engine,'/var/run/docker.sock',0),timeout=30)
            intake=Intake(observer,max_archive_bytes=256*1024**2,max_expanded_bytes=1024**3,max_entries=10000,max_directory_bytes=4*1024**2,timeout=120)
            original_spawn=subprocess.Popen
            def spawn(args,**kwargs):
                process=original_spawn(args,**kwargs)
                if len(args)>=3 and args[:2]==[sys.executable,'-B']:children.append(Path(args[2]).name)
                return process
            with runtime.owner(),patch.object(subprocess,'Popen',side_effect=spawn):
                result=intake.advance(request['requestId'],observation)
            archive_root=next(root.glob('preparation-*/output-archive'))
            actual=digest(archive_root,'archive.zip',256*1024**2,time.monotonic()+120)
            assert actual=={k:original_archive[k] for k in ('bytes','sha256')}, 'Native retained output file must match independent useful archive bytes'
            (out/(root.name+'-children.json')).write_text(json.dumps({'applicationReads':len(reads),'children':children},indent=2)+'\n')
            return result,reads,children
        replay=out/'saved-runtime';shutil.copytree(source,replay)
        result,reads,children=consumer(replay)
        assert len(reads)==children.count('application_dispatch_http.py')==3 and children.count('url_transport.py')==0, 'Native saved output must check three current permissions without another archive GET'
        assert result['archive']==expected['archive'], 'Native saved output must preserve exact useful archive custody'
        rows.append({'case':'saved-replay','applicationReads':3,'archiveGets':0,'archive':original_archive})
        print('saved output replay: current RPC and exact bytes',flush=True)
        sql("UPDATE public.workspace_members SET role='viewer' WHERE "+where+';')
        before=next(replay.glob('preparation-*/output-intake/completed.json')).read_bytes()
        try:consumer(replay)
        except PermissionError as error:assert str(error)=='Runtime observation current application access refused'
        else:raise AssertionError('Native output must refuse a revoked original actor')
        assert next(replay.glob('preparation-*/output-intake/completed.json')).read_bytes()==before, 'Revoked replay must preserve original complete receipt'
        rows.append({'case':'revoked-replay','outcome':'refused'})
        sql("UPDATE public.workspace_members SET role='member' WHERE "+where+';')
        attestor=Attestor(engine,'/var/run/docker.sock',0)
        for _ in range(120):
            try:
                attestor(engine,time.monotonic()+2,owned=lambda:True)
                import urllib.request
                with urllib.request.urlopen(engine['endpoint']+'/info',timeout=1) as response:
                    assert json.loads(response.read(1048577))['version']=='2.2.4'
                break
            except (OSError,ValueError,TimeoutError):time.sleep(.25)
        else:raise TimeoutError('Owned original useful engine readiness')
        fresh=out/'download-runtime';shutil.copytree(source,fresh,ignore=shutil.ignore_patterns('output-intake','output-archive'))
        result,reads,children=consumer(fresh)
        assert len(reads)==children.count('application_dispatch_http.py')==5 and children.count('url_transport.py')==1 and children.count('native_engine_attestation.py')==2, 'Native output download must use five current permissions, one archive GET and two engine checks'
        assert result['archive']['archive']==original_archive, 'Native original archive download must match retained useful bytes'
        assert result['callbackPermission'] is False and result['publicationPermission'] is False and result['archive']['processingQualityVerification']=='unassessed', 'Native output cannot promote callback, publication or quality'
        rows.append({'case':'native-download','applicationReads':5,'archiveGets':1,'engineChecks':2,'archive':original_archive})
        print('original native download: current RPC and exact bytes',flush=True)
        revoked=out/'revoked-download-runtime';shutil.copytree(source,revoked,ignore=shutil.ignore_patterns('output-intake','output-archive'))
        try:consumer(revoked,revoke_at=3)
        except PermissionError as error:assert str(error)=='Runtime observation current application access refused'
        else:raise AssertionError('Native output must refuse revocation after actual archive GET')
        prepared=next(revoked.glob('preparation-*'))
        assert len(list((prepared/'output-intake/objects').glob('*.bin')))==1 and not (prepared/'output-intake/completed.json').exists() and not (prepared/'output-archive').exists(), 'Native post-download revocation cannot confirm bytes or archive custody'
        rows.append({'case':'revoked-after-get','outcome':'refused','unconfirmedObjects':1})
        sql("UPDATE public.workspace_members SET role='member' WHERE "+where+';')
        result,reads,children=consumer(revoked)
        assert result['archive']['archive']==original_archive and len(list((prepared/'output-intake/objects').glob('*.bin')))==2, 'Native recovery must retain both bounded attempts and preserve useful bytes'
        rows.append({'case':'restored-after-get','applicationReads':len(reads),'archiveGets':children.count('url_transport.py'),'objects':2})
        (out/'results.json').write_text(json.dumps({'cases':rows,'permissionEvidence':'actual_retained_schema_rpc','processingPermissionEvidence':'historical_supplied_receipts','currentMainRestoreVerification':'unassessed','surveyAccuracyVerification':'unassessed','publicationPermission':False},indent=2)+'\n')
        print(json.dumps({'cases':len(rows),'nativeOutputCurrentPermissionRecovery':True}),flush=True)
    finally:
        if inspect(pg)['State']['Running']:
            sql("UPDATE public.workspace_members SET role='member' WHERE "+where+';')
        stopped=[]
        for identity in reversed(started):
            v=inspect(identity)
            if v['State']['Running']:subprocess.run(['docker','stop','--time','120',identity],check=True,stdout=subprocess.DEVNULL)
            v=inspect(identity);assert not v['State']['Running'] and not v['State']['OOMKilled']
            stopped.append({'id':identity,'running':False,'oomKilled':False,'memory':v['HostConfig']['Memory'],'memorySwap':v['HostConfig']['MemorySwap']})
        (out/'stopped.json').write_text(json.dumps(stopped,indent=2)+'\n')
        group=Path('/sys/fs/cgroup')/Path('/proc/self/cgroup').read_text().split('0::',1)[1].strip().lstrip('/')
        (out/'resources.json').write_text(json.dumps({k:(group/k).read_text().strip() for k in ['memory.max','memory.peak','memory.swap.max','memory.swap.peak','memory.events']},indent=2)+'\n')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['repo','fixture','useful','out']:parser.add_argument('--'+name,type=Path,required=True)
    args=parser.parse_args();run(args.repo.resolve(),args.fixture.resolve(),args.useful.resolve(),args.out.resolve())
