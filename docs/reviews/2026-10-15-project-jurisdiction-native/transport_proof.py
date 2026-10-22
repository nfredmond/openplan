"""New loopback-only PostgREST transport, synthetic JWTs, generated target only."""
import base64
import contextlib
import datetime as dt
import hashlib
import hmac
import json
import os
from pathlib import Path
import socket
import subprocess
import time
import urllib.parse
import uuid

import requests
from native_proof import BASE, CLUSTER, NAME, Proof, command, digest, write

IMAGE='sha256:2f8e7b656f09db697a8875177694b417b35cb76c21370de07fc54e711e902326'
NETWORK='supabase_network_openplan-restore-target-2026091050'
URL='http://127.74.17.10:29944'
PURPOSE='project-jurisdiction-native-20261015'

def run(run_name):
    os.umask(0o077)
    p=Proof(BASE/run_name); f=p.plan['fixtures']; target=p.plan['databases']['up']
    out=p.out/('transport-'+uuid.uuid4().hex[:10]);out.mkdir(mode=0o700)
    p.observation_path=out/'observations.json'
    with socket.socket() as sock:
        sock.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
        sock.bind(('127.74.17.10',29944))
    original=json.loads(command(['docker','inspect','e743ca20ff99bb6db5dd7152850a0f81dd1454e90a095ba5b88b767cc51bd9c2']))[0]
    assert original['Id']=='e743ca20ff99bb6db5dd7152850a0f81dd1454e90a095ba5b88b767cc51bd9c2' and original['Image']==IMAGE,'retained cached helper binding'
    oldenv=dict(row.split('=',1) for row in original['Config']['Env'] if '=' in row)
    uri=urllib.parse.urlsplit(oldenv['PGRST_DB_URI'])
    assert uri.hostname==NAME and uri.username=='authenticator','helper source URI cluster'
    options=urllib.parse.urlencode({'options':'-c work_mem=16MB -c statement_timeout=10000 -c lock_timeout=3000'},quote_via=urllib.parse.quote)
    uri=urllib.parse.urlunsplit(uri._replace(path='/'+target,query=options))
    secret=uuid.uuid4().hex+uuid.uuid4().hex
    env={'PGRST_DB_URI':uri,'PGRST_JWT_SECRET':secret,'PGRST_DB_SCHEMAS':'public','PGRST_DB_ANON_ROLE':'anon',
       'PGRST_OPENAPI_MODE':'disabled','PGRST_DB_POOL':'2','PGRST_DB_POOL_ACQUISITION_TIMEOUT':'5','PGRST_SERVER_PORT':'3000'}
    envfile=out/'runtime-private.env';envfile.write_text('\n'.join(k+'='+v for k,v in env.items())+'\n');envfile.chmod(0o600)
    name='openplan-jurisdiction-native-rest-'+uuid.uuid4().hex[:12]
    receipt={'name':name,'database':target,'image':IMAGE,'environmentSha256':digest(env),'memory':536870912,'memorySwap':536870912,'publish':URL}
    write(out/'receipt.json',receipt)
    identity=command(['docker','run','--detach','--pull','never','--name',name,'--network',NETWORK,'--publish','127.74.17.10:29944:3000',
       '--memory','536870912','--memory-swap','536870912','--cpus','0.5','--pids-limit','128','--label','openplan.purpose='+PURPOSE,
       '--label','openplan.proof.database='+target,'--env-file',str(envfile),IMAGE]).decode().strip()
    receipt['id']=identity;write(out/'receipt.json',receipt)
    def info():
        value=json.loads(command(['docker','inspect',identity]))[0]
        assert value['Id']==identity and value['Name']=='/'+name and value['Image']==IMAGE,'new helper exact identity'
        assert value['Config']['Labels']['openplan.purpose']==PURPOSE and value['Config']['Labels']['openplan.proof.database']==target,'new helper owner'
        assert value['HostConfig']['Memory']==536870912 and value['HostConfig']['MemorySwap']==536870912,'new helper cap'
        assert value['HostConfig']['PortBindings']=={'3000/tcp':[{'HostIp':'127.74.17.10','HostPort':'29944'}]},'new helper loopback only'
        assert list(value['NetworkSettings']['Networks'])==[NETWORK] and value['Mounts']==[],'new helper network and mounts'
        assert dict(v.split('=',1) for v in value['Config']['Env'] if '=' in v)['PGRST_DB_URI']==uri,'new helper target URI'
        return value
    def jwt(role,actor=None):
        def enc(data):return base64.urlsafe_b64encode(json.dumps(data,separators=(',',':')).encode()).decode().rstrip('=')
        claims={'role':role,'exp':int(time.time())+300}
        if actor:claims['sub']=actor
        msg=enc({'alg':'HS256','typ':'JWT'})+'.'+enc(claims)
        return msg+'.'+base64.urlsafe_b64encode(hmac.new(secret.encode(),msg.encode(),hashlib.sha256).digest()).decode().rstrip('=')
    session=requests.Session();session.trust_env=False
    def request(method,path,role='authenticated',actor=None,body=None):
        response=session.request(method,URL+path,headers={'Authorization':'Bearer '+jwt(role,actor),'Prefer':'return=representation'},json=body,timeout=8)
        return {'status':response.status_code,'body':response.json()}
    try:
        info()
        for _ in range(40):
            try:
                r=request('GET','/projects?select=id&limit=0','service_role')
                if r['status']==200:break
            except requests.RequestException:pass
            time.sleep(.1)
        assert r['status']==200,'new helper ready'
        version=command(['docker','exec',identity,'postgrest','--version']).decode().strip()
        assert '14.15' in version,'PostgREST pinned version'
        p.record('postgrest-identity',{'id':identity,'version':version,'target':target,'limits':receipt})
        path='/projects?id=eq.'+f['race']
        with contextlib.closing(p.up()) as c:
            originalrow=p.row(c)
            for actor in ('owner','admin','member'):
                forged=p.context(f['foreignActor'],'transport forged')
                r=request('PATCH',path,actor=f[actor],body={'jurisdiction_context':forged})
                assert r['status']==403 and r['body']['code']=='42501','JWT direct context 42501 maps to403'
                assert p.row(c)==originalrow,'HTTP refusal exact row unchanged'
                p.record('jwt-direct-'+actor,r)
            for actor in ('viewer','outsider','foreignActor',None):
                r=request('GET','/projects?select=id&id=eq.'+f['race'],actor=f.get(actor))
                assert r['status']==200 and len(r['body'])==(1 if actor=='viewer' else 0),'JWT RLS read isolation'
                p.record('jwt-read-'+str(actor),r)
            for actor in ('viewer','foreignActor',None):
                context=p.context(f.get(actor))
                if actor is None:context.pop('recordedBy')
                r=request('PATCH',path,'service_role',body={'jurisdiction_context':context})
                assert r['status']==403 and r['body']['code']=='42501','JWT service nonwriter mapping'
                assert p.row(c)==originalrow,'HTTP service refusal unchanged'
                p.record('jwt-service-refused-'+str(actor),r)
            lower=p.query(c,'select clock_timestamp() t')[0]['t']
            r=request('PATCH',path,'service_role',body={'jurisdiction_context':p.context(f['member'],'transport writer')})
            upper=p.query(c,'select clock_timestamp() t')[0]['t']
            assert r['status']==200 and len(r['body'])==1,'JWT service writer saves'
            saved=r['body'][0]; stamp=dt.datetime.fromisoformat(saved['jurisdiction_context']['recordedAt'])
            assert lower<=stamp<=upper and saved['jurisdiction_context']['recordedBy']==f['member'],'JWT service DB time and attribution'
            p.record('jwt-service-writer',r)
            bad=p.context(f['member']);bad['entries'][0]['reference']='not namespaced'
            before=p.row(c);r=request('PATCH',path,'service_role',body={'jurisdiction_context':bad})
            assert r['status']==400 and r['body']['code']=='23514','JWT constraint23514 maps400'
            assert p.row(c)==before,'HTTP invalid constraint row unchanged';p.record('jwt-constraint',r)
            # Harmless installed SQL, then the same actual transport assertion with role guard removed.
            guard=p.guard_definition(c)
            try:
                p.query(c,guard.replace('BEGIN','BEGIN\n-- harmless transport proof comment',1))
                r=request('PATCH',path,actor=f['owner'],body={'jurisdiction_context':p.context()})
                assert r['status']==403 and r['body']['code']=='42501','transport harmless survivor'
                p.record('transport-harmless',{'outcome':'survived',**r})
                p.query(c,guard.replace("IF current_user NOT IN ('service_role', 'postgres') THEN",'IF false THEN'))
                r=request('PATCH',path,actor=f['owner'],body={'jurisdiction_context':p.context()})
                failed=False
                try:assert r['status']==403 and isinstance(r['body'],dict) and r['body'].get('code')=='42501','JWT direct context 42501 maps to403'
                except AssertionError as e:failed=str(e)=='JWT direct context 42501 maps to403'
                assert failed and r['status']==200,'transport intended broken SQL failure'
                p.record('transport-role-guard-removed',{'outcome':'killed','actual':r})
            finally:p.query(c,guard)
            assert p.guard_definition(c)==guard,'transport installed guard restored'
            r=request('PATCH',path,actor=f['owner'],body={'jurisdiction_context':p.context(f['admin'])})
            assert r['status']==403 and r['body']['code']=='42501','transport restored direct refusal'
            p.record('transport-restored',r)
        write(out/'result.json',{'status':'passed','id':identity,'version':version,'target':target,'blind':'Synthetic JWT directly to PostgREST. No Next route, cookie, browser, auth provider, email or whole-installation restore acceptance.'})
    finally:
        value=info()
        logs=subprocess.run(['docker','logs',identity],capture_output=True,timeout=10)
        (out/'service-private.log').write_bytes(logs.stdout+logs.stderr)
        if value['State']['Running']:command(['docker','stop','--time','5',identity])
        value=info();assert not value['State']['Running'],'owned helper stopped'
        write(out/'stopped.json',{'id':identity,'running':False,'oomKilled':value['State']['OOMKilled'],'exitCode':value['State']['ExitCode']})
    print('EVIDENCE '+str(out))

if __name__=='__main__':
    import sys
    run(sys.argv[1])
