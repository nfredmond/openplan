"""Exercise service and ordinary roles through an isolated PostgREST process."""
import argparse,base64,concurrent.futures,hashlib,hmac,importlib.util,json,os,re,selectors,subprocess,time,uuid
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit,urlunsplit
from urllib.request import Request,urlopen


def run(repo,fixture,out):
    os.umask(0o077);out.mkdir(mode=0o700,parents=True)
    spec=importlib.util.spec_from_file_location('native_definitions',repo/'docs/reviews/2026-10-12-odm-private-dispatch-reader/native_rpc_recovery.py')
    definitions=importlib.util.module_from_spec(spec);spec.loader.exec_module(definitions)
    pg='a79d62deecea7fd1d1099b35863ca3de50ef7f44618c3c130c9f5b34b024bed3'
    old='3c6255798df56cb37d42b9aa226123919409cbf5d50ce57c97c9000ecb76950f'
    inspect=lambda identity:json.loads(subprocess.check_output(['docker','inspect',identity]))[0]
    pv,rv=inspect(pg),inspect(old)
    for identity,v,image,memory in [(pg,pv,definitions.PG_IMAGE,1073741824),(old,rv,definitions.REST_IMAGE,134217728)]:
        assert v['Id']==identity and v['Image']==image
        if identity==pg:assert v['Config']['Labels'].get('openplan.purpose')==definitions.PURPOSE
        else:
            origin=Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/odm-output-schema-recovery-20261014/main41c-controls-01/baseline-private')
            assert v['Config']['Labels'].get('openplan.proof')==str(origin)
            saved_env=dict(line.split('=',1) for line in (origin/'upgraded-postgrest-private.env').read_text().splitlines())
            actual_env=dict(value.split('=',1) for value in v['Config']['Env'] if '=' in value)
            assert all(actual_env.get(key)==value for key,value in saved_env.items()),'Retained REST provenance differs'
        assert v['HostConfig']['Memory']==v['HostConfig']['MemorySwap']==memory and not v['HostConfig']['PortBindings'] and not v['State']['Running']
    network=next(iter(pv['NetworkSettings']['Networks']));net=json.loads(subprocess.check_output(['docker','network','inspect',network]))[0]
    assert net['Internal'] and net['Labels']['openplan.purpose']==definitions.PURPOSE
    saved=json.loads((fixture/'database.json').read_text());database=saved['database']
    assert saved['candidateHistory']==418 and database.startswith('node_observation_')
    assert hashlib.sha256((repo/'openplan/supabase/migrations/20261017000015_node_queue_process_observations.sql').read_bytes()).hexdigest()==saved['migrationSha256']
    env=dict(x.split('=',1) for x in rv['Config']['Env'] if '=' in x);uri=urlsplit(env['PGRST_DB_URI'])
    env={k:v for k,v in env.items() if k.startswith('PGRST_')};env['PGRST_DB_URI']=urlunsplit((uri.scheme,uri.netloc,'/'+database,uri.query,uri.fragment));env['PGRST_DB_POOL']='2'
    assert all('\n' not in value for value in env.values());private=out/'postgrest-private.env';private.write_text('\n'.join(k+'='+v for k,v in env.items())+'\n')
    rest=None;started=False;granted=False;records=[];harmless=False;requests=[]
    def sql(text):
        result=subprocess.run(['docker','exec','-i',pg,'psql','-XqAt','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1'],input=text.encode(),capture_output=True,timeout=30)
        assert result.returncode==0,'Owned process HTTP database operation failed';return result.stdout.decode().strip()
    def token(role):
        encode=lambda value:base64.urlsafe_b64encode(json.dumps(value,separators=(',',':')).encode()).rstrip(b'=')
        raw=encode({'alg':'HS256','typ':'JWT'})+b'.'+encode({'role':role,'exp':int(time.time())+600})
        return (raw+b'.'+base64.urlsafe_b64encode(hmac.new(env['PGRST_JWT_SECRET'].encode(),raw,hashlib.sha256).digest()).rstrip(b'=')).decode()
    def request(role,path,body=None):
        headers={'authorization':'Bearer '+token(role),'content-type':'application/json'}
        req=Request(endpoint+path,data=None if body is None else ((' '+json.dumps(body)+' \n') if harmless else json.dumps(body)).encode(),headers=headers)
        try:
            with urlopen(req,timeout=5) as response:return response.status,json.loads(response.read())
        except HTTPError as error:
            with error:
                body=json.loads(error.read());requests.append({'role':role,'path':path,'status':error.code,'code':body.get('code')})
                (out/'http-refusals.json').write_text(json.dumps(requests,indent=2)+'\n')
                return error.code,body
    def refuse(role):
        status,body=request(role,'/rpc/read_node_queue_process_observations',{})
        assert status==(401 if role=='anon' else 403) and body.get('code')=='42501','Ordinary role cannot execute the process reader'
        status,body=request(role,'/node_queue_process_observations?select=worker_kind')
        assert status==(401 if role=='anon' else 403) and body.get('code')=='42501','Ordinary role cannot read process observations'
        fields={'p_worker_kind':'provider-api','p_instance':str(uuid.uuid4()),'p_sequence':1,'p_state':'running','p_build_sha':None}
        status,body=request(role,'/rpc/record_node_queue_process_observation',fields)
        assert status==(401 if role=='anon' else 403) and body.get('code')=='42501','Ordinary role cannot execute the process writer'
    def late_arrival():
        identity=str(uuid.uuid4());fields={'p_worker_kind':'provider-api','p_instance':identity,'p_sequence':1,'p_state':'running','p_build_sha':None}
        assert request('service_role','/rpc/record_node_queue_process_observation',fields)==(200,True)
        locker=subprocess.Popen(['docker','exec','-i',pg,'psql','-XqAt','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        ready=selectors.DefaultSelector();ready.register(locker.stdout,selectors.EVENT_READ)
        try:
            command="BEGIN; SELECT public.record_node_queue_process_observation('provider-api','"+identity+"',2,'stopped',NULL);\n"
            locker.stdin.write(command.encode());locker.stdin.flush()
            assert ready.select(3),'Owned process stop transaction did not become ready'
            assert locker.stdout.readline().strip()==b't','Owned process stop transaction must retain its row lock'
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                fields.update(p_sequence=3,p_state='running');pending=pool.submit(request,'service_role','/rpc/record_node_queue_process_observation',fields)
                deadline=time.monotonic()+2
                while time.monotonic()<deadline:
                    waiting=sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%record_node_queue_process_observation%' AND pid<>pg_backend_pid());")
                    if waiting=='t':break
                    assert not pending.done(),'Late HTTP write must actually wait on the owned stop lock'
                    time.sleep(.02)
                else:raise AssertionError('Late HTTP process write never reached the database lock')
                locker.stdin.write(b'COMMIT;\n');locker.stdin.flush()
                assert pending.result(timeout=4)==(200,False),'Blocked late HTTP write cannot revive a committed stopped process'
            state=sql("SELECT state FROM public.node_queue_process_observations WHERE worker_kind='provider-api' AND instance_id='"+identity+"';")
            assert state=='stopped','Committed stopped process remains stopped after the late HTTP write'
        finally:
            ready.close()
            try:
                if locker.poll() is None:locker.communicate(b'ROLLBACK;\n\\q\n',timeout=5)
            except subprocess.TimeoutExpired:
                locker.terminate();locker.communicate(timeout=5)
        return {'observedDatabaseLock':True,'lateReceipt':False,'retainedState':'stopped'}
    try:
        subprocess.run(['docker','start',pg],check=True,capture_output=True);started=True
        for _ in range(60):
            if subprocess.run(['docker','exec',pg,'pg_isready','-U','postgres'],capture_output=True).returncode==0:break
            time.sleep(.1)
        else:raise AssertionError('Owned process HTTP database not ready')
        assert sql('SELECT count(*) FROM supabase_migrations.schema_migrations;')=='418'
        result=subprocess.run(['docker','create','--pull=never','--name','openplan-node-observation-'+uuid.uuid4().hex[:12],'--network',network,'--memory=128m','--memory-swap=128m','--cpus=1','--pids-limit=128','--label','openplan.proof='+str(out),'--env-file',str(private),definitions.REST_IMAGE],capture_output=True,check=True)
        rest=result.stdout.decode().strip();subprocess.run(['docker','start',rest],capture_output=True,check=True)
        info=inspect(rest);assert info['Image']==definitions.REST_IMAGE and info['Config']['Labels']['openplan.proof']==str(out)
        assert info['HostConfig']['Memory']==info['HostConfig']['MemorySwap']==134217728 and not info['HostConfig']['PortBindings']
        endpoint='http://'+info['NetworkSettings']['Networks'][network]['IPAddress']+':3000'
        (out/'ownership.json').write_text(json.dumps({'database':database,'container':pg,'rest':rest,'retained':True},indent=2)+'\n')
        for _ in range(80):
            try:
                status,reading=request('service_role','/rpc/read_node_queue_process_observations',{})
                if status==200:break
            except OSError:pass
            time.sleep(.1)
        else:raise AssertionError('Owned process reader HTTP not ready')
        expected=sorted(['document-exports','engagement-email','provider-api','translation-generation','synthesis-preparation','synthesis-execution','contract-calculations','gtfs-ingestion'])
        for label in ['baseline','harmless','restored-after-harmless']:
            harmless=label=='harmless'
            for role in ['anon','authenticated']:refuse(role)
            status,reading=request('service_role','/rpc/read_node_queue_process_observations',{})
            assert status==200 and reading['scope']=='process_only' and reading['jobCompletion']=='unassessed'
            assert sorted(row['kind'] for row in reading['queues'])==expected,'HTTP registry differs'
            for kind in expected:
                identity=str(uuid.uuid4());fields={'p_worker_kind':kind,'p_instance':identity,'p_sequence':1,'p_state':'running','p_build_sha':'a'*40}
                assert request('service_role','/rpc/record_node_queue_process_observation',fields)==(200,True),'Service role must record the original process'
                assert request('service_role','/rpc/record_node_queue_process_observation',fields)==(200,True),'Exact HTTP replay must agree'
                fields.update(p_sequence=2,p_state='stopped')
                assert request('service_role','/rpc/record_node_queue_process_observation',fields)==(200,True)
                fields.update(p_sequence=3,p_state='running')
                assert request('service_role','/rpc/record_node_queue_process_observation',fields)==(200,False),'Late HTTP arrival cannot revive a stopped instance'
            records.append({'control':label,'outcome':'survived','roles':3,'workerKinds':8});print(label+' survived',flush=True)
        for label in ['late-baseline','late-harmless','late-restored']:
            harmless=label=='late-harmless';facts=late_arrival();records.append({'control':label,'outcome':'survived',**facts})
        migration=(repo/'openplan/supabase/migrations/20261017000015_node_queue_process_observations.sql').read_text()
        original=re.search(r'CREATE FUNCTION public.record_node_queue_process_observation\(.*?\$\$;',migration,re.S).group(0).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1)
        assert original.count(" AND original.state<>'stopped'")==1
        try:
            sql(original.replace(" AND original.state<>'stopped'",''))
            try:late_arrival()
            except AssertionError as error:
                assert str(error)=='Blocked late HTTP write cannot revive a committed stopped process'
                records.append({'control':'late-revival','outcome':'intended_failure','reason':str(error)})
            else:raise AssertionError('Late HTTP fault did not challenge stopped-state fencing')
        finally:sql(original)
        records.append({'control':'late-restored-final','outcome':'survived',**late_arrival()})
        sql('GRANT SELECT ON public.node_queue_process_observations TO authenticated; GRANT EXECUTE ON FUNCTION public.read_node_queue_process_observations() TO authenticated;');granted=True
        try:refuse('authenticated')
        except AssertionError as error:assert str(error)=='Ordinary role cannot execute the process reader';records.append({'control':'reader-grant','outcome':'intended_failure','reason':str(error)})
        else:raise AssertionError('HTTP permission control did not detect the broken grant')
        sql('REVOKE SELECT ON public.node_queue_process_observations FROM authenticated; REVOKE EXECUTE ON FUNCTION public.read_node_queue_process_observations() FROM authenticated;');granted=False
        for role in ['anon','authenticated']:refuse(role)
        records.append({'control':'restored-final','outcome':'survived'})
        (out/'controls.json').write_text(json.dumps(records,indent=2)+'\n');print('Owned PostgREST role and process controls complete',flush=True)
    finally:
        try:
            if granted:sql('REVOKE SELECT ON public.node_queue_process_observations FROM authenticated; REVOKE EXECUTE ON FUNCTION public.read_node_queue_process_observations() FROM authenticated;')
        finally:
            try:
                if rest:subprocess.run(['docker','stop','--time','10',rest],check=True,capture_output=True,timeout=20)
            finally:
                if started:subprocess.run(['docker','stop','--time','10',pg],check=True,capture_output=True,timeout=20)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--repo',type=Path,required=True);parser.add_argument('--fixture',type=Path,required=True);parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args();run(args.repo.resolve(),args.fixture.resolve(),args.out.resolve())
