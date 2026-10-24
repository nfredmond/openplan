"""Own, cap and remove all Docker resources used for the local two-arm proof."""
import hashlib
import io
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tarfile
import time
import uuid

P=Path(__file__).resolve().parent
root=Path(sys.argv[1]).resolve(); image=sys.argv[2]
name='astra-tbi-cloud-'+uuid.uuid4().hex[:12]
network=name+'-net'; server=name+'-s3'; owned=[]
env_path=root/'local.env'
# Test-only random values never appear in command arguments or reports.
settings={'TBI_S3_ENDPOINT':f'http://{server}:5000','TBI_S3_BUCKET':'astra-tbi-cloud-proof',
          'TBI_S3_ACCESS_KEY_ID':secrets.token_hex(16),'TBI_S3_SECRET_ACCESS_KEY':secrets.token_hex(32),
          'TBI_ARCHIVE_KEY':'proof.tar.gz','TBI_RESULTS_PREFIX':'results','TBI_DATASET':'parity2000'}
fd=os.open(env_path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:f.write(''.join(k+'='+v+'\n' for k,v in settings.items()))
# Corrupt a runtime member while preserving its length and embedded inventory.
with tarfile.open(root/'proof-input/proof.tar.gz','r|gz') as inp,tarfile.open(root/'corrupt.tar.gz','w:gz',compresslevel=1) as out:
    for m in inp:
        f=inp.extractfile(m)
        if m.name=='inputs/bundle/households.csv':
            data=f.read(); data=data.replace(b'household_id',b'household_xd',1); out.addfile(m,io.BytesIO(data))
        else:out.addfile(m,f)
admission=json.loads((P/'admission.json').read_text());bad=root/'corrupt.tar.gz'
admission['parity2000'].update(sha256=hashlib.file_digest(bad.open('rb'),'sha256').hexdigest(),bytes=bad.stat().st_size)
(root/'member-test-admission.json').write_text(json.dumps(admission,indent=2)+'\n')
receipts=[]; seeded=False; collected=False
def call(args,log=None):
    if log:
        with (root/log).open('w') as out:return subprocess.run(args,stdout=out,stderr=subprocess.STDOUT).returncode
    subprocess.run(args,check=True,stdout=subprocess.DEVNULL)

def run(label,extra=(),helper=None):
    container=name+'-'+label; owned.append(container)
    cmd=['docker','run','--name',container,'--network',network,'--memory=9g','--memory-swap=9g',
         '--env-file',str(env_path),'-e','TBI_RUN_ID='+label,'-v',str(root)+':/proof','-v',str(root/'work')+':/work',*extra]
    if helper:
        cmd += ['-v',str(P/'proof_client.py')+':/proof_client.py:ro','--entrypoint','/opt/transport/bin/python',image,'/proof_client.py',helper]
    else:cmd += [image]
    code=call(cmd,label+'.log')
    inspect=json.loads(subprocess.check_output(['docker','inspect',container]))[0]
    receipts.append({'label':label,'container':container,'exit_code':code,
                     'image_id':inspect['Image'],'memory':inspect['HostConfig']['Memory'],
                     'memory_swap':inspect['HostConfig']['MemorySwap'],'oom_killed':inspect['State']['OOMKilled']})
    return code

try:
    call(['docker','network','create','--subnet',sys.argv[3] if len(sys.argv)>3 else '10.251.239.0/24',network]);owned.append(server)
    sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
    call(['docker','run','-d','--name',server,'--network',network,'--memory=6g','--memory-swap=6g',
          '-p',f'127.0.0.1:{port}:5000','astra-tbi-cloud-s3:20261024'])
    import urllib.request
    for attempt in range(30):
        try:
            urllib.request.urlopen(f'http://127.0.0.1:{port}/',timeout=2).close();break
        except Exception:time.sleep(1)
    else:raise RuntimeError('local S3 endpoint did not start')
    assert run('seed',helper='seed')==0; seeded=True
    assert run('wrong-hash',['-e','TBI_ARCHIVE_KEY=corrupt.tar.gz'])!=0
    assert run('bad-member',['-e','TBI_ARCHIVE_KEY=corrupt.tar.gz','-v',str(root/'member-test-admission.json')+':/opt/tbi/admission.json:ro'])!=0
    assert run('parity')==0
    assert run('collect',helper='collect')==0; collected=True
finally:
    if seeded and not collected:
        run('collect-after-failure',helper='collect')
    with (root/'s3.log').open('w') as log:
        subprocess.run(['docker','logs',server],stdout=log,stderr=subprocess.STDOUT)
    check=subprocess.run(['docker','inspect',server],capture_output=True,text=True)
    if check.returncode==0:
        data=json.loads(check.stdout)[0]
        (root/'s3-state.json').write_text(json.dumps({'state':data['State'],'memory':data['HostConfig']['Memory'],'image_id':data['Image']},indent=2)+'\n')
    (root/'docker-receipts.json').write_text(json.dumps(receipts,indent=2)+'\n')
    for container in reversed(owned):subprocess.run(['docker','rm','-f',container],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    subprocess.run(['docker','network','rm',network],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    env_path.unlink(missing_ok=True)
    (root/'cleanup.json').write_text(json.dumps({'containers':owned,'network':network,'env_file_removed':not env_path.exists()},indent=2)+'\n')
