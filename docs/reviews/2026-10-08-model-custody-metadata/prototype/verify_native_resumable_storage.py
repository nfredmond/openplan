"""Actual TUS chunk commit followed by process exit and separate-process recovery."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid

import requests


def verify(native, token, output):
    control = os.environ.get('OPENPLAN_NATIVE_TUS_CONTROL', 'normal')
    assert control in ('normal','harmless','wrong-identity','skip-head','skip-readback','restored')
    worker = Path(__file__).resolve().parents[4] / 'workers/aequilibrae_worker'
    source = output / 'source.bin'
    content = b'a' * (6 * 1024 * 1024) + b'final-native-source-chunk'
    if control == 'harmless': content += b'\n'
    source.write_bytes(content)
    object_path = 'source-proof/' + str(uuid.uuid4()) + '/source.bin'
    headers = {'Authorization':'Bearer '+token, 'apikey':token}
    with requests.get(native+'/object/authenticated/run-artifacts/'+object_path,headers=headers,timeout=15) as response:
        probe = {'status':response.status_code, 'body':response.json()}
        (output/'missing-object-probe.json').write_text(json.dumps(probe,indent=2)+'\n')
    code = '''
import json,os,sys
from pathlib import Path
config=json.load(sys.stdin)
sys.path.insert(0,config['worker'])
import requests
import model_storage_resumable as uploader
if config['control']=='skip-readback': uploader.verify_object=lambda **kwargs:True
if config['control']=='skip-head':
    original_number=uploader._number
    def number(headers,key):
        return 0 if key=='Upload-Offset' and 'Upload-Length' in headers else original_number(headers,key)
    uploader._number=number
from model_storage_resumable import upload_file
calls=[]
def request(method,url,**kwargs):
    url=url.replace('/storage/v1/','/',1)
    response=requests.request(method,url,**kwargs)
    calls.append({'method':method,'status':response.status_code,'offset':response.headers.get('Upload-Offset')})
    Path(config['calls']).write_text(json.dumps(calls))
    if method=='PATCH' and config['exit_after_chunk']:
        assert response.status_code==204,'Native PATCH did not commit'
        response.close()
        os._exit(73)
    return response
uri=upload_file(source=config['source'],state_dir=config['state'],base_url=config['base'],
    service_key=config['key'],bucket='run-artifacts',object_path=config['object_path'],
    sha256=config['sha256'],size_bytes=config['size'],request=request)
print(json.dumps({'uri':uri,'pid':os.getpid()}))
'''
    config = {'worker':str(worker), 'base':native, 'key':token, 'source':str(source),
              'state':str(output/'upload-state'), 'object_path':object_path,
              'sha256':hashlib.sha256(content).hexdigest(), 'size':len(content),
              'exit_after_chunk':True, 'control':control, 'calls':str(output/'first-calls.json')}
    first = subprocess.run([sys.executable,'-B','-c',code],input=json.dumps(config),capture_output=True,text=True,timeout=60)
    (output/'first.log').write_text(first.stdout+first.stderr)
    assert first.returncode == 73, 'First native uploader did not exit after committed chunk'
    state = json.loads((output/'upload-state/upload.json').read_text())
    assert state['status']=='uploading' and state['offset']==0 and state['upload_url']
    config.update(exit_after_chunk=False,calls=str(output/'second-calls.json'))
    if control == 'wrong-identity': config['object_path'] += '-wrong'
    second = subprocess.run([sys.executable,'-B','-c',code],input=json.dumps(config),capture_output=True,text=True,timeout=60)
    (output/'second.log').write_text(second.stdout+second.stderr)
    assert second.returncode==0,'Fresh native uploader did not recover'
    result=json.loads(second.stdout)
    assert result['uri']=='storage://run-artifacts/'+object_path
    calls=json.loads((output/'second-calls.json').read_text())
    assert not any(row['method']=='POST' for row in calls),'Recovery created another upload'
    head=next(row for row in calls if row['method']=='HEAD')
    assert head['offset']==str(6*1024*1024),'Recovery did not observe committed native offset'
    with requests.get(native+'/object/authenticated/run-artifacts/'+object_path,headers=headers,timeout=15) as response:
        assert response.status_code==200 and response.content==content,'Native final bytes differ'
    assert json.loads((output/'upload-state/upload.json').read_text())['status']=='verified'
    return {'control':control,'fresh_process_recovery':True,'retained_upload_url_reused':True,'committed_offset':6*1024*1024,
            'exact_native_bytes_verified':True,'bytes':len(content),
            'limits':'Native TUS transfer over a synthetic two-chunk file. No complete source-set publication, session expiration, worker integration or scientific acceptance.'}
