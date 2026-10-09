"""Bounded native Storage for the owned GTFS clone; no shared bucket writes."""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
from urllib.parse import urlsplit, urlunsplit
import uuid
import requests

@contextmanager
def storage(config):
    if config['container'] != 'supabase_db_openplan-restore-target-2026091050' or not re.fullmatch(r'openplan_attempt_cli_[0-9a-f]{32}',config['database']):
        raise ValueError('Expected isolated GTFS HTTP clone')
    def docker(*args):
        r=subprocess.run(['docker',*args],text=True,capture_output=True,timeout=30)
        if r.returncode: raise RuntimeError('Owned Storage Docker operation failed: '+args[0])
        return r.stdout.strip()
    source=json.loads(docker('inspect','supabase_storage_openplan-restore-target-2026091050'))[0]
    settings=dict(value.split('=',1) for value in source['Config']['Env'])
    settings['DATABASE_URL']=urlunsplit(urlsplit(settings['DATABASE_URL'])._replace(path='/'+config['database']))
    settings.update(VECTOR_ENABLED='false',VECTOR_STORE_MIGRATIONS_ENABLED='false',ENABLE_IMAGE_TRANSFORMATION='false',STORAGE_BACKEND='file',FILE_STORAGE_BACKEND_PATH='/mnt')
    networks=list(source['NetworkSettings']['Networks'])
    if len(networks)!=1: raise RuntimeError('Ambiguous Storage network')
    name='openplan-gtfs-storage-proof-'+uuid.uuid4().hex
    with tempfile.TemporaryDirectory(prefix='openplan-gtfs-storage-') as directory:
        objects=Path(directory)/'objects';objects.mkdir(mode=0o700)
        envfile=Path(directory)/'storage.env'
        fd=os.open(envfile,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w') as handle:handle.write('\n'.join(k+'='+v for k,v in settings.items())+'\n')
        created=False
        try:
            docker('run','-d','--name',name,'--memory','512m','--memory-swap','512m','--pids-limit','128','--cpus','0.5','--network',networks[0],'--env-file',str(envfile),'--mount',f'type=bind,src={objects},dst=/mnt','-p','127.0.0.1::5000',source['Config']['Image'])
            created=True;envfile.unlink()
            binding=docker('port',name,'5000/tcp')
            if not binding.startswith('127.0.0.1:'):raise RuntimeError('Storage is not loopback-only')
            url='http://'+binding
            for _ in range(60):
                try:
                    if requests.get(url+'/status',timeout=1).status_code==200:break
                except requests.RequestException:pass
                time.sleep(.25)
            else:raise RuntimeError('Native Storage did not become ready')
            headers={'Authorization':'Bearer '+settings['SERVICE_KEY'],'apikey':settings['SERVICE_KEY']}
            response=requests.get(url+'/bucket/gtfs-uploads',headers=headers,timeout=10)
            if response.status_code==404 or str(response.json().get('statusCode'))=='404':
                created_bucket=requests.post(url+'/bucket',headers=headers,json={'id':'gtfs-uploads','name':'gtfs-uploads','public':False,'allowed_mime_types':['application/zip']},timeout=10)
                assert created_bucket.status_code in (200,201), 'Private GTFS test bucket creation failed'
                response=requests.get(url+'/bucket/gtfs-uploads',headers=headers,timeout=10)
            assert response.status_code==200 and response.json()['public'] is False, 'Expected private GTFS bucket'
            yield {'url':url,'token':settings['SERVICE_KEY'],'image':source['Config']['Image']}
        finally:
            if created:docker('rm','-f',name)
            envfile.unlink(missing_ok=True)
            if docker('ps','-aq','--filter','name=^/'+name+'$'):raise RuntimeError('Owned Storage container remains')
