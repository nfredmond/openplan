"""Fixed old-web host observer. No database, helper, application start or arbitrary command."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT=Path('/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v6')
UID=1000
UNIT='openplan-current-project-preview-app-21510042e-v3-web.service'
INVOCATION='34615ba06b554482b0f79c90fe999a61'
RECEIPT=Path('/home/nathaniel/.local/state/openplan/current-project-preview-host-attestation-v2-20261015/runtime-start-attestation.json')
RECEIPT_SHA='f86e9f4dd5d2f5104a85f2d42e96ddb771e9b938cf6d954989fa64458485b8d4'
APP=Path('/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015-v3/candidate/openplan')
HOST_USER_NS='user:[4026531837]'

def require(value,reason):
    if not value:raise ValueError(reason)
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def bus_environment():
    return {'PATH':'/usr/bin:/bin','HOME':str(ROOT/'observer-home'),'XDG_RUNTIME_DIR':'/run/user/1000',
        'DBUS_SESSION_BUS_ADDRESS':'unix:path=/run/user/1000/bus','PYTHONDONTWRITEBYTECODE':'1'}
def command(argv):
    result=subprocess.run(argv,env=bus_environment(),capture_output=True,timeout=5)
    require(result.returncode==0,'observer-command:'+Path(argv[0]).name)
    return result.stdout

def resource_check(values):
    require(values['memory.max']==str(512*1024**2) and values['memory.swap.max']=='0' and
        values['memory.swap.current']=='0','observer-memory')
    words=values['cpu.max'].split()
    require(len(words)==2 and all(w.isdigit() for w in words) and int(words[1])>0 and
        0<int(words[0])<=int(words[1])//2,'observer-cpu')
    events=dict(line.split() for line in values['memory.events'].splitlines())
    require(all(events.get(k)=='0' for k in ['low','high','max','oom','oom_kill','oom_group_kill']),'observer-memory-events')

def observe(nonce):
    require(re.fullmatch('[0-9a-f]{64}',nonce) is not None,'observer-request')
    require(os.getuid()==UID,'observer-user')
    namespace=os.readlink('/proc/self/ns/user')
    require(namespace==HOST_USER_NS,'observer-host-user-namespace')
    require(RECEIPT.is_file() and not RECEIPT.is_symlink() and sha(RECEIPT)==RECEIPT_SHA,'observer-old-receipt')
    receipt=json.loads(RECEIPT.read_text())
    require(receipt['app']['head']=='21510042e94bcaf80f262205ad156a7bb639e35c','observer-old-source')
    properties=dict(line.split('=',1) for line in command(['/usr/bin/systemctl','--user','show',UNIT,
        '--property=ActiveState,InvocationID,MainPID,ControlGroup']).decode().splitlines())
    require(properties['ActiveState']=='active' and properties['InvocationID']==INVOCATION,'observer-old-unit')
    require(properties['MainPID'].isdigit() and int(properties['MainPID'])>0 and
        properties['ControlGroup'].startswith('/user.slice/') and properties['ControlGroup'].endswith('/'+UNIT),'observer-old-cgroup')
    rows=command(['/usr/bin/ss','-H','-ltnp','sport = :3585']).decode().splitlines()
    pid=receipt['listenerPid']
    require(type(pid) is str and pid.isdigit() and int(pid)>0,'observer-old-pid')
    require(len(rows)==1 and rows[0].split()[3]=='127.74.19.10:3585' and
        set(re.findall(r'pid=([0-9]+)',rows[0]))=={pid},'observer-old-listener')
    proc=Path('/proc')/pid
    require((proc/'cwd').resolve()==APP,'observer-old-cwd')
    require((proc/'cgroup').read_text().strip()=='0::'+properties['ControlGroup'],'observer-old-process-cgroup')
    environment=dict(item.split('=',1) for item in (proc/'environ').read_bytes().decode().split('\0') if '=' in item)
    environment_digest=digest(environment)
    require(environment_digest==receipt['processEnvironmentDigest'],'observer-old-environment')
    group=Path('/sys/fs/cgroup')/Path('/proc/self/cgroup').read_text().split('0::',1)[1].strip().lstrip('/')
    resources={name:(group/name).read_text().strip() for name in ['memory.max','memory.swap.max','memory.swap.current','memory.events','cpu.max']}
    resource_check(resources)
    return {'schema':1,'request':nonce,'unit':UNIT,'invocation':INVOCATION,'mainPid':properties['MainPID'],
        'listenerPid':pid,'cwd':str(APP),'cgroup':properties['ControlGroup'],'processEnvironmentDigest':environment_digest,
        'observerSHA256':sha(Path(__file__)),'observerUserNamespace':namespace,'resources':resources}

def main():
    os.umask(0o077)
    os.environ.clear();os.environ.update(PATH='/usr/bin:/bin',HOME=str(ROOT/'observer-home'),PYTHONDONTWRITEBYTECODE='1')
    require(Path(__file__).resolve()==ROOT/'observer.py' and ROOT.resolve()==ROOT,'observer-path')
    require(len(sys.argv)==2,'observer-arguments')
    try:print(json.dumps(observe(sys.argv[1]),sort_keys=True))
    except BaseException as error:
        print('REFUSED old-web-observer: '+(str(error) if type(error) is ValueError else type(error).__name__),file=sys.stderr)
        raise SystemExit(1)
if __name__=='__main__':main()
