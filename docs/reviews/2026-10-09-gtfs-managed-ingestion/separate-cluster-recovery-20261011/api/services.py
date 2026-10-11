"""Create and stop only exact bounded fixture services on the retained origin."""
import hashlib, json, os, re, socket, subprocess, time, uuid
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit
import requests
from scope import API, DB_NAME, IMAGES, NETWORK, ORIGINALS, require, verify_original
from properties import fresh

PURPOSE='gtfs-separate-cluster-api-20261011-01'
LIMITS={'rest':134217728,'auth':268435456,'storage':536870912,'gateway':268435456}
PORTS={'rest':3000,'auth':9999,'storage':5000,'gateway':8000}
URI_KEYS={'rest':'PGRST_DB_URI','auth':'GOTRUE_DB_DATABASE_URL','storage':'DATABASE_URL'}

def inspect(identity):return json.loads(subprocess.check_output(['docker','inspect',identity],stderr=subprocess.PIPE))[0]

def environment_hash(env):return hashlib.sha256(json.dumps(env,sort_keys=True).encode()).hexdigest()

def verify_new(kind,info,receipt,database,storage,configuration):
    require(info['Id']==receipt['id'] and info['Name']=='/'+receipt['name'] and info['Image']==IMAGES[kind],'expanded-new-identity')
    require(info['Config']['Labels'].get('openplan.purpose')==PURPOSE and info['Config']['Labels'].get('openplan.proof.stage')==receipt['stage'],'expanded-new-owner')
    require(list(info['NetworkSettings']['Networks'])==[NETWORK],'expanded-new-network')
    require(info['HostConfig']['Memory']==LIMITS[kind] and info['HostConfig']['MemorySwap']==LIMITS[kind] and info['HostConfig']['NanoCpus']==500000000 and info['HostConfig']['PidsLimit']==128,'expanded-new-limits')
    env=dict(row.split('=',1) for row in info['Config']['Env'] if '=' in row)
    require(environment_hash(env)==receipt['environmentSha256'],'expanded-new-environment')
    if kind!='gateway':
        env=dict(row.split('=',1) for row in info['Config']['Env'] if '=' in row);uri=urlsplit(env[URI_KEYS[kind]])
        require(uri.hostname==DB_NAME and uri.path=='/'+database,'expanded-new-uri')
        if kind=='rest':require(env.get('PGRST_OPENAPI_MODE')=='disabled','expanded-new-openapi')
    bindings=info['HostConfig']['PortBindings'].get(str(PORTS[kind])+'/tcp')
    require(bindings and len(bindings)==1 and bindings[0]['HostIp']=='127.74.9.11' and (kind!='gateway' or bindings[0]['HostPort']=='29941'),'expanded-new-loopback')
    expected=[] if kind in ('rest','auth') else [(str(storage),'/mnt',True)] if kind=='storage' else [(str(configuration),'/etc/kong/proof.json',False)]
    require(len(info['Mounts'])==len(expected) and [(m['Source'],m['Destination'],m['RW']) for m in info['Mounts'] if m['Type']=='bind']==expected,'expanded-new-mounts')

def stop_original(snapshots):
    for kind in ('gateway','rest','auth','storage'):
        info=inspect(ORIGINALS[kind]);verify_original(kind,info)
        require(info['Name']==snapshots[kind]['Name'],'expanded-original-name-changed')
        subprocess.run(['docker','stop','--time','10',info['Id']],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=20)
        verify_original(kind,inspect(info['Id']),running=False)

def restart_original(snapshots):
    # A failed rehearsal can return the owned fixture to its original services.
    # Refuse another listener instead of ending its process.
    pending=[]
    for kind in ('rest','auth','storage','gateway'):
        info=inspect(ORIGINALS[kind]);verify_original(kind,info,running=info['State']['Running'])
        require(info['Name']==snapshots[kind]['Name'],'expanded-original-name-changed')
        if not info['State']['Running']:pending.append(info['Id'])
    if ORIGINALS['gateway'] in pending:port_free()
    if pending:subprocess.run(['docker','start',*pending],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=30)
    for kind in ORIGINALS:verify_original(kind,inspect(ORIGINALS[kind]))

def port_free(host='127.74.9.11',port=29941):
    # TIME_WAIT is a completed connection, not an active owned listener.
    with socket.socket() as sock:
        sock.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
        sock.bind((host,port));sock.listen(1)

def ready_status(auth,rest,storage):
    return auth==200 and rest==200 and storage==200

def verify_stage(stage):
    require(stage == 'api', 'expanded-stack-stage')

def start_stack(stage,database,storage,kong_original,snapshots,out,state):
    fresh(database);verify_stage(stage)
    require(storage.resolve()==storage and storage.is_dir(),'expanded-stack-storage')
    port_free()
    receipts={};configuration=out/(stage+'-kong-runtime-private.json')
    state['services']=receipts
    def save(): (out/(stage+'-service-receipts-private.json')).write_text(json.dumps(state,indent=2)+'\n')
    def create(kind,env,mounts):
        name='openplan-gtfs-point-'+stage+'-'+kind+'-'+uuid.uuid4().hex[:12]
        require(all('\n' not in k+v and '\r' not in k+v for k,v in env.items()),'expanded-stack-env-lines')
        envfile=out/(name+'-runtime-private.env');envfile.write_text('\n'.join(k+'='+v for k,v in env.items())+'\n');envfile.chmod(0o600)
        receipt={'name':name,'stage':stage,'image':IMAGES[kind],'environmentSha256':environment_hash(env)};receipts[kind]=receipt;save()
        port='127.74.9.11:'+('29941:' if kind=='gateway' else ':')+str(PORTS[kind])
        args=['docker','run','--detach','--pull','never','--name',name,'--network',NETWORK,'--publish',port,'--memory',str(LIMITS[kind]),'--memory-swap',str(LIMITS[kind]),'--cpus','0.5','--pids-limit','128','--label','openplan.purpose='+PURPOSE,'--label','openplan.proof.stage='+stage,'--env-file',str(envfile)]
        for mount in mounts:args.extend(['--mount',mount])
        args.append(IMAGES[kind])
        try:
            result=subprocess.run(args,capture_output=True,text=True,timeout=30)
            (out/(name+'-creation-private.log')).write_text(result.stderr)
            acknowledged=result.returncode==0
            if acknowledged:receipt['id']=result.stdout.strip()
        except subprocess.TimeoutExpired:acknowledged=False
        if not acknowledged:
            # A lost Docker reply cannot authorize another create or a name-only
            # stop. Reconcile actual immutable configuration against the plan.
            candidate=inspect(name);receipt['id']=candidate['Id'];receipt['creationAcknowledgementUncertain']=True
            verify_new(kind,candidate,receipt,database,storage,configuration)
        save()
        info=inspect(receipt['id']);verify_new(kind,info,receipt,database,storage,configuration)
        require(info['State']['Running'],'expanded-stack-started')
    for kind in ('rest','auth','storage'):
        env=dict(row.split('=',1) for row in snapshots[kind]['Config']['Env'] if '=' in row)
        uri=urlsplit(env[URI_KEYS[kind]]);env[URI_KEYS[kind]]=urlunsplit(uri._replace(netloc=uri.netloc.rsplit('@',1)[0]+'@'+DB_NAME+':'+str(uri.port or 5432),path='/'+database))
        if kind=='rest':env['PGRST_OPENAPI_MODE']='disabled'
        mounts=['type=bind,source='+str(storage)+',target=/mnt'] if kind=='storage' else []
        create(kind,env,mounts)
    kong=json.loads(kong_original.read_text())
    for service in kong['services']:
        kind=service['name'];require(kind in receipts,'expanded-kong-service')
        uri=urlsplit(service['url']);require(uri.hostname==snapshots[kind]['Name'].lstrip('/'),'expanded-kong-source')
        service['url']=urlunsplit(uri._replace(netloc=receipts[kind]['name']+':'+str(uri.port)))
    configuration.write_text(json.dumps(kong));configuration.chmod(0o644)
    # Kong's configured user reads this explicit bind. Its host parent remains
    # private; the captured configuration retains a separate 0600 copy.
    env=dict(row.split('=',1) for row in snapshots['gateway']['Config']['Env'] if '=' in row)
    create('gateway',env,['type=bind,source='+str(configuration)+',target=/etc/kong/proof.json,readonly'])
    session=requests.Session();session.trust_env=False
    ready=False
    for _ in range(90):
        try:
            with session.get(API+'/auth/v1/health',headers={'apikey':state['anon_key']},timeout=1) as response:auth=response.status_code
            with session.head(API+'/rest/v1/gtfs_feed_versions?select=id&limit=0',headers={'apikey':state['service_key'],'Authorization':'Bearer '+state['service_key']},timeout=1) as response:rest=response.status_code
            with session.get(API+'/storage/v1/status',headers={'apikey':state['service_key'],'Authorization':'Bearer '+state['service_key']},timeout=1) as response:storage_status=response.status_code
            ready=ready_status(auth,rest,storage_status)
        except requests.RequestException:pass
        if ready:break
        time.sleep(.2)
    require(ready,'expanded-stack-readiness');state['ready']=True;save();return receipts,configuration

def stop_stack(database,storage,configuration,out,state,records):
    for kind in ('gateway','rest','auth','storage'):
        receipt=state['services'].get(kind)
        if not receipt or 'id' not in receipt:continue
        info=inspect(receipt['id']);verify_new(kind,info,receipt,database,storage,configuration)
        logs=subprocess.check_output(['docker','logs',info['Id']],stderr=subprocess.STDOUT,timeout=15);(out/(receipt['name']+'-service-private.log')).write_bytes(logs)
        if info['State']['Running']:subprocess.run(['docker','stop','--time','10',info['Id']],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=20)
        final=inspect(info['Id']);verify_new(kind,final,receipt,database,storage,configuration);require(not final['State']['Running'],'expanded-stack-survived-stop')
        records.append({'kind':kind,'id':info['Id'],'stage':receipt['stage'],'image':info['Image'],'memoryLimit':LIMITS[kind],'memorySwapLimit':LIMITS[kind],'exactIdentityStopped':True,'exitCode':final['State']['ExitCode'],'oomKilled':final['State']['OOMKilled']})
