"""Actual owned runtime draft init/upload against fresh pinned synthetic engines."""
import argparse,base64,copy,hashlib,importlib.util,json,os,shutil,subprocess,sys,tempfile,time,uuid
from pathlib import Path
REPO=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(REPO/'workers/odm_worker'))
from admission_journal import FILENAME
from engine_effects import parsed_reply
from runtime_admission import Runtime
from runtime_preparation import Preparation
from runtime_draft import Draft
import test_runtime_preparation as fixture

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
prior=load('prior_zip_engine',REPO/'docs/reviews/2026-10-11-odm-zip-engine-integration/native_engine.py')
native,helper,IMAGE,PORT,CLIENT,multipart=prior.native,prior.helper,prior.IMAGE,prior.PORT,prior.CLIENT,prior.multipart
EXPECTED={'ownedEngineCount':2,'nativeInitCount':2,'nativeUploadCount':3,'nativeCommandCount':5,
    'allResponsesChecked':True,'actualRuntimeCallsDraft':True,'lostUploadRemainsUnresolved':True,
    'noUncertainReissue':True,'restoredUncertainHold':True,'restoredAdmissionExact':True,
    'completeDraftHoldsCommit':True,'noCommitIntents':True,'noCommitRequests':True,
    'allContextAndPlansOriginal':True,'allExactUploadedBytes':True,'allInspectionsPassed':True,
    'partialNativeCustodyMatches':True,'completeNativeCustodyMatches':True,
    'inspectionDeniesTransport':True,'allPackagesVerified':True,'allProtectedRootsUnchanged':True,
    'allProtectedPackagesUnchanged':True,'allOwnedEnginesStopped':True,'allImagesPinned':True,
    'allNetworksIsolated':True,'allEngineMemoryLimitsDeclared':True,'sourceBindingsUnchanged':True}

def observe(values):
    for key,expected in EXPECTED.items():
        if key not in values or type(values[key]) is not type(expected) or values[key]!=expected:raise ValueError('runtime-draft-native-'+key)

def save(path,value):native.save(path,value)

def checked_response(response,plan,operation):
    if not isinstance(response,dict) or set(response)!={'status','body'} or type(response['status']) is not int or response['status']!=200 or not isinstance(response['body'],str):
        raise ValueError('Native original response envelope differs')
    value=parsed_reply(plan,operation,response['status'],response['body'].encode())
    expected={'uuid':plan['taskUuid']} if operation=='init' else {'success':True}
    if value!=expected:raise ValueError('Native original response fields differ')
    return value


def response_controls(out):
    plan={'taskUuid':'12345678-1234-4234-8234-123456789abc'}
    valid={'status':200,'body':json.dumps({'uuid':plan['taskUuid']})}
    rows=[]
    for label,value in (('baseline',valid),('harmless-json-spacing',{'status':200,'body':'{ "uuid": "'+plan['taskUuid']+'" }\n'}),('restored',dict(valid))):
        if checked_response(value,plan,'init')!={'uuid':plan['taskUuid']}:raise AssertionError('Valid native response refused')
        rows.append({'control':label,'outcome':'survived'})
    for label,value,operation in (
        ('wrong-uuid',{'status':200,'body':'{"uuid":"another"}'},'init'),
        ('missing-status',{'body':valid['body']},'init'),
        ('wrong-status-type',{'status':True,'body':valid['body']},'init'),
        ('extra-envelope',{**valid,'extra':True},'init'),
        ('wrong-body-type',{'status':200,'body':{}},'init'),
        ('upload-success-integer',{'status':200,'body':'{"success":1}'},'upload:0'),
        ('upload-error',{'status':200,'body':'{"error":"synthetic"}'},'upload:0'),
        ('duplicate-keys',{'status':200,'body':'{"success":false,"success":true}'},'upload:0'),
        ('extra-fields',{'status':200,'body':json.dumps({'uuid':plan['taskUuid'],'extra':True})},'init')):
        try:checked_response(value,plan,operation)
        except ValueError as error:rows.append({'control':label,'outcome':'intended_refusal','reason':str(error)})
        else:raise AssertionError('Invalid native response survived '+label)
    import inspect
    source=inspect.getsource(checked_response)
    for label,before,after,bad in (
        ('envelope-guard-removed',"    if not isinstance(response,dict) or set(response)!={'status','body'} or type(response['status']) is not int or response['status']!=200 or not isinstance(response['body'],str):",'    if False:',{**valid,'extra':True}),
        ('field-guard-removed',"    if value!=expected:raise ValueError('Native original response fields differ')",'    pass # fields unchecked',{'status':200,'body':json.dumps({'uuid':plan['taskUuid'],'extra':True})})):
        if source.count(before)!=1:raise AssertionError('Native response control anchor differs')
        namespace={'parsed_reply':parsed_reply};exec(compile(source.replace(before,after,1),'<native-response-control>','exec'),namespace)
        try:
            try:namespace['checked_response'](bad,plan,'init')
            except ValueError:pass
            else:raise AssertionError('Native response guard must refuse '+label)
        except AssertionError as error:rows.append({'control':label,'outcome':'intended_failure','reason':str(error)})
        else:raise AssertionError('Broken native response guard did not fail its oracle')
    save(out/'response-controls.json',rows);return rows


def run(out):
    os.umask(0o077);out.mkdir(mode=0o700);began=time.monotonic()
    containers,stopped,packages,roots,responses=[],{}, {},{},[]
    paths=[Path(__file__),Path(prior.__file__),Path(native.__file__),Path(helper.__file__),
        REPO/'openplan/scripts/ops/odm_draft_custody.py',REPO/'openplan/scripts/ops/worker_root_snapshot.py',REPO/'openplan/scripts/ops/worker_journal_snapshot.py',
        *sorted((REPO/'workers/odm_worker').glob('*.py'))]
    hashes={str(p.relative_to(REPO)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
    config=out/'config.json';save(config,{'logger':{'logDirectory':'/tmp','level':'error'}})
    counter=0;reply_controls=response_controls(out)
    def command(label, args, data=None, timeout=30):
        result = subprocess.run(list(map(str, args)), cwd=REPO, input=data, capture_output=True,
            env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'}, timeout=timeout)
        (out/(label+'.stdout')).write_bytes(result.stdout);(out/(label+'.stderr')).write_bytes(result.stderr)
        return result
    def state(container):
        result = subprocess.run(['docker','inspect',container], capture_output=True, check=True, timeout=10)
        return native.check_owner(json.loads(result.stdout)[0], out)
    def stop(container):
        if container in stopped: return stopped[container]
        value = state(container)
        if value['State']['Running']:
            command('stop-'+container[:12], ['docker','stop','--time=15',container], timeout=25)
        value = state(container);stopped[container] = value
        native.save(out/('container-'+container[:12]+'.json'), value)
        logs = command('logs-'+container[:12], ['docker','logs',container], timeout=10)
        (out/('container-'+container[:12]+'.log')).write_bytes(logs.stdout+logs.stderr)
        return value
    def start(root, label):
        name = 'openplan-odm-runtime-draft-'+label+'-'+uuid.uuid4().hex[:10]
        args = ['docker','create','--pull=never','--name',name,'--label','openplan.proof='+str(out),
            '--network=none','--read-only','--memory=512m','--memory-swap=512m','--cpus=1','--pids-limit=64',
            '--cap-drop=ALL','--security-opt=no-new-privileges','--user',str(os.getuid())+':'+str(os.getgid()),
            '--tmpfs',f'/tmp:rw,nosuid,nodev,size=64m,mode=0700,uid={os.getuid()},gid={os.getgid()}',
            '--mount',f'type=bind,src={root}/tmp,dst=/var/www/tmp',
            '--mount',f'type=bind,src={root}/data,dst=/var/www/data',
            '--mount',f'type=bind,src={config},dst=/proof-config.json,readonly',
            '--entrypoint=/usr/bin/node',IMAGE,'-e',"process.umask(0o077);require('/var/www/index.js');",
            '--','native-nodeodm','--port='+str(PORT),'--config=/proof-config.json']
        created = command('create-'+label, args)
        if created.returncode: raise RuntimeError('Native engine creation failed: '+label)
        container = created.stdout.decode().strip();containers.append(container)
        native.save(out/('owned-'+label+'.json'), {'id':container,'root':str(root),'image':IMAGE})
        if command('start-'+label, ['docker','start',container]).returncode:
            raise RuntimeError('Native engine start failed: '+label)
        deadline = time.monotonic()+30
        while True:
            if not state(container)['State']['Running']: raise RuntimeError('Engine exited before readiness')
            result = command('ready-'+label+'-'+str(time.monotonic_ns()),
                ['docker','exec',container,'/usr/bin/node','-e',
                 f"require('http').get('http://127.0.0.1:{PORT}/task/list',r=>{{r.resume();r.on('end',()=>process.exit(r.statusCode===200?0:1));}}).on('error',()=>process.exit(1));"], timeout=10)
            if not result.returncode: break
            if time.monotonic() >= deadline: raise RuntimeError('Native readiness deadline')
            time.sleep(0.2)
        return container
    def api(container, descriptor, fields):
        nonlocal counter
        counter += 1;body, content_type = multipart(fields)
        request = {'path':descriptor['path'], 'method':descriptor['method'], 'body':base64.b64encode(body).decode(),
            'headers':{**descriptor.get('headers', {}), 'Content-Type':content_type}}
        result = command('api-'+str(counter), ['docker','exec','-i',container,'/usr/bin/node','-e',CLIENT],
            json.dumps(request).encode(), timeout=10)
        if result.returncode: raise RuntimeError('Native API failed: '+str(counter))
        response = native.json_response(result.stdout);responses.append(response)
        return response
    def ordinary(root):return {name:row for name,row in helper.inventory(root).items() if name not in {'admissions/'+FILENAME+suffix for suffix in ('','-wal','-shm')}}
    def logical(root):return helper.sqlite_image(root/'admissions'/FILENAME)
    def capture(root,label):
        package=out/(label+'-package-private')
        captured=command('capture-'+label,[sys.executable,'-B',REPO/'openplan/scripts/ops/worker_root_snapshot.py','--source',root,'--destination',package,'--writers-quiesced','--timeout','20'])
        verified=command('verify-'+label,[sys.executable,'-B',REPO/'openplan/scripts/ops/worker_root_snapshot.py','--destination',package,'--verify'])
        if captured.returncode or verified.returncode:raise AssertionError('Actual CLI package failure '+label)
        packages[label]=(package,helper.inventory(package));return package
    values={'ownedEngineCount':0,'nativeInitCount':0,'nativeUploadCount':0,'allInspectionsPassed':True,
            'allExactUploadedBytes':True,'inspectionDeniesTransport':True,'allPackagesVerified':True,
            'allContextAndPlansOriginal':True,'noCommitIntents':True,'noCommitRequests':True}
    worker_roots=[];worker_packages=[]
    try:
        for label,lose in (('partial',True),('complete',False)):
            root=out/('engine-'+label+'-private');root.mkdir(mode=0o700)
            for name in ('tmp','data'):(root/name).mkdir(mode=0o700)
            engine=start(root,label);values['ownedEngineCount']+=1
            prior_temp=tempfile.tempdir;tempfile.tempdir=str(out)
            try:checks=fixture.Checks();checks.setUp();checks.temporary._finalizer.detach()
            finally:tempfile.tempdir=prior_temp
            checks.spec['engine'].update(instanceId=engine,endpoint='http://127.0.0.1:'+str(PORT),imageId=IMAGE,
                configurationSha256=hashlib.sha256(config.read_bytes()).hexdigest(),credentialReference='synthetic-owned-engine')
            checks.spec['options']=[]
            requests=[];gate_calls=[]
            def authorize(plan,operation,descriptor):
                owned=state(engine);gate_calls.append(operation)
                # This gate applies only to this owned synthetic fixture. It is
                # not the future application's live authorization adapter.
                return owned['State']['Running'] is True and owned['Image']==IMAGE and plan['engine']==checks.spec['engine'] and plan['binding']['originalContext']['originalActorId']=='synthetic-original-actor'
            def transport(identity,descriptor,stream,deadline):
                if descriptor['path'].startswith('/task/new/commit/'):
                    values['noCommitRequests']=False;raise AssertionError('Native draft attempted processing commit')
                if stream is None:
                    fields=[(name,value.encode(),None) for name,value in descriptor['form'].items()];values['nativeInitCount']+=1
                else:
                    raw=stream.read();slot=descriptor['multipart']['slot'];values['nativeUploadCount']+=1
                    values['allExactUploadedBytes'] &= raw==checks.raw[slot]
                    fields=[('images',raw,descriptor['multipart']['filename'])]
                response=api(engine,descriptor,fields)
                original_plan=json.loads((checks.folder/'engine/plan.json').read_bytes())
                checked_response(response,original_plan,'init' if stream is None else 'upload:'+str(descriptor['multipart']['slot']))
                requests.append({'identity':copy.deepcopy(identity),'descriptor':copy.deepcopy(descriptor),'response':response})
                if lose and stream is not None:raise RuntimeError('Observed native upload reply deliberately not journaled')
                return response['status'],response['body'].encode()
            draft=Draft(checks.preparation,authorize,transport,timeout=10);checks.runtime.pipeline=draft
            with checks.runtime.owner():
                executed=checks.runtime.run_one()
                values['actualRuntimeCallsDraft']=values.get('actualRuntimeCallsDraft',True) and executed is True and len(requests)==1
                if lose:
                    try:draft.advance(checks.request['requestId'])
                    except RuntimeError as error:
                        if str(error)!='Observed native upload reply deliberately not journaled':raise
                    else:raise AssertionError('Native acknowledgment interruption did not run')
                    before=len(requests);held=draft.advance(checks.request['requestId'])
                    values['noUncertainReissue']=held['state']=='held_uncertain' and len(requests)==before==2 and len(gate_calls)==2
                    values['lostUploadRemainsUnresolved']=(checks.folder/'engine/command-00001.intent.json').exists() and not (checks.folder/'engine/command-00001.reply.json').exists() and not (checks.folder/'engine/command-00002.intent.json').exists()
                else:
                    results=[draft.advance(checks.request['requestId']) for _ in range(3)]
                    values['completeDraftHoldsCommit']=[r['operation'] for r in results]==['upload:0','upload:1',None] and results[-1]['state']=='draft_complete_commit_held' and len(requests)==3
            plan=json.loads((checks.folder/'engine/plan.json').read_bytes());plan_hash=hashlib.sha256((checks.folder/'engine/plan.json').read_bytes()).hexdigest()
            values['allContextAndPlansOriginal'] &= plan['binding']['originalRequest']==checks.request and plan['binding']['originalAdmission']==checks.entry.admission and plan['binding']['originalContext']['originalActorId']=='synthetic-original-actor' and all(r['identity']==plan['engine'] for r in requests)
            values['noCommitIntents'] &= not (checks.folder/'engine/command-00003.intent.json').exists()
            stop(engine);engine_image=helper.inventory(root);engine_package=capture(root,'engine-'+label);roots[label]=(root,engine_image)
            before=ordinary(checks.root);before_journal=logical(checks.root)
            inspected=command('inspect-'+label,[sys.executable,'-B',REPO/'openplan/scripts/ops/odm_draft_custody.py',
                '--snapshot',engine_package,'--engine-plan',checks.folder/'engine/plan.json','--plan-sha256',plan_hash,'--max-bytes','1048576','--timeout','20'])
            values['allInspectionsPassed'] &= inspected.returncode==0
            if inspected.returncode:raise AssertionError('Native original draft inspection failed '+label)
            inspection=json.loads(inspected.stdout);save(out/('inspection-'+label+'.json'),inspection)
            values['inspectionDeniesTransport'] &= inspection['transportPermission'] is False
            matching=[{key:row[key] for key in ('slot','filename','bytes','sha256')} for row in plan['uploads'][:1 if lose else 2]]
            values['partialNativeCustodyMatches' if lose else 'completeNativeCustodyMatches']=inspection['matchingUploads']==matching and inspection['missingUploads']==([1] if lose else []) and inspection['state']==('partial_matching_draft' if lose else 'complete_matching_draft')
            if ordinary(checks.root)!=before or logical(checks.root)!=before_journal:raise AssertionError('Read-only draft inspection changed worker custody')
            worker_package=capture(checks.root,'worker-'+label);worker_roots.append((checks.root,before,before_journal));worker_packages.append((worker_package,logical(worker_package/'root')))
            if lose:
                copied=out/'restored-worker-private';shutil.copytree(worker_package/'root',copied)
                supplied=copy.deepcopy(checks.spec);supplied['sourceRoot']=out/'absent-original-input'
                current=Runtime(copied,'synthetic-installation',max_queued=0,pipeline=lambda job:None)
                preparation=Preparation(current,lambda entry:supplied,timeout=4)
                restore_draft=Draft(preparation,lambda *args:(_ for _ in ()).throw(AssertionError('Restored uncertain effect asked for permission')),lambda *args:(_ for _ in ()).throw(AssertionError('Restored uncertain effect requested transport')),timeout=4)
                with current.owner():
                    replay,first=current.submit(checks.request)
                    values['restoredAdmissionExact']=first is False and replay.admission==checks.entry.admission
                    values['restoredUncertainHold']=restore_draft.advance(checks.request['requestId'])['state']=='held_uncertain' and current.run_one() is False
        values['nativeCommandCount']=len(responses)
        values['allResponsesChecked']=len(responses)==5 and all(type(r['status']) is int and r['status']==200 and isinstance(r['body'],str) and isinstance(json.loads(r['body']),dict) and ('uuid' in json.loads(r['body']) or json.loads(r['body']).get('success') is True) for r in responses)
        values['allProtectedRootsUnchanged']=all(helper.inventory(root)==image for root,image in roots.values()) and all(ordinary(root)==image and logical(root)==journal for root,image,journal in worker_roots)
        values['allProtectedPackagesUnchanged']=all(helper.inventory(package)==image for package,image in packages.values()) and all(logical(package/'root')==journal for package,journal in worker_packages)
        states=[stop(container) for container in containers]
        values['allOwnedEnginesStopped']=all(s['State']['Running'] is False and s['State']['ExitCode']==0 and s['State']['OOMKilled'] is False for s in states)
        values['allImagesPinned']=all(s['Image']==IMAGE for s in states)
        values['allNetworksIsolated']=all(s['HostConfig']['NetworkMode']=='none' and not s['HostConfig']['PortBindings'] for s in states)
        values['allEngineMemoryLimitsDeclared']=all(s['HostConfig']['Memory']==512*1024*1024 and s['HostConfig']['MemorySwap']==512*1024*1024 for s in states)
        values['sourceBindingsUnchanged']=all(hashlib.sha256((REPO/name).read_bytes()).hexdigest()==digest for name,digest in hashes.items())
        observe(values);save(out/'observed.json',values)
        controls=[]
        for label,value in (('baseline',values),('harmless-extra-observation',{**values,'note':'harmless'}),('restored',copy.deepcopy(values))):
            observe(value);controls.append({'control':label,'outcome':'survived'})
        for key,expected in EXPECTED.items():
            for kind in ('wrong','missing','wrong-type'):
                changed=copy.deepcopy(values)
                if kind=='missing':changed.pop(key)
                elif kind=='wrong-type':changed[key]=int(expected) if type(expected) is bool else str(expected)
                else:changed[key]=not expected if type(expected) is bool else expected+1
                try:observe(changed)
                except ValueError as error:
                    if str(error)!='runtime-draft-native-'+key:raise
                    controls.append({'control':key+'-'+kind,'outcome':'intended_failure'})
                else:raise AssertionError('Native observation control survived')
        save(out/'controls.json',controls);save(out/'source-bindings.json',hashes)
        summary={'observations':len(EXPECTED),'controls':len(controls),'seconds':round(time.monotonic()-began,3),'nativeOriginalDraftCommands':5,'responseControls':len(reply_controls),
            'workerRecoveryAccepted':False,'processingCommitExecuted':False,'imageDecodingOrReconstructionExecuted':False,
            'liveApplicationAuthorityVerified':False,'allOwnedEnginesStopped':True,
            'claimLimits':['owned synthetic permission/transport adapters','observed reply deliberately omitted from worker journal, not native network loss','no processing/result/callback recovery','no independent planner or browser acceptance']}
        save(out/'summary.json',summary);print(json.dumps(summary))
    finally:
        cleanup=[]
        for container in containers:
            try:
                s=stop(container);cleanup.append({'id':container,'running':s['State']['Running'],'exit':s['State']['ExitCode']})
            except Exception as error:cleanup.append({'id':container,'cleanupError':str(error)})
        save(out/'cleanup-private.json',cleanup)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--out',type=Path,required=True);args=parser.parse_args();run(args.out.absolute())
