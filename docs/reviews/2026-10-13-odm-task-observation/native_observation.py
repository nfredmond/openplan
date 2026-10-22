"""Read real isolated engine metadata against a plan saved before API effects.

Invalid synthetic inputs cannot establish imagery quality or worker acceptance.
"""
import argparse
import base64
import hashlib
import http.client
import ipaddress
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT/'workers/odm_worker'))
from native_engine_attestation import IMAGE

from admission_journal import Journal
from engine_effects import Effects
from retained_source import json_bytes
from task_observation import observe

def run(out):
    os.umask(0o077);out.mkdir(mode=0o700)
    assert shutil.disk_usage(out).free > 5*1024**3
    config = out/'configuration.json';config.write_text('{"logger":{"logDirectory":"/tmp","level":"error"}}\n')
    containers = [];counter = 0
    fixture = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/odm-private-dispatch-producer-20261011/rpc-cli-09')
    database_id = (fixture/'create-private-database-private.log').read_text().strip()
    database = json.loads(subprocess.check_output(['docker','inspect',database_id],timeout=10))[0]
    assert database['Id'] == database_id and database['State']['Running'] is False
    purpose = database['Config']['Labels'].get('openplan.purpose')
    helper_spec=importlib.util.spec_from_file_location('retained_owned_rpc_profile',ROOT/'docs/reviews/2026-10-12-odm-private-dispatch-reader/native_rpc_recovery.py')
    helper=importlib.util.module_from_spec(helper_spec);helper_spec.loader.exec_module(helper)
    assert purpose == helper.PURPOSE and database['Image'] == helper.PG_IMAGE
    assert len(database['NetworkSettings']['Networks']) == 1
    network_name = next(iter(database['NetworkSettings']['Networks']))
    network_id = database['NetworkSettings']['Networks'][network_name]['NetworkID']
    network = json.loads(subprocess.check_output(['docker','network','inspect',network_id],timeout=10))[0]
    assert network['Id'] == network_id and network['Internal'] is True and network['Labels'].get('openplan.purpose') == purpose
    def save(name, value):(out/name).write_text(json.dumps(value, indent=2)+'\n')
    def execute(label, args, payload=None, timeout=35):
        result = subprocess.run(list(map(str,args)), input=payload, capture_output=True, cwd=ROOT, timeout=timeout)
        (out/(label+'-private.log')).write_bytes(result.stdout+result.stderr)
        assert result.returncode == 0, 'Owned restore probe command failed: '+label
        return result.stdout
    def inspect(container):
        value = json.loads(subprocess.check_output(['docker','inspect',container], timeout=10))[0]
        host = value['HostConfig']
        assert value['Id'] == container and value['Image'] == IMAGE and value['Config']['Labels'].get('openplan.proof') == str(out), 'Restore engine ownership differs'
        assert not host['PortBindings'] and host['ReadonlyRootfs'] is True
        assert list(value['NetworkSettings']['Networks']) == [network_name]
        assert value['NetworkSettings']['Networks'][network_name]['NetworkID'] == network_id
        assert host['Memory'] == host['MemorySwap'] == 536870912 and host['PidsLimit'] == 64 and host['NanoCpus'] == 1000000000
        return value
    def stop(container, label):
        value = inspect(container)
        if value['State']['Running']:execute(label+'-stop', ['docker','stop','--time=10',container])
        value = inspect(container);assert value['State']['Running'] is False
        save(label+'-stopped.json', {'id':container, 'running':False, 'oomKilled':value['State']['OOMKilled'], 'exitCode':value['State']['ExitCode'], 'memoryMaxBytes':value['HostConfig']['Memory'], 'memorySwapBytes':value['HostConfig']['MemorySwap']})
    def start(root, label):
        args = ['docker','create','--pull=never','--name','openplan-failed-task-'+uuid.uuid4().hex[:12],
            '--label','openplan.proof='+str(out),'--network='+network_id,'--read-only','--memory=512m','--memory-swap=512m',
            '--cpus=1','--pids-limit=64','--cap-drop=ALL','--security-opt=no-new-privileges',
            '--user',str(os.getuid())+':'+str(os.getgid()),
            '--tmpfs',f'/tmp:rw,nosuid,nodev,size=64m,mode=0700,uid={os.getuid()},gid={os.getgid()}',
            '--mount',f'type=bind,src={root}/tmp,dst=/var/www/tmp','--mount',f'type=bind,src={root}/data,dst=/var/www/data',
            '--mount',f'type=bind,src={config},dst=/proof-config.json,readonly','--entrypoint=/usr/bin/node',IMAGE,
            '-e',"process.umask(0o077);require('/var/www/index.js');",'--','native-nodeodm','--port=34100','--config=/proof-config.json']
        container = execute(label+'-create',args).decode().strip();containers.append(container)
        save(label+'-owned.json', {'id':container,'image':IMAGE,'root':str(root)})
        execute(label+'-start',['docker','start',container]);deadline = time.monotonic()+60
        while True:
            inspect(container)
            try:
                result = api(container,'/info')
                if result['status'] == 200:return container
            except (OSError, http.client.HTTPException):pass
            if time.monotonic()>=deadline:raise TimeoutError('Owned restored task readiness exceeded')
            time.sleep(.25)
    def api(container, path, method='GET', body=b'', headers=None):
        nonlocal counter
        counter += 1;value = inspect(container)
        address = value['NetworkSettings']['Networks'][network_name]['IPAddress']
        assert ipaddress.ip_address(address).version == 4 and ipaddress.ip_address(address).is_private
        connection = http.client.HTTPConnection(address,34100,timeout=5);deadline = time.monotonic()+5
        try:
            connection.request(method,path,body=body,headers=headers or {})
            response = connection.getresponse();parts=[];size=0
            while True:
                if response.fp is None:break
                remaining=deadline-time.monotonic()
                if remaining<=0:raise TimeoutError('Owned backend HTTP deadline exceeded')
                response.fp.raw._sock.settimeout(remaining)
                chunk=response.read1(65536)
                if not chunk:break
                size+=len(chunk);assert size<=1048576,'Owned backend HTTP response exceeds its byte bound'
                parts.append(chunk)
            result={'status':response.status,'body':b''.join(parts).decode('utf-8')}
            save('api-'+str(counter)+'-response.json',result)
            return result
        finally:connection.close()
    def body(field, data, filename=None):
        boundary = 'openplan-owned-restore-boundary';header = 'Content-Disposition: form-data; name="'+field+'"'
        if filename is not None:header += '; filename="'+filename+'"'
        return ('--'+boundary+'\r\n'+header+'\r\n\r\n').encode()+data+('\r\n--'+boundary+'--\r\n').encode(), 'multipart/form-data; boundary='+boundary
    try:
        source = out/'engine-root';source.mkdir(mode=0o700)
        for name in ('tmp','data'):(source/name).mkdir(mode=0o700)
        producer = start(source,'producer');task = str(uuid.uuid4())
        inputs = out/'inputs';inputs.mkdir(mode=0o700)
        filenames = ['invalid-'+str(index)+'.jpg' for index in range(3)]
        request = {'requestId':'synthetic-observation-request','externalRef':{'workspaceId':'synthetic-workspace','missionId':'synthetic-mission'},
            'imagery':{'type':'photo_manifest','photos':[{'filename':name,'url':'http://127.0.0.1:1/never-'+str(index)} for index,name in enumerate(filenames)]}}
        for index,name in enumerate(filenames):(inputs/name).write_bytes(b'Invalid ordinary source bytes '+str(index).encode())
        journal = Journal(out/'admissions');reference = 'synthetic-original-job'
        journal.admit(request,lambda value:(reference,{'requestId':value['requestId'],'jobReference':reference,'status':'accepted'}),max_queued=2)
        context = {key:'synthetic-'+key for key in ('installationId','originalActorId','targetId','applicationJobId')}
        context.update(workspaceId='synthetic-workspace',missionId='synthetic-mission')
        address = inspect(producer)['NetworkSettings']['Networks'][network_name]['IPAddress']
        engine = {'instanceId':producer,'endpoint':'http://'+address+':34100','api':'nodeodm-2.2.4-draft','version':'2.2.4',
            'imageId':IMAGE,'configurationSha256':hashlib.sha256(config.read_bytes()).hexdigest(),'credentialReference':'synthetic-no-secret'}
        effects = Effects(root=out/'effects',source_arguments={'journal':journal,'request_id':request['requestId'],'reference':reference,
            'context':context,'source_root':inputs,'sources':filenames,'destination':out/'retained','max_bytes':4096,'timeout':2},
            engine=engine,task_uuid=task,name='Synthetic observed invalid task',options=[],filenames=filenames)
        plan = effects.plan;plan_bytes = (effects.root/'plan.json').read_bytes()
        assert json_bytes(plan) == plan_bytes, 'Saved original plan bytes differ before API effects'
        observations = []
        effects.issue('init');raw,content_type = body('name',plan['name'].encode())
        options_raw,_ = body('options',json_bytes(plan['options']))
        ending=b'--openplan-owned-restore-boundary--\r\n'
        raw=raw[:-len(ending)]+options_raw
        reply = api(producer,'/task/new/init','POST',raw,{'Content-Type':content_type,'set-uuid':task})
        effects.save_reply('init',reply['status'],reply['body'].encode())
        reply = api(producer,'/task/'+task+'/info');raw=reply['body'].encode()
        (out/'initialized-body.bin').write_bytes(raw)
        assert json.loads(raw) == {'error':task+' not found'}, 'Initialized draft availability differs'
        try:observe(plan,reply['status'],raw)
        except ValueError as error:assert str(error) == 'Task metadata is unavailable or malformed'
        else:raise AssertionError('Uncommitted draft metadata cannot become a status observation')
        save('initialized-refusal.json',{'uncommittedDraftMetadataAccepted':False})
        for index,item in enumerate(plan['uploads']):
            operation = 'upload:'+str(index);effects.issue(operation)
            data = (out/'retained'/item['objectRelativePath']).read_bytes()
            raw,content_type = body('images',data,item['filename'])
            reply = api(producer,'/task/new/upload/'+task,'POST',raw,{'Content-Type':content_type})
            effects.save_reply(operation,reply['status'],reply['body'].encode())
        effects.issue('commit');reply = api(producer,'/task/new/commit/'+task,'POST')
        effects.save_reply('commit',reply['status'],reply['body'].encode())
        deadline=time.monotonic()+40
        while True:
            reply=api(producer,'/task/'+task+'/info');value=json.loads(reply['body'])
            if value.get('status',{}).get('code') == 30:break
            assert value.get('status',{}).get('code') in (10,20), 'Invalid images cannot count as successful processing'
            if time.monotonic()>=deadline:raise TimeoutError('Invalid task did not reach failed state')
            time.sleep(.5)
        raw=reply['body'].encode('utf-8');(out/'failed-body.bin').write_bytes(raw)
        failed=observe(plan,reply['status'],raw);save('failed-observation.json',failed);observations.append('failed')
        assert failed['reportedState'] == 'failed' and failed['reportedImageCount'] == 3, 'Real failed-task metadata differs'
        assert failed['automaticPostprocessingOptions'] == [{'name':name,'value':True} for name in ('pc-ept','cog','gltf')], 'Real automatic options differ'
        for label in observations:
            observed=json.loads((out/(label+'-observation.json')).read_bytes())
            for field in ('engineIdentityVerification','originalActorAuthorization','sourceCustodyVerification','effectiveExecutionSettingsVerification','processingQualityVerification','freshnessVerification'):
                assert observed[field] == 'unassessed', 'Reported metadata cannot promote '+field
            assert observed['transportPermission'] is False and observed['publicationPermission'] is False, 'Reported metadata cannot grant writes'
        assert (effects.root/'plan.json').read_bytes() == plan_bytes, 'API observations changed original plan'
        assert all(row['state'] == 'acknowledged' for row in effects.snapshot()['commands']), 'Experimental effects replies differ'
        stop(producer,'producer')
        save('results.json',{'originalPlanSavedBeforeApiEffects':True,'observations':observations,'realFailedState':True,
            'reportedAutomaticOptions':['pc-ept','cog','gltf'],'decodedImageryAccepted':False,'applicationAuthorityAccepted':False,
            'workerRecoveryAccepted':False,'defaultActivated':False})
        save('source-bindings.json',{str(path.relative_to(ROOT)):hashlib.sha256(path.read_bytes()).hexdigest() for path in
            (Path(__file__),ROOT/'workers/odm_worker/task_observation.py',ROOT/'workers/odm_worker/engine_effects.py')})
        print(json.dumps({'observations':observations,'workerRecoveryAccepted':False}))
    finally:
        for index,container in enumerate(containers):
            if inspect(container)['State']['Running']:stop(container,'finally-'+str(index))
            logs = subprocess.run(['docker','logs',container],capture_output=True,timeout=10)
            (out/('engine-'+str(index)+'-private.log')).write_bytes(logs.stdout+logs.stderr)


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args();run(args.out.resolve())
