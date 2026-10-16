"""Fixed transport to one sealed, read-only old-web observer. No command proxy."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import journal as j

ROOT=Path('/dev/shm/openplan-pr330-preview-20261015')
OBSERVER_SHA='869ff3c3d30198fd06b17303a9eb1c319e0a8518783cfc15a1e66039d44ac2ca'
UNIT='openplan-pr330-memory-r2-preserved-web-observer'
ENV={'PATH':'/usr/bin:/bin','HOME':str(ROOT/'observer-home'),'XDG_RUNTIME_DIR':'/run/user/1000',
    'DBUS_SESSION_BUS_ADDRESS':'unix:path=/run/user/1000/bus','PYTHONDONTWRITEBYTECODE':'1'}

def require(value,reason):
    if not value:raise ValueError(reason)
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def write_once(path,value):
    j.record(str(path.relative_to(ROOT)),value)
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'w') as f:json.dump(value,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
    fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)
def argv(nonce):
    require(re.fullmatch('[0-9a-f]{64}',nonce) is not None,'transport-request')
    return ['/usr/bin/systemd-run','--user','--quiet','--wait','--pipe','--collect','--unit='+UNIT,
        '-p','MemoryMax=512M','-p','MemorySwapMax=0','-p','CPUQuota=50%','-p','UMask=0077',
        '/usr/bin/env','-i','PATH=/usr/bin:/bin','HOME='+str(ROOT/'observer-home'),'PYTHONDONTWRITEBYTECODE=1',
        '/usr/bin/python3','-B',str(ROOT/'observer.py'),nonce]

def validate(value,nonce):
    require(set(value)=={'schema','request','unit','invocation','mainPid','listenerPid','cwd','cgroup',
        'processEnvironmentDigest','observerSHA256','observerUserNamespace','resources'},'transport-result-schema')
    require(type(value['schema']) is int and value['schema']==1 and value['request']==nonce,'transport-result-freshness')
    require(value['unit']=='openplan-current-project-preview-app-21510042e-v3-web.service' and
        value['invocation']=='34615ba06b554482b0f79c90fe999a61','transport-old-unit')
    require(value['listenerPid']=='4104299' and type(value['mainPid']) is str and value['mainPid'].isdigit() and
        int(value['mainPid'])>0,'transport-old-pid')
    require(value['cwd']=='/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015-v3/candidate/openplan' and
        value['cgroup'].startswith('/user.slice/') and value['cgroup'].endswith('/'+value['unit']),'transport-old-process')
    require(value['observerSHA256']==OBSERVER_SHA and value['observerUserNamespace']=='user:[4026531837]','transport-observer-identity')
    # Exact environment digest comes from the immutable old receipt, never printed values.
    receipt=Path('/home/nathaniel/.local/state/openplan/current-project-preview-host-attestation-v2-20261015/runtime-start-attestation.json')
    require(sha(receipt)=='f86e9f4dd5d2f5104a85f2d42e96ddb771e9b938cf6d954989fa64458485b8d4','transport-old-receipt')
    require(value['processEnvironmentDigest']==json.loads(receipt.read_text())['processEnvironmentDigest'],'transport-old-environment')
    r=value['resources'];require(r['memory.max']==str(512*1024**2) and r['memory.swap.max']=='0' and r['memory.swap.current']=='0','transport-resources')
    words=r['cpu.max'].split();require(len(words)==2 and all(w.isdigit() for w in words) and 0<int(words[0])<=int(words[1])//2,'transport-cpu')
    events=dict(line.split() for line in r['memory.events'].splitlines());require(all(events.get(k)=='0' for k in ['low','high','max','oom','oom_kill','oom_group_kill']),'transport-memory-events')

def observe(nonce):
    path=ROOT/'observer.py'
    require(os.getuid()==1000 and path.is_file() and not path.is_symlink() and
        path.stat().st_mode&0o777==0o600 and sha(path)==OBSERVER_SHA,'transport-observer-seal')
    result=j.execute('observer-'+nonce,argv(nonce),env=ENV,timeout=45)
    # Retain actual diagnostics even if decoding or an observation refuses.
    write_once(ROOT/'observer-receipts'/('transport-'+nonce+'.json'),{'request':nonce,'returncode':result.returncode,
        'stdout':result.stdout.decode(errors='replace'),'stderr':result.stderr.decode(errors='replace')})
    require(result.returncode==0,'transport-host-observer-exit')
    value=json.loads(result.stdout);validate(value,nonce)
    return value

def main():
    os.umask(0o077)
    os.environ.clear();os.environ.update(PATH='/usr/bin:/bin',HOME=str(ROOT/'observer-home'),PYTHONDONTWRITEBYTECODE='1')
    require(Path(__file__).resolve()==ROOT/'observer_transport.py' and ROOT.resolve()==ROOT,'transport-path')
    require(len(sys.argv)==2,'transport-arguments')
    try:print(json.dumps(observe(sys.argv[1]),sort_keys=True))
    except BaseException as error:
        print('REFUSED observer-transport: '+(str(error) if type(error) is ValueError else type(error).__name__),file=sys.stderr)
        raise SystemExit(1)
if __name__=='__main__':main()
