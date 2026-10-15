"""Use actual worker RPCs, PostgREST and JWT fixture roles on a retained clone."""
import argparse
import base64
import copy
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from urllib.parse import urlsplit

REST='3c6255798df56cb37d42b9aa226123919409cbf5d50ce57c97c9000ecb76950f'
REST_IMAGE='sha256:2f8e7b656f09db697a8875177694b417b35cb76c21370de07fc54e711e902326'
PURPOSE='odm-delivery-authority-http-20261014'


def run(repo,proof,out):
    os.umask(0o077);out.mkdir(mode=0o700,parents=True)
    spec=importlib.util.spec_from_file_location('native_original_authority',Path(__file__).with_name('native_authority.py'))
    driver=importlib.util.module_from_spec(spec);spec.loader.exec_module(driver)
    migration=(repo/driver.MIGRATION).read_bytes();saved=json.loads((proof/'result.json').read_text())
    assert saved['candidateSha256']==hashlib.sha256(migration).hexdigest(),'Native HTTP starts from the exact completed SQL candidate'
    assert shutil.disk_usage(out).free>5*1024**3,'Native HTTP clone has its disk margin'
    inspect=lambda name:json.loads(subprocess.check_output(['docker','inspect',name]))[0]
    pg=inspect(driver.PG);rest=inspect(REST)
    assert not pg['State']['Running'] and not rest['State']['Running'],'Original fixture services are stopped'
    assert pg['Id']==driver.PG and pg['Image']==driver.IMAGE and pg['Config']['Labels'].get('openplan.purpose')=='odm-private-dispatch-rpc-cli-20261012','Original PostgreSQL identity'
    assert pg['HostConfig']['Memory']==pg['HostConfig']['MemorySwap']==1073741824 and not pg['HostConfig']['PortBindings'],'PostgreSQL keeps1GiB/zero swap/no ports'
    assert rest['Id']==REST and rest['Image']==REST_IMAGE and rest['HostConfig']['Memory']==rest['HostConfig']['MemorySwap']==134217728 and not rest['HostConfig']['PortBindings'],'Original REST template identity/capacity'
    network=next(iter(pg['NetworkSettings']['Networks']));assert list(rest['NetworkSettings']['Networks'])==[network]
    net=json.loads(subprocess.check_output(['docker','network','inspect',network]))[0]
    assert net['Internal'] and net['Labels'].get('openplan.purpose')=='odm-private-dispatch-rpc-cli-20261012','Original network is internal'
    values=dict(v.split('=',1) for v in rest['Config']['Env'] if '=' in v)
    uri=urlsplit(values['PGRST_DB_URI']);assert uri.path=='/'+driver.SOURCE,'Original REST template database is selected409'
    database='odm_delivery_http_'+uuid.uuid4().hex;owned='openplan-delivery-http-'+uuid.uuid4().hex;created_id=None;sequence=0
    q=driver.quote
    root=out/'runtime';shutil.copytree(driver.PROFILE/'upgraded-runtime',root);root.chmod(0o700)
    original=json.loads(next(root.glob('original-dispatch-*/receipt.json')).read_text())
    job=original['applicationJob'];reference=original['binding']['jobReference']
    callback={'schemaVersion':json.loads(original['payloadText'])['schemaVersion'],'requestId':job['request_id'],
        'jobReference':reference,'callbackId':'native-http-original-terminal','status':'succeeded','occurredAt':'2026-10-14T14:00:00.123456789Z','artifacts':[]}
    prefix=['docker','exec','-i',driver.PG,'psql','-U','postgres','-XqAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
    def sql(text,target=database):
        nonlocal sequence
        sequence+=1;r=subprocess.run(prefix+['-d',target],input=text,text=True,capture_output=True,timeout=20)
        (out/(str(sequence).zfill(4)+'-sql-private.log')).write_text(r.stdout+r.stderr)
        assert r.returncode==0,'Actual HTTP fixture SQL succeeds'
        return r.stdout.strip()
    where=' WHERE id='+q(job['id'])+';'
    def update(fields):sql('UPDATE public.aerial_processing_jobs SET '+fields+where)
    def jwt(role):
        encode=lambda v:base64.urlsafe_b64encode(json.dumps(v,separators=(',',':')).encode()).rstrip(b'=')
        body=encode({'alg':'HS256','typ':'JWT'})+b'.'+encode({'role':role,'sub':job['created_by'],'exp':int(time.time())+3600})
        return (body+b'.'+base64.urlsafe_b64encode(hmac.new(values['PGRST_JWT_SECRET'].encode(),body,hashlib.sha256).digest()).rstrip(b'=')).decode()
    config={'runtimeRoot':str(root),'installationId':original['binding']['installationId'],'targetId':original['binding']['targetId'],'requestId':job['request_id'],'callback':callback}
    results=[]
    def phase(label,mode,expected,*,role='service_role',body=None,fault=False):
        context={**config,'token':jwt(role),'callback':body if body is not None else callback}
        path=out/(label+'-configuration-private.json');path.write_text(json.dumps(context));path.chmod(0o600)
        r=subprocess.run([sys.executable,'-B',str(Path(__file__).with_name('native_authority_client.py')),str(path),mode,expected],cwd=repo,capture_output=True,timeout=20,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
        log=(r.stdout+r.stderr).decode(errors='replace');(out/(label+'-private.log')).write_text(log)
        if fault:
            errors=re.findall(r'(?m)^([A-Za-z_][\w.]*Error:.*)$',log)
            assert r.returncode==1 and errors==['AssertionError: Actual delivery RPC preserves expected current access'],'Actual RPC fault fails its named current-access assertion'
        else:assert r.returncode==0,'Actual RPC phase succeeds: '+label+'\n'+log
        results.append({'case':label,'outcome':'intended_failure' if fault else 'survived'});print(label+' '+results[-1]['outcome'],flush=True)
    def restore_member():
        sql('INSERT INTO public.workspace_members SELECT * FROM jsonb_populate_record(NULL::public.workspace_members,'+q(member)+'::jsonb) ON CONFLICT(workspace_id,user_id) DO NOTHING;')
    member_where=' WHERE workspace_id='+q(job['workspace_id'])+' AND user_id='+q(job['created_by'])+';'
    text=migration.decode().replace('CREATE FUNCTION public.read_aerial_delivery_authority','CREATE OR REPLACE FUNCTION public.read_aerial_delivery_authority',1)
    def cohort(label,ddl):
        sql(ddl);sql("NOTIFY pgrst, 'reload schema';");time.sleep(.2)
        update("status='requested',job_reference=NULL");phase(label+'-active','artifact','true')
        update("status='succeeded',job_reference="+q(reference));phase(label+'-completed','artifact','true');phase(label+'-processing-stays-refused','processing','false')
        sql('DELETE FROM public.workspace_members'+member_where);phase(label+'-revoked','artifact','false');restore_member()
        update("status='succeeded',job_reference="+q(reference)+',last_callback_id='+q(callback['callbackId'])+',last_callback_at='+q(callback['occurredAt']))
        phase(label+'-terminal-original','terminal','true')
        changed={**callback,'message':'different original'};phase(label+'-terminal-changed','terminal','false',body=changed)
        update("job_reference='different-reference'");phase(label+'-reference-changed','artifact','false');update('job_reference='+q(reference))
        update("last_callback_at='2026-10-14T14:01:00Z'");phase(label+'-time-changed','terminal','false');update('last_callback_at='+q(callback['occurredAt']))
        phase(label+'-member-rpc','artifact','refused',role='authenticated');phase(label+'-anon-rpc','artifact','refused',role='anon')
    try:
        subprocess.run(['docker','start',driver.PG],check=True,stdout=subprocess.DEVNULL)
        end=time.monotonic()+180
        while time.monotonic()<end:
            if subprocess.run(['docker','exec',driver.PG,'pg_isready','-U','postgres'],capture_output=True).returncode==0:break
            time.sleep(.25)
        else:raise TimeoutError('Native HTTP original cluster readiness')
        assert sql('SELECT count(*) FROM pg_stat_activity WHERE datname='+q(saved['database'])+';',target='postgres')=='0','Completed proof clone has no active sessions'
        sql('CREATE DATABASE '+database+' TEMPLATE '+saved['database']+';',target='postgres')
        (out/'database-private.json').write_text(json.dumps({'container':driver.PG,'database':database,'source':saved['database']})+'\n')
        member=sql('SELECT to_jsonb(m)::text FROM public.workspace_members m'+member_where)
        assert member,'Native HTTP member fixture exists before revocation'
        sql('INSERT INTO public.aerial_processing_callbacks(processing_job_id,workspace_id,callback_id,status,occurred_at,payload) VALUES ('+','.join(q(v) for v in [job['id'],job['workspace_id'],callback['callbackId'],'succeeded',callback['occurredAt']])+','+q(json.dumps(callback))+'::jsonb);')
        env={k:v for k,v in values.items() if k.startswith('PGRST_')};env['PGRST_DB_URI']=values['PGRST_DB_URI'].removesuffix('/'+driver.SOURCE)+'/'+database
        env_file=out/'rest-env-private.txt';env_file.write_text(''.join(k+'='+v+'\n' for k,v in env.items()));env_file.chmod(0o600)
        command=['docker','create','--name',owned,'--network',network,'--memory','128m','--memory-swap','128m','--pids-limit','128','--label','openplan.purpose='+PURPOSE,'--env-file',str(env_file),REST_IMAGE]
        created_id=subprocess.check_output(command,text=True).strip();subprocess.run(['docker','start',created_id],check=True,stdout=subprocess.DEVNULL)
        actual=inspect(created_id);endpoint='http://'+actual['NetworkSettings']['Networks'][network]['IPAddress']+':3000';config['endpoint']=endpoint
        assert actual['Image']==REST_IMAGE and actual['Config']['Labels'].get('openplan.purpose')==PURPOSE and not actual['HostConfig']['PortBindings'],'New private REST owner matches its receipt'
        end=time.monotonic()+30
        while time.monotonic()<end:
            try:
                ready={'p_request':config['requestId'],'p_installation':config['installationId'],'p_target':config['targetId'],
                    'p_reference':reference,'p_operation':driver.ARTIFACT,'p_callback':None}
                request=urllib.request.Request(endpoint+'/rpc/read_aerial_delivery_authority',data=json.dumps(ready).encode(),headers={'Authorization':'Bearer '+jwt('service_role'),'Content-Type':'application/json'},method='POST')
                with urllib.request.urlopen(request,timeout=.5) as response:
                    value=json.loads(response.read(65537))
                    if response.status==200 and value.get('format')=='openplan.odm-delivery-authority.v1':break
            except (OSError,urllib.error.HTTPError):pass
            time.sleep(.1)
        else:raise TimeoutError('Actual isolated PostgREST readiness')
        for label,ddl in [('baseline',text),('harmless',text+'\n-- Harmless actual RPC authority note.\n'),('restored-after-harmless',text)]:cohort(label,ddl)
        sql(text.replace('AND callback.payload = p_callback','AND true',1));phase('changed-payload-granted','terminal','false',body={**callback,'message':'different original'},fault=True);sql(text)
        sql(text.replace("AND (job.job_reference = p_reference OR (job.job_reference IS NULL AND job.status = 'requested'))",'AND true',1));update("job_reference='different-reference'");phase('changed-reference-granted','artifact','false',fault=True);update('job_reference='+q(reference));sql(text)
        altered=text.replace('JOIN public.workspace_members member','LEFT JOIN public.workspace_members member').replace("AND member.role IN ('owner', 'admin', 'member')",'AND true')
        sql(altered);sql('DELETE FROM public.workspace_members'+member_where);phase('revoked-actor-granted','artifact','false',fault=True);restore_member();sql(text)
        altered=text.replace('SECURITY INVOKER','SECURITY DEFINER').replace('FROM PUBLIC, anon, authenticated;',"FROM PUBLIC, anon;\nGRANT EXECUTE ON FUNCTION public.read_aerial_delivery_authority(text,text,text,text,text,jsonb) TO authenticated;")
        sql(altered);phase('non-service-projection-granted','artifact','refused',role='authenticated',fault=True);sql(text)
        cohort('restored-final',text)
        (out/'controls.json').write_text(json.dumps(results,indent=2)+'\n')
        (out/'result.json').write_text(json.dumps({'database':database,'restContainer':created_id,'candidateSha256':hashlib.sha256(migration).hexdigest(),'positiveCohorts':4,'casesPerCohort':10,'faults':4,'scope':'Actual supervised worker RPC, copied original runtime, PostgREST and signed fixture roles; no hosted Auth/login, serving HTTP, terminal POST, default worker, quality or browser acceptance.'},indent=2)+'\n')
    finally:
        if created_id:
            actual=inspect(created_id)
            assert actual['Id']==created_id and actual['Image']==REST_IMAGE and actual['Config']['Labels'].get('openplan.purpose')==PURPOSE,'Only owned REST cleanup is allowed'
            if actual['State']['Running']:subprocess.run(['docker','stop','--time','120',created_id],check=True,stdout=subprocess.DEVNULL,timeout=140)
        actual=inspect(driver.PG)
        assert actual['Id']==driver.PG and actual['Image']==driver.IMAGE and actual['Config']['Labels'].get('openplan.purpose')=='odm-private-dispatch-rpc-cli-20261012','Only original owned PostgreSQL cleanup is allowed'
        if actual['State']['Running']:subprocess.run(['docker','stop','--time','120',driver.PG],check=True,stdout=subprocess.DEVNULL,timeout=140)
        assert not inspect(driver.PG)['State']['OOMKilled'],'Native HTTP owned PostgreSQL has no OOM'

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--proof',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();run(a.repo.resolve(),a.proof.resolve(),a.out.resolve())
